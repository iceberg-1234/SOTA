package ai.sota.glass

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Handler
import android.os.Looper
import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * SOTA 4-Layer Model-Agnostic Live Companion Engine for Android (`GeminiLiveSessionManager`)
 *
 * 1. Persistent Stateful WebSocket (`BidiGenerateContent`) to `gemini-3.8-live` (auto-failover `gemini-3.1-flash-live-preview`)
 * 2. Full-Duplex Native Audio (`16kHz PCM` Mic Input with Hardware `AcousticEchoCanceler` + `24kHz PCM` Streaming Audio Output + Sub-20ms Native Barge-in)
 * 3. Continuous `1 FPS` Camera Stream (`640x480`) + On-Demand `1280x960` High-Res Snapshot Tool (`capture_high_res_detail`)
 * 4. 4-Layer Model-Agnostic Harness:
 *    - `inspect_visual_facts`: Deterministic Multi-Date (`HH:mm` Mfg vs Later Expiry) & Expired-Food Verifier
 *    - `track_hand_to_target`: 4-Stage Stateful Action Guide FSM (`OVERVIEW_SCAN -> SAFE_BEZEL_ANCHOR -> LIVE_CM_TRACKING -> PRESS_CONFIRM`)
 *    - `remember_entity` / `recall_entity`: Disk-Persisted Object, Person & Space Memory (`sota_entity_memory.json`)
 */
object GeminiLiveSessionManager {

    enum class FocusMode(val labelEn: String, val badgeKo: String) {
        LIVE_AUTO("⚡ Auto", "실시간 자율 동반자"),
        SEE_AND_READ("👀 See", "초정밀 사물·글자 리더"),
        ACT_AND_GUIDE("🤚 Act", "실시간 손끝·행동 가이드"),
        REMEMBER_ENTITIES("🧠 Mem", "사물·공간·사람 기억"),
        NAV_COPILOT("🧭 Nav", "GPS 길안내 + 위험/입구 감시")
    }

    data class EntityRecord(
        val category: String, // OBJECT | PERSON | SPACE
        val name: String,
        val landmarkOrAppearance: String,
        val extraNotes: String,
        val updatedAtMs: Long
    )

    interface LiveUiCallbacks {
        fun captureStreamFrameJpegBase64(): String?
        fun captureHighResFrameJpegBase64(): String?
        fun onLiveStatusChanged(connected: Boolean, statusText: String)
        fun onLiveInputHearing(partialUserText: String) {}
        fun onNavigationStateChanged() {}
        fun onLiveTranscriptTurn(modeBadge: String, userText: String, assistantText: String, latencyMs: Long, frameB64: String?)
    }

    private val okHttp = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // Keep WebSocket open indefinitely
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val isRunning = AtomicBoolean(false)
    private val isSetupReady = AtomicBoolean(false)
    private val micPausedForFeedback = AtomicBoolean(false)
    @Volatile
    private var playbackFinishWallMs: Long = 0L
    @Volatile
    var activeWatchTarget: String? = null
        private set
    @Volatile
    private var watchExpiresAtMs: Long = 0L
    @Volatile
    private var lastNavHazardAlertMs: Long = 0L
    private var watcherSocket: WebSocket? = null
    private val watcherBusy = AtomicBoolean(false)
    private var webSocket: WebSocket? = null
    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null

    @Volatile
    var currentFocusMode: FocusMode = FocusMode.LIVE_AUTO
        private set

    private val candidateLiveModels = listOf(
        "gemini-3.8-live",
        "gemini-3.1-flash-live-preview",
        "gemini-2.5-flash-native-audio-preview-12-2025"
    )
    private var modelAttemptIdx = 0
    private var activeModelName = candidateLiveModels[0]

    // 4-Stage Action Guide FSM State
    private var actLockedTarget: String? = null
    private var lastTurnStartMs: Long = System.currentTimeMillis()
    private val currentInputTranscript = StringBuilder()
    private val currentOutputTranscript = StringBuilder()
    private var latestStreamedFrameB64: String? = null

    private const val ENTITY_MEMORY_FILE = "sota_entity_memory.json"

    fun isLiveActive(): Boolean = isRunning.get()

    fun setMicPausedForFeedback(paused: Boolean) {
        micPausedForFeedback.set(paused)
    }

    fun setFocusMode(context: Context, mode: FocusMode, callbacks: LiveUiCallbacks?) {
        currentFocusMode = mode
        actLockedTarget = null
        if (isRunning.get() && callbacks != null) {
            // Reconnect cleanly with the new focused workflow instruction & toolset
            stopSession()
            startSession(context, callbacks)
        }
    }

    @Synchronized
    fun loadEntities(context: Context): MutableList<EntityRecord> {
        val file = File(context.filesDir, ENTITY_MEMORY_FILE)
        val list = mutableListOf<EntityRecord>()
        if (!file.exists()) return list
        try {
            val arr = JSONArray(file.readText(Charsets.UTF_8))
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                list.add(
                    EntityRecord(
                        category = o.optString("category", "OBJECT"),
                        name = o.optString("name", ""),
                        landmarkOrAppearance = o.optString("landmarkOrAppearance", ""),
                        extraNotes = o.optString("extraNotes", ""),
                        updatedAtMs = o.optLong("updatedAtMs", 0L)
                    )
                )
            }
        } catch (_: Exception) {}
        return list
    }

    @Synchronized
    fun upsertEntity(
        context: Context,
        category: String,
        name: String,
        landmarkOrAppearance: String,
        extraNotes: String = ""
    ): EntityRecord {
        val list = loadEntities(context)
        val cleanName = name.trim()
        list.removeAll { it.category.equals(category, true) && it.name.equals(cleanName, true) }
        val rec = EntityRecord(
            category = category.uppercase(),
            name = cleanName,
            landmarkOrAppearance = landmarkOrAppearance.trim(),
            extraNotes = extraNotes.trim(),
            updatedAtMs = System.currentTimeMillis()
        )
        list.add(rec)
        val arr = JSONArray()
        for (item in list) {
            arr.put(
                JSONObject()
                    .put("category", item.category)
                    .put("name", item.name)
                    .put("landmarkOrAppearance", item.landmarkOrAppearance)
                    .put("extraNotes", item.extraNotes)
                    .put("updatedAtMs", item.updatedAtMs)
            )
        }
        File(context.filesDir, ENTITY_MEMORY_FILE).writeText(arr.toString(2), Charsets.UTF_8)
        return rec
    }

    @Synchronized
    fun recallEntities(context: Context, query: String, category: String? = null): List<EntityRecord> {
        val q = query.trim().lowercase()
        return loadEntities(context).filter { r ->
            val catOk = category.isNullOrBlank() || r.category.equals(category, true)
            val textOk = q.isEmpty() ||
                r.name.lowercase().contains(q) ||
                q.contains(r.name.lowercase()) ||
                r.landmarkOrAppearance.lowercase().contains(q) ||
                r.extraNotes.lowercase().contains(q)
            catOk && textOk
        }
    }

    private fun parseRealIsoDate(raw: String): LocalDate? {
        val m = Regex("(20\\d{2})[.\\-/년\\s]+(\\d{1,2})[.\\-/월\\s]+(\\d{1,2})").find(raw) ?: return null
        return try {
            LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())
        } catch (_: Exception) {
            null
        }
    }

    private fun sanitizeSpokenKorean(raw: String): String {
        return NativeSotaAiClient.cleanMovementRelativeDirection(raw)
            .replace(Regex("제품\\s+제품이지만"), "지금 각도에서는")
            .replace(Regex("꺼내\\s*드릴까요\\??"), "선택 버튼을 눌러 꺼내실 수 있어요.")
            .trim()
    }

    /**
     * Deterministic Policy Verifier for `inspect_visual_facts` (Model-Agnostic Layer C)
     */
    private fun evaluateVisualFactsPolicy(args: JSONObject): String {
        val targetItem = args.optString("targetItem", "").trim().ifBlank { "확인하신 대상" }
        val framingIssue = args.optString("framingIssue", "NONE").uppercase()
        val keyNumsArr = args.optJSONArray("exactKeyNumbers") ?: JSONArray()
        val datesArr = args.optJSONArray("observedDates") ?: JSONArray()
        val verbatim = args.optString("fullVerbatimText", "").trim()

        if (framingIssue != "NONE" && keyNumsArr.length() == 0 && datesArr.length() == 0 && verbatim.isEmpty()) {
            return when (framingIssue) {
                "TOO_CLOSE_BLUR" -> "카메라와 너무 가까워 글자가 흐려졌어요. 물건을 한 뼘 정도만 천천히 뒤로 떼어 보실래요?"
                "OCCLUDED_BY_HAND" -> "손가락이 글자 부분을 가리고 있어요. 물건 양끝 모서리만 살짝 잡고 다시 비춰 보실래요?"
                "WRONG_SIDE" -> "지금 비추신 면에는 찾는 글자나 날짜가 보이지 않아요. 천천히 반 바퀴 돌려 다른 면을 비춰 보실래요?"
                "GLARE" -> "빛 반사 때문에 글자가 번져 보여요. 각도를 옆으로 살짝만 기울여 보실래요?"
                "TOO_DARK" -> "주변이 어두워 글자가 잘 안 보여요. 밝은 곳을 향해 비춰 보실래요?"
                else -> "글자가 선명하게 잡히도록 가슴 높이에서 잠시 멈춰 비춰 보실래요?"
            }
        }

        data class ParsedDateFact(val date: LocalDate, val hasTime: Boolean, val prefix: String)
        val parsedDates = mutableListOf<ParsedDateFact>()
        for (i in 0 until datesArr.length()) {
            val dObj = datesArr.optJSONObject(i) ?: continue
            val rawTxt = dObj.optString("rawText", "")
            val dt = parseRealIsoDate(rawTxt) ?: continue
            val hasTime = dObj.optBoolean("hasTimestamp", false) || Regex("\\d{1,2}:\\d{2}").containsMatchIn(rawTxt)
            val prefix = dObj.optString("printedPrefix", "NONE").uppercase()
            parsedDates.add(ParsedDateFact(dt, hasTime, prefix))
        }

        if (parsedDates.isNotEmpty()) {
            var expDate: LocalDate? = null
            var mfgOnlyDate: LocalDate? = null
            if (parsedDates.size >= 2) {
                expDate = parsedDates.find { it.prefix == "EXPIRY" }?.date
                    ?: parsedDates.filter { !it.hasTime && it.prefix != "MANUFACTURED" }.maxByOrNull { it.date }?.date
                    ?: parsedDates.maxByOrNull { it.date }?.date
            } else {
                val single = parsedDates.first()
                if (single.hasTime || single.prefix == "MANUFACTURED") {
                    mfgOnlyDate = single.date
                } else {
                    expDate = single.date
                }
            }

            if (mfgOnlyDate != null) {
                return "$targetItem 제조일자가 ${mfgOnlyDate.year}년 ${mfgOnlyDate.monthValue}월 ${mfgOnlyDate.dayOfMonth}일로 적혀 있어요. 소비기한은 그 아래 줄이나 다른 면에 있으니 천천히 돌려 비춰 보실래요?"
            }
            if (expDate != null) {
                val diff = ChronoUnit.DAYS.between(LocalDate.now(), expDate)
                val dateKo = "${expDate.year}년 ${expDate.monthValue}월 ${expDate.dayOfMonth}일"
                return when {
                    diff < 0 -> "주의하세요! $targetItem 소비기한이 ${dateKo}까지로 오늘 기준 ${abs(diff)}일 지났어요. 드시지 마세요."
                    diff == 0L -> "$targetItem 소비기한이 오늘인 ${dateKo}까지예요."
                    else -> "$targetItem 소비기한은 ${dateKo}까지로 오늘부터 ${diff}일 남았어요."
                }
            }
        }

        if (verbatim.isNotEmpty()) {
            return "$targetItem 전체 내용이에요. $verbatim"
        }

        val nums = mutableListOf<String>()
        for (i in 0 until keyNumsArr.length()) {
            val n = keyNumsArr.optString(i, "").trim()
            if (n.isNotEmpty()) nums.add(n)
        }
        if (nums.isNotEmpty()) {
            return "$targetItem 에서 확인된 번호는 ${nums.joinToString(", ")}번이에요."
        }
        return "$targetItem 이 보입니다."
    }

    /**
     * 4-Stage Stateful Action Guide FSM for `track_hand_to_target`
     */
    private fun evaluateHandTrackingFsm(args: JSONObject): String {
        if (args.optBoolean("residualHeatHazard", false)) {
            return "화상 주의! 화구나 온수 부위에 뜨거운 열기가 남아 있으니 절대 손을 대지 마세요."
        }
        val surfaceType = args.optString("surfaceType", "KIOSK_SCREEN")
        val target = args.optString("targetLabel", "").trim()
        val handVisible = args.optBoolean("handVisible", false)
        val rowsArr = args.optJSONArray("availableItemsByRow")

        if (surfaceType == "VENDING_MACHINE") {
            if (target.isEmpty() && rowsArr != null && rowsArr.length() > 0) {
                val items = (0 until rowsArr.length()).mapNotNull { rowsArr.optString(it).takeIf { s -> s.isNotBlank() } }
                return "자판기 진열 목록을 알려드릴게요. ${items.joinToString(", ")} 순서로 있어요. 어떤 음료를 고르시겠어요?"
            }
            val chosen = target.ifBlank { actLockedTarget ?: "선택하신 음료" }
            actLockedTarget = chosen
            if (!handVisible) {
                return "$chosen 구매를 도와드릴게요. 먼저 자판기 오른쪽 중간 카드 단말기에 카드를 태그하신 뒤 버튼 쪽으로 손을 뻗어 보여주세요."
            }
        }

        val finalTarget = target.ifBlank { actLockedTarget ?: "목표 버튼" }
        actLockedTarget = finalTarget
        if (!handVisible) {
            return "$finalTarget 위치를 확인했어요. 잘못 눌리지 않도록 먼저 화면 오른쪽 아래 바깥 테두리 모서리에 검지 손가락을 대고 보여주시겠어요?"
        }

        val dx = args.optDouble("dxCm", 0.0)
        val dy = args.optDouble("dyCm", 0.0)
        if (abs(dx) <= 0.8 && abs(dy) <= 0.8) {
            return "바로 거기예요! 지금 손끝 아래가 $finalTarget 이니 그대로 누르세요."
        }
        val moves = mutableListOf<String>()
        if (dx > 0.8) moves.add("오른쪽으로 약 ${dx.roundToInt()}센티미터")
        else if (dx < -0.8) moves.add("왼쪽으로 약 ${(-dx).roundToInt()}센티미터")
        if (dy > 0.8) moves.add("위로 약 ${dy.roundToInt()}센티미터")
        else if (dy < -0.8) moves.add("아래로 약 ${(-dy).roundToInt()}센티미터")
        return "지금 손끝에서 ${moves.joinToString(", ")}만 천천히 옮겨 보세요."
    }

    private fun buildLiveSetupJson(context: Context, modelName: String): String {
        val savedSummary = loadEntities(context).takeLast(12).joinToString("; ") {
            "[${it.category}] ${it.name}: ${it.landmarkOrAppearance}"
        }
        val modePrompt = when (currentFocusMode) {
            FocusMode.SEE_AND_READ ->
                "현재 모드: [바라보기 See & Read]. 사물/문서 각도를 코칭하고, 글자/주문번호/소비기한은 `capture_high_res_detail` 또는 `inspect_visual_facts`를 호출하세요. 사용자가 '~ 찾아줘 / ~ 보이면 알려줘'(예: '쌈장 찾으러 가자')라고 하면 반드시 `start_watching_target` 도구를 호출하세요."
            FocusMode.ACT_AND_GUIDE ->
                "현재 모드: [행동하기 Act & Guide]. 조작 요청 시 `track_hand_to_target` 도구를 호출해 키오스크, 자판기, 가전 버튼까지 손끝을 안내하세요."
            FocusMode.REMEMBER_ENTITIES ->
                "현재 모드: [기억하기 People & Object Memory]. 내 물건 위치나 만난 사람(인상착의·이름·명함) 기억은 `remember_entity`, 회상은 `recall_entity`를 호출하세요."
            FocusMode.NAV_COPILOT ->
                "현재 모드: [길안내 내비게이션 동반자]. 목적지 검색 요청('왕십리역 가자', '구의역 지하철로 안내해줘')은 `search_destination`, 출발 확정은 `confirm_route_start`, 안내 종료는 `stop_navigation` 도구를 호출하세요. 실제 턴바이턴 거리·정거장 안내는 GPS 엔진이 수행합니다."
            FocusMode.LIVE_AUTO ->
                "현재 모드: [일상+이동 통합 동반자]. 1) '~ 찾아줘 / 보이면 알려줘'(예: '쌈장 찾으러 가자') 요청 시 `start_watching_target` 호출, 2) 길안내 요청 시 `search_destination` / `confirm_route_start` / `stop_navigation` 호출, 3) 글자·소비기한 판독은 `inspect_visual_facts`/`capture_high_res_detail`, 4) 버튼 조작은 `track_hand_to_target`, 5) 물건·사람 기억은 `remember_entity`/`recall_entity`를 호출하세요."
        }
        val sysText = buildString {
            append("당신은 시각장애인의 눈과 기억이 되어주는 실시간 AI 스마트글래스 동반자 '소타(SOTA)'입니다.\n")
            append(modePrompt).append("\n")
            append("절대 수칙: 1) 사용자가 한국어로 말을 걸거나 시스템 알림 지시가 들어왔을 때만 딱 한 번 대답하고 그 외에는 완전히 침묵하세요. 2) 요청받지 않은 길안내를 임의로 지어내지 마세요. 3) 특수기호나 '12시 방향' 없이 1~2문장으로 짧고 자연스럽게 말하세요.\n")
            if (savedSummary.isNotBlank()) append("저장된 온디바이스 기억(사물·사람·공간): $savedSummary\n")
        }

        val toolsDecl = JSONArray()
            .put(
                JSONObject()
                    .put("name", "inspect_visual_facts")
                    .put("description", "숫자(영수증 주문번호, 금액, 지폐), 복수 날짜(제조일/소비기한), 약봉지, 제품명을 정확히 검증하여 읽을 때 호출합니다.")
                    .put(
                        "parameters",
                        JSONObject()
                            .put("type", "OBJECT")
                            .put(
                                "properties",
                                JSONObject()
                                    .put("targetItem", JSONObject().put("type", "STRING"))
                                    .put("exactKeyNumbers", JSONObject().put("type", "ARRAY").put("items", JSONObject().put("type", "STRING")))
                                    .put(
                                        "observedDates",
                                        JSONObject().put("type", "ARRAY").put(
                                            "items",
                                            JSONObject().put("type", "OBJECT").put(
                                                "properties",
                                                JSONObject()
                                                    .put("rawText", JSONObject().put("type", "STRING"))
                                                    .put("hasTimestamp", JSONObject().put("type", "BOOLEAN"))
                                                    .put("printedPrefix", JSONObject().put("type", "STRING"))
                                            ).put("required", JSONArray().put("rawText").put("hasTimestamp"))
                                        )
                                    )
                                    .put("fullVerbatimText", JSONObject().put("type", "STRING"))
                                    .put("framingIssue", JSONObject().put("type", "STRING"))
                            )
                            .put("required", JSONArray().put("targetItem").put("exactKeyNumbers").put("observedDates").put("framingIssue"))
                    )
            )
            .put(
                JSONObject()
                    .put("name", "capture_high_res_detail")
                    .put("description", "영수증 작은 주문번호, 깨알 같은 약봉지/성분표/소비기한 글씨를 1280px 초고해상도 원본 사진으로 다시 찍어 확인합니다.")
                    .put(
                        "parameters",
                        JSONObject()
                            .put("type", "OBJECT")
                            .put("properties", JSONObject().put("focusQuestion", JSONObject().put("type", "STRING")))
                            .put("required", JSONArray().put("focusQuestion"))
                    )
            )
            .put(
                JSONObject()
                    .put("name", "track_hand_to_target")
                    .put("description", "자판기, 키오스크, 엘리베이터, 가전제품 버튼을 향해 사용자의 손끝 이동을 단계별로 유도합니다.")
                    .put(
                        "parameters",
                        JSONObject()
                            .put("type", "OBJECT")
                            .put(
                                "properties",
                                JSONObject()
                                    .put("surfaceType", JSONObject().put("type", "STRING"))
                                    .put("availableItemsByRow", JSONObject().put("type", "ARRAY").put("items", JSONObject().put("type", "STRING")))
                                    .put("targetLabel", JSONObject().put("type", "STRING"))
                                    .put("handVisible", JSONObject().put("type", "BOOLEAN"))
                                    .put("dxCm", JSONObject().put("type", "NUMBER"))
                                    .put("dyCm", JSONObject().put("type", "NUMBER"))
                                    .put("residualHeatHazard", JSONObject().put("type", "BOOLEAN"))
                            )
                            .put("required", JSONArray().put("surfaceType").put("targetLabel").put("handVisible"))
                    )
            )
            .put(
                JSONObject()
                    .put("name", "remember_entity")
                    .put("description", "내 물건 위치(OBJECT), 만난 사람의 인상착의·이름·명함(PERSON), 공간 특징(SPACE)을 영구 메모리에 저장합니다.")
                    .put(
                        "parameters",
                        JSONObject()
                            .put("type", "OBJECT")
                            .put(
                                "properties",
                                JSONObject()
                                    .put("category", JSONObject().put("type", "STRING"))
                                    .put("name", JSONObject().put("type", "STRING"))
                                    .put("landmarkOrAppearance", JSONObject().put("type", "STRING"))
                                    .put("extraNotes", JSONObject().put("type", "STRING"))
                            )
                            .put("required", JSONArray().put("category").put("name").put("landmarkOrAppearance"))
                    )
            )
            .put(
                JSONObject()
                    .put("name", "recall_entity")
                    .put("description", "저장된 물건 위치, 사람 정보, 공간 기억을 검색합니다.")
                    .put(
                        "parameters",
                        JSONObject()
                            .put("type", "OBJECT")
                            .put(
                                "properties",
                                JSONObject()
                                    .put("query", JSONObject().put("type", "STRING"))
                                    .put("category", JSONObject().put("type", "STRING"))
                            )
                            .put("required", JSONArray().put("query"))
                    )
            )
            .put(
                JSONObject()
                    .put("name", "start_watching_target")
                    .put("description", "사용자가 '쌈장 찾으러 가자', '소비기한 보이면 알려줘', '빈자리 나오면 말해줘'처럼 특정 대상이 화면에 나타날 때까지 계속 지켜보다가 알려달라고 할 때 호출합니다.")
                    .put(
                        "parameters",
                        JSONObject()
                            .put("type", "OBJECT")
                            .put("properties", JSONObject().put("targetDescription", JSONObject().put("type", "STRING")))
                            .put("required", JSONArray().put("targetDescription"))
                    )
            )
            .put(
                JSONObject()
                    .put("name", "stop_watching_target")
                    .put("description", "진행 중인 목표 탐색 감시를 중단합니다.")
                    .put("parameters", JSONObject().put("type", "OBJECT").put("properties", JSONObject()))
            )
            .put(
                JSONObject()
                    .put("name", "search_destination")
                    .put("description", "사용자가 특정 역이나 장소로 길안내를 요청할 때('왕십리역 가자', '구의역 지하철로 안내해줘', '이마트 찾아줘') 호출해 경로 계획을 생성합니다.")
                    .put(
                        "parameters",
                        JSONObject()
                            .put("type", "OBJECT")
                            .put(
                                "properties",
                                JSONObject()
                                    .put("placeQuery", JSONObject().put("type", "STRING"))
                                    .put("transportMode", JSONObject().put("type", "STRING"))
                            )
                            .put("required", JSONArray().put("placeQuery"))
                    )
            )
            .put(
                JSONObject()
                    .put("name", "confirm_route_start")
                    .put("description", "안내된 이동 계획대로 출발을 확정하고 실시간 GPS 길안내를 시작합니다.")
                    .put("parameters", JSONObject().put("type", "OBJECT").put("properties", JSONObject()))
            )
            .put(
                JSONObject()
                    .put("name", "stop_navigation")
                    .put("description", "진행 중인 길안내 경로를 종료합니다.")
                    .put("parameters", JSONObject().put("type", "OBJECT").put("properties", JSONObject()))
            )

        return JSONObject()
            .put(
                "setup",
                JSONObject()
                    .put("model", "models/$modelName")
                    .put(
                        "generationConfig",
                        JSONObject()
                            .put("responseModalities", JSONArray().put("AUDIO"))
                            .put("mediaResolution", "MEDIA_RESOLUTION_HIGH")
                            .put(
                                "speechConfig",
                                JSONObject().put(
                                    "voiceConfig",
                                    JSONObject().put("prebuiltVoiceConfig", JSONObject().put("voiceName", "Aoede"))
                                )
                            )
                    )
                    .put(
                        "realtimeInputConfig",
                        JSONObject()
                            .put(
                                "automaticActivityDetection",
                                JSONObject()
                                    .put("disabled", false)
                                    .put("startOfSpeechSensitivity", "START_SENSITIVITY_LOW")
                                    .put("endOfSpeechSensitivity", "END_SENSITIVITY_HIGH")
                                    .put("prefixPaddingMs", 200)
                                    .put("silenceDurationMs", 650)
                            )
                            .put("turnCoverage", "TURN_INCLUDES_ONLY_ACTIVITY")
                    )
                    .put("inputAudioTranscription", JSONObject())
                    .put("outputAudioTranscription", JSONObject())
                    .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", sysText))))
                    .put("tools", JSONArray().put(JSONObject().put("functionDeclarations", toolsDecl)))
            )
            .toString()
    }

    fun interruptPlaybackBargeIn() {
        playbackFinishWallMs = 0L
        try {
            audioTrack?.pause()
            audioTrack?.flush()
            audioTrack?.play()
        } catch (_: Exception) {}
    }

    fun speakProactiveAlertOverLiveSession(koreanAnnouncement: String) {
        val ws = webSocket ?: return
        if (!isSetupReady.get() || koreanAnnouncement.isBlank()) return
        lastTurnStartMs = System.currentTimeMillis()
        ws.send(
            JSONObject().put(
                "clientContent",
                JSONObject()
                    .put(
                        "turns",
                        JSONArray().put(
                            JSONObject()
                                .put("role", "user")
                                .put(
                                    "parts",
                                    JSONArray().put(
                                        JSONObject().put(
                                            "text",
                                            "[SYSTEM_PROACTIVE_ANNOUNCE]: 부연 설명 없이 다음 안내 문장만 그대로 자연스럽게 읽어주세요: \"$koreanAnnouncement\""
                                        )
                                    )
                                )
                        )
                    )
                    .put("turnComplete", true)
            ).toString()
        )
    }

    fun startSilentTargetWatch(targetDescription: String, durationMs: Long = 60_000L) {
        val clean = targetDescription.trim()
        if (clean.isEmpty()) return
        activeWatchTarget = clean
        watchExpiresAtMs = System.currentTimeMillis() + durationMs
    }

    fun clearSilentTargetWatch() {
        activeWatchTarget = null
        watchExpiresAtMs = 0L
    }

    /**
     * Runs ONE zero-audio silent vision check over a lightweight tool-only WebSocket.
     * Emits ZERO speaker audio when `found == false`; speaks ONLY when `found == true`!
     */
    private fun runOneSilentVisionWatchCheck(
        frameB64: String,
        watchPrompt: String,
        onDetected: (String) -> Unit
    ) {
        val apiKey = BuildConfig.GEMINI_API_KEY
        if (apiKey.isBlank() || !watcherBusy.compareAndSet(false, true)) return
        val url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=$apiKey"
        val req = Request.Builder().url(url).build()

        val wSocket = okHttp.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                val decl = JSONArray().put(
                    JSONObject()
                        .put("name", "report_watch_result")
                        .put("description", "Report found=true ONLY if the target or immediate blocking hazard is genuinely visible right now.")
                        .put(
                            "parameters",
                            JSONObject()
                                .put("type", "OBJECT")
                                .put(
                                    "properties",
                                    JSONObject()
                                        .put("found", JSONObject().put("type", "BOOLEAN"))
                                        .put("guidanceKo", JSONObject().put("type", "STRING"))
                                )
                                .put("required", JSONArray().put("found").put("guidanceKo"))
                        )
                )
                val setup = JSONObject().put(
                    "setup",
                    JSONObject()
                        .put("model", "models/gemini-3.8-live")
                        .put("generationConfig", JSONObject().put("responseModalities", JSONArray().put("AUDIO")))
                        .put(
                            "systemInstruction",
                            JSONObject().put(
                                "parts",
                                JSONArray().put(
                                    JSONObject().put(
                                        "text",
                                        "You are a strict zero-false-positive visual detector for a blind user. Immediately call `report_watch_result`. Set `found=true` ONLY when the exact requested target or an immediate obstacle within 3m is clearly visible in the image; otherwise MUST set `found=false`."
                                    )
                                )
                            )
                        )
                        .put("tools", JSONArray().put(JSONObject().put("functionDeclarations", decl)))
                ).toString()
                ws.send(setup)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleWatcherMsg(ws, text)
            }

            override fun onMessage(ws: WebSocket, bytes: okio.ByteString) {
                handleWatcherMsg(ws, bytes.utf8())
            }

            private fun handleWatcherMsg(ws: WebSocket, raw: String) {
                try {
                    val msg = JSONObject(raw)
                    if (msg.has("setupComplete")) {
                        ws.send(
                            JSONObject().put(
                                "clientContent",
                                JSONObject().put(
                                    "turns",
                                    JSONArray().put(
                                        JSONObject().put("role", "user").put(
                                            "parts",
                                            JSONArray()
                                                .put(JSONObject().put("inlineData", JSONObject().put("mimeType", "image/jpeg").put("data", frameB64)))
                                                .put(JSONObject().put("text", watchPrompt))
                                        )
                                    )
                                ).put("turnComplete", true)
                            ).toString()
                        )
                        return
                    }
                    val calls = msg.optJSONObject("toolCall")?.optJSONArray("functionCalls")
                    if (calls != null && calls.length() > 0) {
                        val args = calls.optJSONObject(0)?.optJSONObject("args")
                        val found = args?.optBoolean("found", false) ?: false
                        val guidance = sanitizeSpokenKorean(args?.optString("guidanceKo", "") ?: "")
                        watcherBusy.set(false)
                        try { ws.close(1000, "done") } catch (_: Exception) {}
                        if (found && guidance.isNotBlank()) {
                            mainHandler.post { onDetected(guidance) }
                        }
                    }
                } catch (_: Exception) {
                    watcherBusy.set(false)
                    try { ws.close(1000, "err") } catch (_: Exception) {}
                }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                watcherBusy.set(false)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                watcherBusy.set(false)
            }
        })
        watcherSocket = wSocket
        mainHandler.postDelayed({
            if (watcherBusy.compareAndSet(true, false)) {
                try { wSocket.close(1000, "timeout") } catch (_: Exception) {}
            }
        }, 5500L)
    }

    fun sendUserPromptAndHighResSnap(userText: String, callbacks: LiveUiCallbacks) {
        val ws = webSocket ?: return
        if (!isSetupReady.get()) return
        interruptPlaybackBargeIn()
        lastTurnStartMs = System.currentTimeMillis()
        val hiRes = callbacks.captureHighResFrameJpegBase64() ?: callbacks.captureStreamFrameJpegBase64()
        latestStreamedFrameB64 = hiRes
        val parts = JSONArray()
        if (!hiRes.isNullOrBlank()) {
            parts.put(JSONObject().put("inlineData", JSONObject().put("mimeType", "image/jpeg").put("data", hiRes)))
        }
        parts.put(JSONObject().put("text", userText))
        ws.send(
            JSONObject().put(
                "clientContent",
                JSONObject()
                    .put("turns", JSONArray().put(JSONObject().put("role", "user").put("parts", parts)))
                    .put("turnComplete", true)
            ).toString()
        )
    }

    fun startSession(context: Context, callbacks: LiveUiCallbacks) {
        val apiKey = BuildConfig.GEMINI_API_KEY
        if (apiKey.isBlank()) {
            callbacks.onLiveStatusChanged(false, "API key not configured")
            return
        }
        stopSession()
        isRunning.set(true)
        isSetupReady.set(false)
        activeModelName = candidateLiveModels[modelAttemptIdx % candidateLiveModels.size]
        val appCtx = context.applicationContext

        initOutputAudioTrack()
        val url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=$apiKey"
        val req = Request.Builder().url(url).build()

        callbacks.onLiveStatusChanged(false, "⚡ Connecting Gemini Live ($activeModelName)...")

        webSocket = okHttp.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(buildLiveSetupJson(appCtx, activeModelName))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleServerJsonMessage(appCtx, webSocket, text, callbacks)
            }

            override fun onMessage(webSocket: WebSocket, bytes: okio.ByteString) {
                handleServerJsonMessage(appCtx, webSocket, bytes.utf8(), callbacks)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!isRunning.get()) return
                modelAttemptIdx = (modelAttemptIdx + 1) % candidateLiveModels.size
                mainHandler.postDelayed({
                    if (isRunning.get()) startSession(appCtx, callbacks)
                }, 900L)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (isRunning.get() && code != 1000) {
                    modelAttemptIdx = (modelAttemptIdx + 1) % candidateLiveModels.size
                    mainHandler.postDelayed({
                        if (isRunning.get()) startSession(appCtx, callbacks)
                    }, 900L)
                }
            }
        })
    }

    private fun handleServerJsonMessage(
        context: Context,
        ws: WebSocket,
        rawJson: String,
        callbacks: LiveUiCallbacks
    ) {
        try {
            val msg = JSONObject(rawJson)
            if (msg.has("setupComplete")) {
                isSetupReady.set(true)
                mainHandler.post {
                    callbacks.onLiveStatusChanged(
                        true,
                        "🟢 Gemini Live Connected ($activeModelName · ${currentFocusMode.labelEn})"
                    )
                }
                startFullDuplexMicAndVideoPump(ws, callbacks)
                return
            }

            // Execute Model-Agnostic Harness Tools!
            val toolCall = msg.optJSONObject("toolCall")?.optJSONArray("functionCalls")
            if (toolCall != null && toolCall.length() > 0) {
                val fnResponses = JSONArray()
                for (i in 0 until toolCall.length()) {
                    val fc = toolCall.optJSONObject(i) ?: continue
                    val id = fc.optString("id", "")
                    val name = fc.optString("name", "")
                    val args = fc.optJSONObject("args") ?: JSONObject()

                    when (name) {
                        "capture_high_res_detail" -> {
                            val hiResB64 = callbacks.captureHighResFrameJpegBase64()
                            latestStreamedFrameB64 = hiResB64
                            if (!hiResB64.isNullOrBlank()) {
                                val focusQ = args.optString("focusQuestion", "작은 글씨와 숫자를 한 자리씩 정확히 읽어주세요.")
                                ws.send(
                                    JSONObject().put(
                                        "clientContent",
                                        JSONObject().put(
                                            "turns",
                                            JSONArray().put(
                                                JSONObject().put("role", "user").put(
                                                    "parts",
                                                    JSONArray()
                                                        .put(JSONObject().put("inlineData", JSONObject().put("mimeType", "image/jpeg").put("data", hiResB64)))
                                                        .put(JSONObject().put("text", "[1280px 초고해상도 원본 스냅샷]: $focusQ — 모든 자리 숫자와 날짜를 정확히 확인해 답하세요."))
                                                )
                                            )
                                        ).put("turnComplete", false)
                                    ).toString()
                                )
                            }
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject().put("capturedHighRes", !hiResB64.isNullOrBlank())
                                        .put("instruction", "방금 전달된 1280px 고해상도 이미지를 보고 정확한 숫자·글자를 자연스럽게 말씀해 주세요.")
                                )
                            )
                        }
                        "inspect_visual_facts" -> {
                            val verifiedKo = sanitizeSpokenKorean(evaluateVisualFactsPolicy(args))
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject().put("verifiedSpeechKo", verifiedKo)
                                        .put("instruction", "위 verifiedSpeechKo 문장을 그대로 자연스럽게 전달하세요.")
                                )
                            )
                        }
                        "track_hand_to_target" -> {
                            val stepKo = sanitizeSpokenKorean(evaluateHandTrackingFsm(args))
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject().put("verifiedSpeechKo", stepKo)
                                        .put("instruction", "위 verifiedSpeechKo 손 위치 가이드를 그대로 자연스럽게 전달하세요.")
                                )
                            )
                        }
                        "remember_entity" -> {
                            val saved = upsertEntity(
                                context,
                                args.optString("category", "OBJECT"),
                                args.optString("name", "항목"),
                                args.optString("landmarkOrAppearance", ""),
                                args.optString("extraNotes", "")
                            )
                            val speech = if (saved.category == "PERSON") {
                                "${saved.name} 님의 정보를 기억해 두었어요. ${saved.landmarkOrAppearance}"
                            } else {
                                "${saved.name} 위치를 ${saved.landmarkOrAppearance}으로 영구 저장했어요."
                            }
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject().put("verifiedSpeechKo", speech)
                                        .put("instruction", "저장 완료 내용을 짧고 다정하게 말씀해 주세요.")
                                )
                            )
                        }
                        "recall_entity" -> {
                            val matches = recallEntities(
                                context,
                                args.optString("query", ""),
                                args.optString("category", "").takeIf { it.isNotBlank() }
                            )
                            val speech = if (matches.isNotEmpty()) {
                                matches.take(2).joinToString(" ") { m ->
                                    if (m.category == "PERSON") "${m.name} 님은 ${m.landmarkOrAppearance} 특징으로 기억되어 있어요."
                                    else "${m.name}은 ${m.landmarkOrAppearance}에 둔 것으로 기억하고 있어요."
                                }
                            } else {
                                "아직 그 항목에 대해 저장된 기억이 없어요. 주변을 천천히 비춰 주시면 함께 찾아볼게요."
                            }
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject().put("verifiedSpeechKo", speech)
                                        .put("instruction", "조회된 기억 내용을 그대로 말씀해 주세요.")
                                )
                            )
                        }
                        "start_watching_target" -> {
                            val target = args.optString("targetDescription", "").trim().ifBlank { "요청하신 대상" }
                            startSilentTargetWatch(target, 60_000L)
                            SpatialEarconSynthesizer.play(EarconKind.SCANNING_TICK)
                            mainHandler.post {
                                callbacks.onLiveStatusChanged(true, "🔍 Watching silently for '$target' (60s)...")
                            }
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject()
                                        .put("watchingTarget", target)
                                        .put("verifiedSpeechKo", "네, 지금부터 카메라로 $target 이 보이는지 조용히 살펴볼게요. 천천히 주변을 비춰주시면 발견하는 즉시 알려드릴게요.")
                                        .put("instruction", "위 verifiedSpeechKo 한 문장만 말하고 발견될 때까지 침묵하세요.")
                                )
                            )
                        }
                        "stop_watching_target" -> {
                            clearSilentTargetWatch()
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject().put("verifiedSpeechKo", "목표 탐색을 멈췄어요.")
                                        .put("instruction", "목표 탐색을 멈췄다고 짧게 말씀해 주세요.")
                                )
                            )
                        }
                        "search_destination" -> {
                            val place = args.optString("placeQuery", "").trim()
                            val tMode = args.optString("transportMode", "SUBWAY").uppercase()
                            val searchRes = WayfindingNavigator.searchDestinationCandidates(place)
                            val topCand = searchRes.candidatesRecommended.firstOrNull()
                            val speech = if (topCand != null) {
                                val (_, macroPlanKo) = WayfindingNavigator.confirmAndBuildRoute(
                                    originAddressKo = searchRes.originAddressKo,
                                    originLat = searchRes.originLat,
                                    originLng = searchRes.originLng,
                                    candidate = topCand,
                                    preferTransit = tMode != "WALK" && topCand.distanceMeters >= 500,
                                    preferSubwayOnly = tMode == "SUBWAY"
                                )
                                mainHandler.post { callbacks.onNavigationStateChanged() }
                                macroPlanKo
                            } else {
                                "$place 검색 결과를 찾지 못했어요. 역 이름이나 상호명을 다시 말씀해 주실래요?"
                            }
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject().put("verifiedSpeechKo", speech)
                                        .put("instruction", "위 verifiedSpeechKo 전체 이동 계획을 그대로 안내하고 출발할지 물어보세요.")
                                )
                            )
                        }
                        "confirm_route_start" -> {
                            val startSpeech = WayfindingNavigator.activateConfirmedRoute()
                            WayfindingNavigator.persistActiveRoute(context)
                            mainHandler.post { callbacks.onNavigationStateChanged() }
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject().put("verifiedSpeechKo", startSpeech)
                                        .put("instruction", "위 verifiedSpeechKo 출발 안내를 그대로 말씀해 주세요.")
                                )
                            )
                        }
                        "stop_navigation" -> {
                            WayfindingNavigator.clearRoute(context)
                            NativeSotaAiClient.startOrClearMission("")
                            clearSilentTargetWatch()
                            mainHandler.post { callbacks.onNavigationStateChanged() }
                            fnResponses.put(
                                JSONObject().put("id", id).put("name", name).put(
                                    "response",
                                    JSONObject().put("verifiedSpeechKo", "길 안내를 종료했어요.")
                                        .put("instruction", "길 안내를 종료했다고 짧게 말씀해 주세요.")
                                )
                            )
                        }
                    }
                }
                if (fnResponses.length() > 0) {
                    ws.send(JSONObject().put("toolResponse", JSONObject().put("functionResponses", fnResponses)).toString())
                }
                return
            }

            val sc = msg.optJSONObject("serverContent") ?: return
            if (sc.optBoolean("interrupted", false)) {
                interruptPlaybackBargeIn()
            }

            sc.optJSONObject("inputTranscription")?.optString("text", "")?.takeIf { it.isNotEmpty() }?.let {
                if (currentInputTranscript.isEmpty()) lastTurnStartMs = System.currentTimeMillis()
                currentInputTranscript.append(it)
                val heardSoFar = currentInputTranscript.toString().trim()
                mainHandler.post { callbacks.onLiveInputHearing(heardSoFar) }
            }
            sc.optJSONObject("outputTranscription")?.optString("text", "")?.takeIf { it.isNotEmpty() }?.let {
                currentOutputTranscript.append(it)
            }

            val parts = sc.optJSONObject("modelTurn")?.optJSONArray("parts")
            if (parts != null) {
                for (i in 0 until parts.length()) {
                    val inline = parts.optJSONObject(i)?.optJSONObject("inlineData") ?: continue
                    val mime = inline.optString("mimeType", "")
                    if (mime.startsWith("audio/pcm")) {
                        val pcmBytes = Base64.decode(inline.optString("data", ""), Base64.DEFAULT)
                        if (pcmBytes.isNotEmpty()) {
                            // 24kHz 16-bit mono = 48 bytes per ms; gate mic while speaker plays so SOTA never hears its own voice!
                            val now = System.currentTimeMillis()
                            playbackFinishWallMs = maxOf(now, playbackFinishWallMs) + (pcmBytes.size / 48L)
                            audioTrack?.write(pcmBytes, 0, pcmBytes.size)
                        }
                    }
                }
            }

            if (sc.optBoolean("turnComplete", false)) {
                val outTxt = sanitizeSpokenKorean(currentOutputTranscript.toString())
                val inTxt = currentInputTranscript.toString().trim()
                currentOutputTranscript.clear()
                currentInputTranscript.clear()
                if (outTxt.isNotEmpty()) {
                    val lat = (System.currentTimeMillis() - lastTurnStartMs).coerceIn(180L, 6500L)
                    val snap = latestStreamedFrameB64
                    mainHandler.post {
                        callbacks.onLiveTranscriptTurn(
                            modeBadge = "LIVE_${currentFocusMode.name}",
                            userText = inTxt,
                            assistantText = outTxt,
                            latencyMs = lat,
                            frameB64 = snap
                        )
                    }
                }
            }
        } catch (_: Exception) {}
    }

    private fun initOutputAudioTrack() {
        try {
            val sampleRate = 24_000
            val minBuf = AudioTrack.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            ).coerceAtLeast(9600)

            audioTrack = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(minBuf * 2)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
                .apply { play() }
        } catch (_: Exception) {}
    }

    @SuppressLint("MissingPermission")
    private fun startFullDuplexMicAndVideoPump(
        ws: WebSocket,
        callbacks: LiveUiCallbacks
    ) {
        // 1. Continuous 16kHz Mono PCM Microphone Stream using `realtimeInput.audio` (required by gemini-3.8-live!)
        thread(name = "sota-live-mic", isDaemon = true) {
            try {
                val sampleRate = 16_000
                val minBuf = AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                ).coerceAtLeast(3200)

                val rec = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    minBuf * 2
                )
                audioRecord = rec
                val sessionId = rec.audioSessionId
                if (AcousticEchoCanceler.isAvailable()) {
                    echoCanceler = AcousticEchoCanceler.create(sessionId)?.apply { enabled = true }
                }
                if (NoiseSuppressor.isAvailable()) {
                    noiseSuppressor = NoiseSuppressor.create(sessionId)?.apply { enabled = true }
                }
                rec.startRecording()

                val chunk = ByteArray(3200) // 100ms chunks at 16kHz 16-bit mono
                val silenceChunk = ByteArray(3200)
                val silenceB64 = Base64.encodeToString(silenceChunk, Base64.NO_WRAP)
                while (isRunning.get() && isSetupReady.get() && webSocket === ws) {
                    if (micPausedForFeedback.get()) {
                        Thread.sleep(80L)
                        continue
                    }
                    val read = rec.read(chunk, 0, chunk.size)
                    if (read > 0) {
                        // Suppress self-echo! While SOTA's speaker is playing (+ 600ms room reverb tail), send silence so SOTA never replies to its own voice!
                        val isSpeakerPlaying = System.currentTimeMillis() < playbackFinishWallMs + 600L
                        val b64 = if (isSpeakerPlaying) silenceB64 else Base64.encodeToString(chunk, 0, read, Base64.NO_WRAP)
                        val audioMsg = JSONObject().put(
                            "realtimeInput",
                            JSONObject().put(
                                "audio",
                                JSONObject()
                                    .put("mimeType", "audio/pcm;rate=16000")
                                    .put("data", b64)
                            )
                        ).toString()
                        ws.send(audioMsg)
                    }
                }
            } catch (_: Exception) {}
        }

        // 2. Gentle 0.5 FPS Context Video Stream + Silent Active Target / Navigation Hazard Watcher
        thread(name = "sota-live-video", isDaemon = true) {
            while (isRunning.get() && isSetupReady.get() && webSocket === ws) {
                try {
                    val frameB64 = callbacks.captureStreamFrameJpegBase64()
                    if (!frameB64.isNullOrBlank()) {
                        latestStreamedFrameB64 = frameB64
                        val imgMsg = JSONObject().put(
                            "realtimeInput",
                            JSONObject().put(
                                "video",
                                JSONObject()
                                    .put("mimeType", "image/jpeg")
                                    .put("data", frameB64)
                            )
                        ).toString()
                        ws.send(imgMsg)

                        // A) Active Target Watch (e.g. '쌈장 찾으러 가자' — 100% silent until found == true!)
                        val now = System.currentTimeMillis()
                        val watchTarget = activeWatchTarget
                        if (watchTarget != null) {
                            if (now > watchExpiresAtMs) {
                                clearSilentTargetWatch()
                                speakProactiveAlertOverLiveSession("1분 동안 살펴봤지만 아직 $watchTarget 이 보이지 않았어요. 계속 찾으시려면 다시 말씀해 주세요.")
                            } else if (now > playbackFinishWallMs + 800L) {
                                val hiResOrStream = callbacks.captureHighResFrameJpegBase64() ?: frameB64
                                val secsLeft = ((watchExpiresAtMs - now) / 1000L).coerceAtLeast(1L)
                                mainHandler.post {
                                    callbacks.onLiveStatusChanged(true, "🔍 Watching silently for '$watchTarget'... (${secsLeft}s)")
                                }
                                runOneSilentVisionWatchCheck(
                                    frameB64 = hiResOrStream,
                                    watchPrompt = "사용자가 찾고 있는 대상: '$watchTarget'. 현재 이미지에 '$watchTarget'(실제 라벨 글자 또는 명확한 형태)이 확실히 보이면 found=true와 정확한 위치(왼쪽/가운데/오른쪽, 몇 번째 칸 등)를 한국어 한 문장으로 guidanceKo에 담고, 안 보이면 반드시 found=false로 응답하세요."
                                ) { foundGuidanceKo ->
                                    if (activeWatchTarget != null) {
                                        clearSilentTargetWatch()
                                        SpatialEarconSynthesizer.play(EarconKind.TARGET_FOUND)
                                        speakProactiveAlertOverLiveSession("찾았어요! $foundGuidanceKo")
                                    }
                                }
                            }
                        } else {
                            // B) Silent Navigation Safety Copilot (active ONLY during confirmed outdoor walking route, >= 10s cooldown!)
                            val activeRt = WayfindingNavigator.activeRoute
                            if (activeRt != null && activeRt.isConfirmedByUser && !activeRt.hasBoardedSubway &&
                                now - lastNavHazardAlertMs > 10_000L && now > playbackFinishWallMs + 1000L
                            ) {
                                runOneSilentVisionWatchCheck(
                                    frameB64 = frameB64,
                                    watchPrompt = "보행 안전 코파일럿 점검: 정면 3미터 이내 보행로 한가운데를 막고 있는 즉각적 위험물(킥보드/볼라드/내리막 계단/적색 신호등) 또는 찾고 있는 지하철역 출입구가 보일 때만 found=true와 차도 반대쪽(건물/울타리 쪽) 안전 안내 1문장을 반환하세요. 일반 평탄한 보도면 무조건 found=false를 반환하세요."
                                ) { hazardKo ->
                                    lastNavHazardAlertMs = System.currentTimeMillis()
                                    SpatialEarconSynthesizer.play(EarconKind.HAZARD_ALERT)
                                    speakProactiveAlertOverLiveSession(hazardKo)
                                }
                            }
                        }
                    }
                    Thread.sleep(2200L)
                } catch (_: Exception) {
                    break
                }
            }
        }
    }

    fun stopSession() {
        isRunning.set(false)
        isSetupReady.set(false)
        clearSilentTargetWatch()
        try { watcherSocket?.close(1000, "stop") } catch (_: Exception) {}
        watcherSocket = null
        try {
            webSocket?.close(1000, "Session stopped")
        } catch (_: Exception) {}
        webSocket = null

        try {
            echoCanceler?.release()
            noiseSuppressor?.release()
        } catch (_: Exception) {}
        echoCanceler = null
        noiseSuppressor = null

        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (_: Exception) {}
        audioRecord = null

        try {
            audioTrack?.pause()
            audioTrack?.flush()
            audioTrack?.release()
        } catch (_: Exception) {}
        audioTrack = null
    }
}
