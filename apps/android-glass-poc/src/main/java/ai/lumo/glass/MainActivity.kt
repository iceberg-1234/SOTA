package ai.lumo.glass

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.graphics.Typeface
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.text.Editable
import android.text.TextWatcher
import android.util.Base64
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Field-Testing Lumo Activity with Full Pedestrian Wayfinding & Feedback Logger:
 * 1. Destination Search -> Origin Address & Candidate Destination Confirmation (Fixes LUM-46, LUM-48)
 * 2. Live GPS + Compass Heading + Turn-by-Turn Pedestrian Route Tracking
 * 3. Live Camera View + `AI 답변 ON / OFF` Toggle
 * 4. Scrollable Inference & Feedback History List (Thumbnail, Time, Latency, Detected Mode, Answer, 👍/👎, Detailed Memo)
 */
class MainActivity : Activity(), TextToSpeech.OnInitListener, SensorEventListener {
    private var tts: TextToSpeech? = null
    private lateinit var missionInput: EditText
    private lateinit var categoryTabRow: LinearLayout
    private lateinit var quickChipRow: LinearLayout
    private lateinit var candidateConfirmBox: LinearLayout
    private lateinit var activeNavBanner: TextView
    private lateinit var cameraTextureView: TextureView
    private lateinit var aiToggleBtn: Button
    private lateinit var talkMicBtn: Button
    private lateinit var historyScrollView: ScrollView
    private lateinit var historyContainer: LinearLayout

    private var activeCategoryId: String = "AUTO"

    private data class UseCaseQuickChip(val label: String, val promptQuery: String)
    private data class UseCaseCategoryTab(
        val id: String,
        val title: String,
        val inputHint: String,
        val chips: List<UseCaseQuickChip>
    )

    private val useCaseCategories = listOf(
        UseCaseCategoryTab(
            id = "AUTO",
            title = "🌟 전체자동",
            inputHint = "💬 무엇이든 물어보거나 목적지를 입력하세요 (예: 구의역 가자 / 앞에 뭐 있어?)",
            chips = listOf(
                UseCaseQuickChip("👀 지금 내 앞 상황 설명", "지금 내 눈앞에 무엇이 보이는지 자연스럽게 알려줘"),
                UseCaseQuickChip("🥤 마트 1+1/제로 확인", "지금 보이는 상품의 정확한 이름, 맛, 제로슈거 여부, 가격, 1+1 행사 여부를 알려줘"),
                UseCaseQuickChip("🍱 식탁 반찬/가시 브리핑", "식탁이나 접시 위 음식과 반찬이 앞쪽/위쪽 어디에 놓여 있는지, 생선 가시나 남은 양을 알려줘"),
                UseCaseQuickChip("🔥 인덕션 잔열/가전 확인", "인덕션 화구 켜짐 단계와 잔열(H) 화상 위험 여부, 또는 가전제품 표시창 상태와 남은 시간을 알려줘"),
                UseCaseQuickChip("📌 눈앞 물건 위치 기억", "지금 화면에 보이는 생활 물건(에어팟, 안경, 열쇠, 지갑 등)과 구체적 위치를 기억해 줘")
            )
        ),
        UseCaseCategoryTab(
            id = "WAYFINDING",
            title = "🧭 보행·길찾기",
            inputHint = "🧭 목적지 검색 또는 경로 변경 (예: 쿠팡 본사 / 구의역 / 지하철로)",
            chips = listOf(
                UseCaseQuickChip("⚠️ 무표시 계단/단차/투명유리문", "전방에 회색 내리막 계단 첫 단, 보도턱 단차, 또는 투명 통유리문과 손잡이가 있는지 봐줘"),
                UseCaseQuickChip("🚦 횡단보도/역광 신호등", "횡단보도 보행자 신호등이 초록불인지 빨간불인지, 남은 시간과 정면 방향을 알려줘"),
                UseCaseQuickChip("🌙 어두운 구간 바닥/난간", "어두운 구간인데 지금 걸어가는 바닥이 평탄한지, 손잡이나 벽면이 어느 쪽에 이어지는지 알려줘")
            )
        ),
        UseCaseCategoryTab(
            id = "TRANSIT_TAXI",
            title = "🚇 대중교통·택시",
            inputHint = "🚕 호출택시 번호(예: 택시 34바5678) 또는 승강장/역 질문",
            chips = listOf(
                UseCaseQuickChip("🚇 승강장 방면/빠른환승", "지금 지하철 승강장이 어느 역 방면인지, 몇 호차 몇 번 문(스크린도어 번호)인지 읽어줘"),
                UseCaseQuickChip("🚃 열차 내 정거장/하차문", "지금 지하철 안인데 현재 어느 역이고 내릴 역까지 몇 정거장 남았는지, 어느 쪽 문이 열리는지 알려줘"),
                UseCaseQuickChip("🚕 호출택시 번호판/승차문", "지금 앞에 멈춘 택시나 차량의 색상, 차종, 번호판 번호를 읽고 뒷좌석 문 손잡이 위치를 알려줘"),
                UseCaseQuickChip("🚌 정류장/진입 버스 번호", "버스 정류장 표지판 번호나 지금 들어오는 버스 번호와 앞문 위치를 알려줘")
            )
        ),
        UseCaseCategoryTab(
            id = "SHOPPING_DINING_DOC",
            title = "🛒 마트·식사·문서",
            inputHint = "🛒 상품 비교, 식사 반찬 질문, 약봉지/소비기한/고지서 질문",
            chips = listOf(
                UseCaseQuickChip("🥤 마트 상품 맛/제로/1+1", "지금 들고 있는 상품의 정확한 제품명, 맛, 제로슈거 여부, 가격표, 1+1 행사 여부를 알려줘"),
                UseCaseQuickChip("🍱 식탁 반찬 배치/가시/남은양", "접시나 식판 위 반찬 배치를 앞쪽 왼쪽/오른쪽, 위쪽 기준으로 설명하고 생선 가시나 남은 음식 위치를 알려줘"),
                UseCaseQuickChip("💊 약봉지/안약/소비기한 D-Day", "약봉지 복용 시점(아침/점심/저녁)이나 안약 구분, 또는 식품 소비기한 날짜를 읽어 오늘 기준 며칠 남았는지 알려줘"),
                UseCaseQuickChip("📄 고지서/택배 송장 3요소 요약", "고지서 청구금액·납부기한 또는 택배 송장의 받는 사람·보낸 곳·품목 핵심만 요약해 줘")
            )
        ),
        UseCaseCategoryTab(
            id = "HOME_APPLIANCE_KIOSK",
            title = "🏠 생활·가전·키오스크",
            inputHint = "🏠 물건 찾기(예: 내 에어팟 어디 있어?) 또는 가전/키오스크 질문",
            chips = listOf(
                UseCaseQuickChip("🔥 인덕션 화구/잔열(H)·가전 LED", "평면 인덕션 켜진 화구 단계와 잔열(H) 화상 위험 여부, 또는 세탁기/전자레인지 현재 코스와 남은 시간을 알려줘"),
                UseCaseQuickChip("🛗 엘리베이터 1층/키오스크 코칭", "엘리베이터 1층(로비층) 버튼에 불이 켜져 있는지 먼저 확인하고, 내 손가락에서 목표 버튼까지 상하좌우 몇 cm 이동할지 알려줘"),
                UseCaseQuickChip("📌 눈앞 물건 위치 기억하기", "지금 화면에 보이는 생활 물건(에어팟, 안경, 열쇠, 리모컨, 지갑 등)과 놓인 위치를 기억해 줘"),
                UseCaseQuickChip("🔍 기억해둔 물건 위치 찾기", "내가 아까 둔 에어팟이나 안경, 열쇠가 어디에 있는지 기억해 둔 위치를 모두 알려줘"),
                UseCaseQuickChip("👕 외출 복장 얼룩/색상 점검", "지금 입은 옷의 색상 조합과 묻은 얼룩이나 먼지가 없는지 확인해 줘")
            )
        ),
        UseCaseCategoryTab(
            id = "PUBLIC_OFFICE",
            title = "🚻 공공시설·오피스",
            inputHint = "🚻 화장실, 카페 빈자리, 회의 슬라이드, 상대방 제스처 질문",
            chips = listOf(
                UseCaseQuickChip("🚻 화장실 남/녀 픽토그램·빈칸", "화장실 입구 표지판이 남자/여자 화장실 중 무엇인지, 안쪽 빈 칸(초록/빨강 표시)과 세면대 위치를 알려줘"),
                UseCaseQuickChip("🤝 상대방 명함/악수 제스처", "앞에 계신 분이 악수나 명함, 물건을 건네며 손을 내밀고 있는지 알려줘"),
                UseCaseQuickChip("📊 회의 화면/슬라이드 요약", "회의실 프로젝터나 모니터 발표 화면의 제목과 핵심 내용 2가지를 짧게 요약해 줘"),
                UseCaseQuickChip("☕ 카페 빈 좌석/바닥 장애물", "주변에 앉을 수 있는 빈 좌석이 몇 걸음 앞에 있는지와 바닥 가방/의자 장애물을 알려줘")
            )
        )
    )

    private val ioExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var locationManager: LocationManager? = null
    private var sensorManager: SensorManager? = null
    private var speechRecognizer: SpeechRecognizer? = null

    private var aiEnabled = false
    private var isListeningMic = false
    private var requestInFlight = false
    private var lastSpokenText: String? = null

    companion object {
        private const val REQ_PERMS = 1001
        private const val REALTIME_INTERVAL_MS = 4200L
    }

    private val gpsListener = object : LocationListener {
        override fun onLocationChanged(loc: Location) {
            WayfindingNavigator.currentLat = loc.latitude
            WayfindingNavigator.currentLng = loc.longitude
            WayfindingNavigator.hasGpsFix = true
            updateActiveNavBannerUi()
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    private val realtimeLoopRunnable = object : Runnable {
        override fun run() {
            if (!aiEnabled) return
            val isSpeaking = tts?.isSpeaking == true
            if (!isSpeaking && !isListeningMic && !requestInFlight) {
                runSingleInferenceStep(userQuery = "")
            }
            if (aiEnabled) {
                mainHandler.postDelayed(this, REALTIME_INTERVAL_MS)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        tts = TextToSpeech(this, this)
        requestRuntimePermissionsIfNeeded()
        startGpsAndCompassTracking()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0E14"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val topCameraCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 18, 24, 18)
            setBackgroundColor(Color.parseColor("#131926"))
        }

        // 1. Unified Interactive Command Bar (Text + Voice Input -> Simulates voice commands for Pilot testing, Fixes LUM-65 & LUM-66)
        val searchRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }
        }

        missionInput = EditText(this).apply {
            hint = "💬 명령/답변 입력 (예: 구의역 가자 / 지하철로 / 출발)"
            setHintTextColor(Color.parseColor("#94A3B8"))
            setTextColor(Color.WHITE)
            textSize = 13.5f
            setBackgroundColor(Color.parseColor("#0B0E14"))
            setPadding(20, 14, 20, 14)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 8, 0)
            }
            // LUM-71: Immediately interrupt TTS when user touches or starts typing in the input box!
            setOnClickListener { tts?.stop() }
            setOnFocusChangeListener { _, hasFocus -> if (hasFocus) tts?.stop() }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    if ((s?.length ?: 0) > 0) tts?.stop()
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }

        val sendCmdBtn = Button(this).apply {
            text = "💬 전송"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#FFD400"))
            setTextColor(Color.BLACK)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 6, 0)
            }
            setOnClickListener {
                val cmd = missionInput.text.toString().trim()
                if (cmd.isNotEmpty()) {
                    missionInput.setText("")
                    handleUserSpokenConversation(cmd)
                }
            }
        }

        val searchDestBtn = Button(this).apply {
            text = "🔍 장소검색"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#334155"))
            setTextColor(Color.WHITE)
            setOnClickListener {
                val query = missionInput.text.toString().trim()
                if (query.isEmpty()) {
                    WayfindingNavigator.clearRoute()
                    val msg = NativeLumoAiClient.startOrClearMission("")
                    candidateConfirmBox.visibility = View.GONE
                    activeNavBanner.visibility = View.GONE
                    speakNative(msg)
                } else {
                    missionInput.setText("")
                    searchDestinationAndPromptUser(query)
                }
            }
        }

        searchRow.addView(missionInput)
        searchRow.addView(sendCmdBtn)
        searchRow.addView(searchDestBtn)

        // 2. Origin & Destination Candidate Confirmation Panel (Hidden until search results arrive)
        candidateConfirmBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(18, 16, 18, 16)
            setBackgroundColor(Color.parseColor("#1E293B"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 12)
            }
        }

        // 3. Active Turn-by-Turn Pedestrian Route Banner
        activeNavBanner = TextView(this).apply {
            visibility = View.GONE
            setTextColor(Color.parseColor("#00E676"))
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#0B0E14"))
            setPadding(18, 12, 18, 12)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 12)
            }
        }

        // 4. AI Companion ON/OFF Toggle + Hands-Free Conversational Talk Button
        val toggleAndMicRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 12)
            }
        }

        aiToggleBtn = Button(this).apply {
            text = "🔴 AI동행: OFF"
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#3B1219"))
            setTextColor(Color.parseColor("#FFD7D7"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.1f).apply {
                setMargins(0, 0, 6, 0)
            }
            setOnClickListener {
                setAiToggleState(!aiEnabled)
            }
        }

        val stopSpeechBtn = Button(this).apply {
            text = "✋ 말끊기"
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#475569"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.85f).apply {
                setMargins(3, 0, 3, 0)
            }
            setOnClickListener {
                tts?.stop()
                stopInlineVoiceListening()
                SpatialEarconSynthesizer.play(EarconKind.BARGE_IN_ACK)
            }
        }

        talkMicBtn = Button(this).apply {
            text = "🎙️ 끊고말하기"
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#1E293B"))
            setTextColor(Color.parseColor("#FFD400"))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.05f).apply {
                setMargins(6, 0, 0, 0)
            }
            setOnClickListener {
                tts?.stop()
                startInlineVoiceListening()
            }
        }

        toggleAndMicRow.addView(aiToggleBtn)
        toggleAndMicRow.addView(stopSpeechBtn)
        toggleAndMicRow.addView(talkMicBtn)

        // 5. Live 1st-Person Rear Camera Preview
        cameraTextureView = TextureView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                260
            )
            surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
                    openRearCamera()
                }
                override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}
                override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                    closeRearCamera()
                    return true
                }
                override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
            }
        }

        // 0. 6-Category Multi-Use-Case Verification Tabs + One-Tap Quick Scenario Chips (Fixes LUMO-130)
        val categoryScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 8)
            }
        }
        categoryTabRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        categoryScroll.addView(categoryTabRow)

        val chipScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }
        }
        quickChipRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        chipScroll.addView(quickChipRow)

        topCameraCard.addView(categoryScroll)
        topCameraCard.addView(chipScroll)
        topCameraCard.addView(searchRow)
        topCameraCard.addView(candidateConfirmBox)
        topCameraCard.addView(activeNavBanner)
        topCameraCard.addView(toggleAndMicRow)
        topCameraCard.addView(cameraTextureView)

        renderUseCaseCategoryTabsAndChips()

        historyScrollView = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }

        historyContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 16, 24, 340)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        historyScrollView.addView(historyContainer)
        root.addView(topCameraCard)
        root.addView(historyScrollView)
        setContentView(root)

        renderHistoryList()
        ioExecutor.execute { FeedbackLogStore.trySyncToServerAsync(this) }
    }

    private fun renderUseCaseCategoryTabsAndChips() {
        categoryTabRow.removeAllViews()
        quickChipRow.removeAllViews()

        val activeCat = useCaseCategories.find { it.id == activeCategoryId } ?: useCaseCategories.first()
        NativeLumoAiClient.selectedUseCaseCategory = activeCat.id
        if (::missionInput.isInitialized) {
            missionInput.hint = activeCat.inputHint
        }

        for (cat in useCaseCategories) {
            val isSelected = cat.id == activeCat.id
            val tabBtn = Button(this).apply {
                text = cat.title
                textSize = 12.5f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(24, 10, 24, 10)
                setBackgroundColor(if (isSelected) Color.parseColor("#FFD400") else Color.parseColor("#1E293B"))
                setTextColor(if (isSelected) Color.BLACK else Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 0, 8, 0)
                }
                setOnClickListener {
                    activeCategoryId = cat.id
                    renderUseCaseCategoryTabsAndChips()
                }
            }
            categoryTabRow.addView(tabBtn)
        }

        for (chip in activeCat.chips) {
            val chipBtn = Button(this).apply {
                text = chip.label
                textSize = 12f
                setPadding(22, 8, 22, 8)
                setBackgroundColor(Color.parseColor("#0F172A"))
                setTextColor(Color.parseColor("#38BDF8"))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 0, 8, 0)
                }
                setOnClickListener {
                    tts?.stop()
                    runSingleInferenceStep(userQuery = chip.promptQuery)
                }
            }
            quickChipRow.addView(chipBtn)
        }
    }

    private fun logDialogueTurnAsFeedbackCard(
        modeTag: String,
        modeLabelKo: String,
        userCommand: String,
        agentSpoken: String,
        latencyMs: Long = 120L
    ) {
        val frameB64 = grabCurrentCameraFrame().base64Jpeg
        val displaySpoken = if (userCommand.isNotBlank()) {
            "[내 명령: $userCommand] → $agentSpoken"
        } else {
            agentSpoken
        }
        val replyObj = NativeLumoAiClient.AutoAiReply(
            ok = true,
            model = "lumo-dialogue-agent",
            detectedModeTag = modeTag,
            detectedModeLabelKo = modeLabelKo,
            activeWindowSummary = modeTag,
            earconKind = EarconKind.TARGET_FOUND,
            spokenKorean = displaySpoken,
            latencyMs = latencyMs
        )
        val saved = FeedbackLogStore.addEntry(this, replyObj, frameB64)
        FeedbackLogStore.trySyncToServerAsync(this)
        prependEntryCard(saved)
    }

    private fun searchDestinationAndPromptUser(query: String) {
        // Phase 1 of User Journey: Pause camera micro-guidance while conversing to set & confirm the mission!
        if (aiEnabled) {
            setAiToggleState(false)
        }
        val t0 = System.currentTimeMillis()
        SpatialEarconSynthesizer.play(EarconKind.SCANNING_TICK)
        candidateConfirmBox.removeAllViews()
        candidateConfirmBox.visibility = View.VISIBLE

        val loadingTv = TextView(this).apply {
            text = "⏳ 현재 GPS 출발지 확인 및 '$query' 검색 중..."
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 13.5f
        }
        candidateConfirmBox.addView(loadingTv)

        ioExecutor.execute {
            val searchRes = WayfindingNavigator.searchDestinationCandidates(query)
            val elapsed = System.currentTimeMillis() - t0
            runOnUiThread {
                renderSearchCandidateConfirmationUi(query, searchRes, sortByDistance = false)
                SpatialEarconSynthesizer.play(EarconKind.TARGET_FOUND)
                speakNative(searchRes.spokenConfirmationPromptKo)
                logDialogueTurnAsFeedbackCard(
                    modeTag = "DESTINATION_SEARCH",
                    modeLabelKo = "목적지 후보 검색 (${searchRes.candidatesRecommended.size}건)",
                    userCommand = "$query 검색",
                    agentSpoken = searchRes.spokenConfirmationPromptKo,
                    latencyMs = elapsed
                )
            }
        }
    }

    private fun renderSearchCandidateConfirmationUi(
        query: String,
        searchRes: WayfindingNavigator.SearchCandidatesResult,
        sortByDistance: Boolean
    ) {
        candidateConfirmBox.removeAllViews()

        val originTv = TextView(this).apply {
            text = "📍 출발지 확인: ${searchRes.originAddressKo}\n어느 목적지로 안내할까요? (추천순 / 거리순 선택 가능)"
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, 10)
        }
        candidateConfirmBox.addView(originTv)

        val sortTabRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }
        }

        val recTabBtn = Button(this).apply {
            text = "⭐ 추천순 (보행최적)"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(if (!sortByDistance) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (!sortByDistance) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 6, 0)
            }
            setOnClickListener {
                renderSearchCandidateConfirmationUi(query, searchRes, sortByDistance = false)
            }
        }

        val distTabBtn = Button(this).apply {
            text = "📏 거리순 (최단거리)"
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(if (sortByDistance) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (sortByDistance) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(6, 0, 0, 0)
            }
            setOnClickListener {
                renderSearchCandidateConfirmationUi(query, searchRes, sortByDistance = true)
            }
        }

        sortTabRow.addView(recTabBtn)
        sortTabRow.addView(distTabBtn)
        candidateConfirmBox.addView(sortTabRow)

        val activeList = if (sortByDistance) searchRes.candidatesByDistance else searchRes.candidatesRecommended
        for (cand in activeList) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    setMargins(0, 5, 0, 5)
                }
            }

            val transitBtn = Button(this).apply {
                text = "🚇 ${cand.index}번: ${cand.spokenPlaceWithAddrKo}\n(대중교통 약 ${cand.transitMinutes}분 · ${cand.distanceMeters}m)"
                textSize = 12f
                setBackgroundColor(Color.parseColor("#00E676"))
                setTextColor(Color.BLACK)
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.4f).apply {
                    setMargins(0, 0, 6, 0)
                }
                setOnClickListener {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = searchRes.originAddressKo,
                        originLat = searchRes.originLat,
                        originLng = searchRes.originLng,
                        candidate = cand,
                        preferTransit = true
                    )
                }
            }

            val walkBtn = Button(this).apply {
                text = "🚶 도보(${cand.walkMinutes}분)"
                textSize = 12f
                setBackgroundColor(Color.parseColor("#FFD400"))
                setTextColor(Color.BLACK)
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 0.7f)
                setOnClickListener {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = searchRes.originAddressKo,
                        originLat = searchRes.originLat,
                        originLng = searchRes.originLng,
                        candidate = cand,
                        preferTransit = false
                    )
                }
            }

            row.addView(transitBtn)
            row.addView(walkBtn)
            candidateConfirmBox.addView(row)
        }

        val cancelBtn = Button(this).apply {
            text = "❌ 검색 취소"
            textSize = 12.5f
            setBackgroundColor(Color.parseColor("#334155"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 6, 0, 0)
            }
            setOnClickListener {
                candidateConfirmBox.visibility = View.GONE
            }
        }
        candidateConfirmBox.addView(cancelBtn)
    }

    /**
     * Phase 2 of User Journey (Fixes LUM-53):
     * Builds the full Macro Route Plan (walk + bus/subway + transfers + total time) and presents it
     * to the user for explicit confirmation BEFORE starting real-time camera micro-guidance!
     */
    private fun confirmCandidateAndStartNavigation(
        originAddressKo: String,
        originLat: Double,
        originLng: Double,
        candidate: PoiCandidate,
        preferTransit: Boolean = candidate.distanceMeters >= 500,
        preferSubwayOnly: Boolean = true,
        conversationalPrefixKo: String = ""
    ) {
        if (aiEnabled) {
            setAiToggleState(false)
        }
        tts?.stop()
        val t0 = System.currentTimeMillis()
        candidateConfirmBox.removeAllViews()
        candidateConfirmBox.visibility = View.VISIBLE
        val modeStr = when {
            !preferTransit -> "도보 전용"
            preferSubwayOnly -> "지하철 노선+도보"
            else -> "버스/대중교통+도보"
        }
        val loadingTv = TextView(this).apply {
            text = "⏳ '${candidate.name}'까지 전체 $modeStr 이동 계획을 설계하고 있어요..."
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 13.5f
        }
        candidateConfirmBox.addView(loadingTv)

        ioExecutor.execute {
            val (route, macroPlanSpeech) = WayfindingNavigator.confirmAndBuildRoute(
                originAddressKo = originAddressKo,
                originLat = originLat,
                originLng = originLng,
                candidate = candidate,
                preferTransit = preferTransit,
                preferSubwayOnly = preferSubwayOnly
            )
            val finalSpeech = if (conversationalPrefixKo.isNotBlank()) {
                "$conversationalPrefixKo $macroPlanSpeech"
            } else {
                macroPlanSpeech
            }
            val elapsed = System.currentTimeMillis() - t0
            runOnUiThread {
                renderMacroPlanConfirmationUi(route, preferTransit, preferSubwayOnly)
                SpatialEarconSynthesizer.play(EarconKind.TARGET_FOUND)
                speakNative(finalSpeech)
                logDialogueTurnAsFeedbackCard(
                    modeTag = "MACRO_ROUTE_PLAN",
                    modeLabelKo = "전체 이동 계획 브리핑 ($modeStr)",
                    userCommand = "${candidate.name} ($modeStr)",
                    agentSpoken = finalSpeech,
                    latencyMs = elapsed
                )
            }
        }
    }

    private fun renderMacroPlanConfirmationUi(
        route: ActivePedestrianRoute,
        preferTransit: Boolean = true,
        preferSubwayOnly: Boolean = true
    ) {
        candidateConfirmBox.removeAllViews()
        candidateConfirmBox.visibility = View.VISIBLE

        val titleTv = TextView(this).apply {
            text = "🗺️ 전체 이동 계획 확인 (${route.originAddressKo} → ${route.destination.name})"
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, 8)
        }
        candidateConfirmBox.addView(titleTv)

        // LUM-68 & LUM-70: Mode Switch Tabs ([🚇 지하철 노선] | [🚌 버스 경로] | [🚶 도보 전용])
        val modeSwitchRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 10)
            }
        }

        val subModeBtn = Button(this).apply {
            text = "🚇 지하철노선"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            val active = preferTransit && preferSubwayOnly
            setBackgroundColor(if (active) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (active) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 4, 0)
            }
            setOnClickListener {
                confirmCandidateAndStartNavigation(
                    originAddressKo = route.originAddressKo,
                    originLat = route.originLat,
                    originLng = route.originLng,
                    candidate = route.destination,
                    preferTransit = true,
                    preferSubwayOnly = true,
                    conversationalPrefixKo = "네, 버스 대신 지하철 노선 계획으로 바꿔 드릴게요."
                )
            }
        }

        val busModeBtn = Button(this).apply {
            text = "🚌 버스경로"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            val active = preferTransit && !preferSubwayOnly
            setBackgroundColor(if (active) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (active) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(4, 0, 4, 0)
            }
            setOnClickListener {
                confirmCandidateAndStartNavigation(
                    originAddressKo = route.originAddressKo,
                    originLat = route.originLat,
                    originLng = route.originLng,
                    candidate = route.destination,
                    preferTransit = true,
                    preferSubwayOnly = false,
                    conversationalPrefixKo = "네, 버스 대중교통 계획으로 바꿔 드릴게요."
                )
            }
        }

        val walkModeBtn = Button(this).apply {
            text = "🚶 도보전용"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            val active = !preferTransit
            setBackgroundColor(if (active) Color.parseColor("#FFD400") else Color.parseColor("#334155"))
            setTextColor(if (active) Color.BLACK else Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(4, 0, 0, 0)
            }
            setOnClickListener {
                confirmCandidateAndStartNavigation(
                    originAddressKo = route.originAddressKo,
                    originLat = route.originLat,
                    originLng = route.originLng,
                    candidate = route.destination,
                    preferTransit = false,
                    preferSubwayOnly = false,
                    conversationalPrefixKo = "네, 걸어서 이동하는 도보 전용 계획으로 바꿔 드릴게요."
                )
            }
        }

        modeSwitchRow.addView(subModeBtn)
        modeSwitchRow.addView(busModeBtn)
        modeSwitchRow.addView(walkModeBtn)
        candidateConfirmBox.addView(modeSwitchRow)

        val summaryTv = TextView(this).apply {
            text = route.macroPlanOverviewKo
            setTextColor(Color.WHITE)
            textSize = 13.5f
            setPadding(0, 0, 0, 10)
        }
        candidateConfirmBox.addView(summaryTv)

        for (ms in route.macroMilestones) {
            val msTv = TextView(this).apply {
                text = "  • $ms"
                setTextColor(Color.parseColor("#00E676"))
                textSize = 12.8f
                setPadding(0, 2, 0, 2)
            }
            candidateConfirmBox.addView(msTv)
        }

        val startBtn = Button(this).apply {
            text = "🚀 네, 이 계획으로 출발 확정! (실시간 동행 시작)"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#00E676"))
            setTextColor(Color.BLACK)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 12, 0, 6)
            }
            setOnClickListener {
                startConfirmedMissionExecution()
            }
        }
        candidateConfirmBox.addView(startBtn)

        val backBtn = Button(this).apply {
            text = "🔄 다른 목적지 후보 다시 고르기"
            textSize = 12.5f
            setBackgroundColor(Color.parseColor("#334155"))
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 4, 0, 0)
            }
            setOnClickListener {
                val lastSearch = WayfindingNavigator.lastSearchResult
                if (lastSearch != null) {
                    renderSearchCandidateConfirmationUi(missionInput.text.toString(), lastSearch, sortByDistance = false)
                } else {
                    candidateConfirmBox.visibility = View.GONE
                }
            }
        }
        candidateConfirmBox.addView(backBtn)
    }

    /**
     * Phase 3 of User Journey:
     * Locks in the confirmed macro route plan and starts real-time camera + GPS + compass guidance.
     */
    private fun startConfirmedMissionExecution() {
        val startSpeech = WayfindingNavigator.activateConfirmedRoute()
        candidateConfirmBox.visibility = View.GONE
        updateActiveNavBannerUi()
        aiEnabled = true
        aiToggleBtn.text = "🟢 AI 동행: ON"
        aiToggleBtn.setBackgroundColor(Color.parseColor("#00E676"))
        aiToggleBtn.setTextColor(Color.BLACK)
        openRearCamera()
        SpatialEarconSynthesizer.play(EarconKind.SIGNAL_GREEN)
        speakNative(startSpeech)
        logDialogueTurnAsFeedbackCard(
            modeTag = "MISSION_STARTED",
            modeLabelKo = "미션 출발 확정 및 동행 시작",
            userCommand = "응 출발하자",
            agentSpoken = startSpeech,
            latencyMs = 50L
        )
        mainHandler.removeCallbacks(realtimeLoopRunnable)
        mainHandler.postDelayed(realtimeLoopRunnable, 5500L)
    }

    private fun updateActiveNavBannerUi() {
        val route = WayfindingNavigator.activeRoute
        if (route == null) {
            activeNavBanner.visibility = View.GONE
            return
        }
        val liveCtx = WayfindingNavigator.buildLiveNavContextForPrompt()
        activeNavBanner.visibility = View.VISIBLE
        activeNavBanner.text = "🧭 $liveCtx"
    }

    @SuppressLint("MissingPermission")
    private fun startGpsAndCompassTracking() {
        try {
            locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val hasFine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val hasCoarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (hasFine || hasCoarse) {
                val providers = listOf("fused", LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
                var bestLoc: Location? = null
                for (p in providers) {
                    try {
                        val loc = locationManager?.getLastKnownLocation(p) ?: continue
                        if (bestLoc == null || loc.time > bestLoc.time) {
                            bestLoc = loc
                        }
                    } catch (_: Exception) {}
                }
                if (bestLoc != null) {
                    WayfindingNavigator.currentLat = bestLoc.latitude
                    WayfindingNavigator.currentLng = bestLoc.longitude
                    WayfindingNavigator.hasGpsFix = true
                }
                for (p in listOf("fused", LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                    try {
                        locationManager?.requestLocationUpdates(p, 2500L, 2f, gpsListener, Looper.getMainLooper())
                    } catch (_: Exception) {}
                }
            }
        } catch (_: Exception) {}

        try {
            sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
            val rotSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
            if (rotSensor != null) {
                sensorManager?.registerListener(this, rotSensor, SensorManager.SENSOR_DELAY_UI)
            }
        } catch (_: Exception) {}
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type == Sensor.TYPE_ROTATION_VECTOR) {
            val rotMatrix = FloatArray(9)
            val orientation = FloatArray(3)
            SensorManager.getRotationMatrixFromVector(rotMatrix, event.values)
            SensorManager.getOrientation(rotMatrix, orientation)
            val azimuthDeg = ((Math.toDegrees(orientation[0].toDouble()).toFloat()) + 360f) % 360f
            WayfindingNavigator.currentCompassHeadingDeg = azimuthDeg
            WayfindingNavigator.hasCompassFix = true
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun setAiToggleState(enabled: Boolean) {
        aiEnabled = enabled
        mainHandler.removeCallbacks(realtimeLoopRunnable)

        if (aiEnabled) {
            aiToggleBtn.text = "🟢 AI 동행: ON"
            aiToggleBtn.setBackgroundColor(Color.parseColor("#00E676"))
            aiToggleBtn.setTextColor(Color.BLACK)
            openRearCamera()
            SpatialEarconSynthesizer.play(EarconKind.SIGNAL_GREEN)
            runSingleInferenceStep(userQuery = "")
            mainHandler.postDelayed(realtimeLoopRunnable, REALTIME_INTERVAL_MS)
        } else {
            aiToggleBtn.text = "🔴 AI 동행: OFF"
            aiToggleBtn.setBackgroundColor(Color.parseColor("#3B1219"))
            aiToggleBtn.setTextColor(Color.parseColor("#FFD7D7"))
            stopInlineVoiceListening()
            tts?.stop()
            SpatialEarconSynthesizer.play(EarconKind.BARGE_IN_ACK)
        }
    }

    private fun startInlineVoiceListening() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestRuntimePermissionsIfNeeded()
            return
        }
        tts?.stop()
        SpatialEarconSynthesizer.play(EarconKind.SCANNING_TICK)

        try {
            if (speechRecognizer == null && SpeechRecognizer.isRecognitionAvailable(this)) {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
                    setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) {
                            isListeningMic = true
                            talkMicBtn.text = "👂 듣고 있어요..."
                            talkMicBtn.setBackgroundColor(Color.parseColor("#FFD400"))
                            talkMicBtn.setTextColor(Color.BLACK)
                        }
                        override fun onBeginningOfSpeech() {}
                        override fun onRmsChanged(rmsdB: Float) {}
                        override fun onBufferReceived(buffer: ByteArray?) {}
                        override fun onEndOfSpeech() {
                            isListeningMic = false
                            talkMicBtn.text = "🎙️ 루모에게 말하기"
                            talkMicBtn.setBackgroundColor(Color.parseColor("#1E293B"))
                            talkMicBtn.setTextColor(Color.parseColor("#FFD400"))
                        }
                        override fun onError(error: Int) {
                            isListeningMic = false
                            talkMicBtn.text = "🎙️ 루모에게 말하기"
                            talkMicBtn.setBackgroundColor(Color.parseColor("#1E293B"))
                            talkMicBtn.setTextColor(Color.parseColor("#FFD400"))
                        }
                        override fun onResults(results: Bundle?) {
                            isListeningMic = false
                            talkMicBtn.text = "🎙️ 루모에게 말하기"
                            talkMicBtn.setBackgroundColor(Color.parseColor("#1E293B"))
                            talkMicBtn.setTextColor(Color.parseColor("#FFD400"))
                            val spoken = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                                ?.firstOrNull()?.trim() ?: return
                            handleUserSpokenConversation(spoken)
                        }
                        override fun onPartialResults(partialResults: Bundle?) {}
                        override fun onEvent(eventType: Int, params: Bundle?) {}
                    })
                }
            }

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            speechRecognizer?.startListening(intent)
        } catch (_: Exception) {}
    }

    private fun stopInlineVoiceListening() {
        isListeningMic = false
        try { speechRecognizer?.cancel() } catch (_: Exception) {}
        talkMicBtn.text = "🎙️ 루모에게 말하기"
        talkMicBtn.setBackgroundColor(Color.parseColor("#1E293B"))
        talkMicBtn.setTextColor(Color.parseColor("#FFD400"))
    }

    /**
     * Handles natural user speech:
     * 1. If destination candidates are currently waiting for confirmation and user says "1번", "첫 번째", "에브리데이", "역삼점", confirms that candidate!
     * 2. If user says "이마트 가자" / "강남역 안내해줘", runs TMAP destination search!
     * 3. Otherwise sends the user's question + live camera frame into the multi-turn conversational Gemini agent!
     */
    private fun handleUserSpokenConversation(spoken: String) {
        tts?.stop()
        if (spoken.contains("그만") || spoken.contains("멈춰") || spoken.contains("조용")) {
            return
        }

        // UC-15: Register expected taxi plate when user types/says "택시 34바 5678" or "장콜 12가 3456"
        val taxiMatch = Regex("(?:택시|장콜|차량|번호판?)\\s*(\\d{2,3}\\s*[가-힣]\\s*\\d{4})").find(spoken)
        if (taxiMatch != null) {
            val plate = taxiMatch.groupValues[1].trim()
            NativeLumoAiClient.expectedTaxiPlate = plate
            val msg = "호출하신 차량 번호 $plate 번을 등록했어요. 이제 진입하는 차량을 카메라로 비추시면 번호판과 뒷좌석 문 손잡이 위치를 안내해 드릴게요."
            speakNative(msg)
            logDialogueTurnAsFeedbackCard("TAXI_REGISTERED", "호출 택시 번호 등록 ($plate)", spoken, msg)
            return
        }

        // LUM-68, LUM-69, LUM-70: If user says "아니 지하철 탄다고" / "아니 지하철로 대중교통" / "버스 말고 지하철"
        // while a destination route or search is active, switch the transport mode of the active mission instead of hallucinating a POI or describing the floor!
        val activeRt = WayfindingNavigator.activeRoute
        val lastSearch = WayfindingNavigator.lastSearchResult
        val targetDest: PoiCandidate? = activeRt?.destination ?: lastSearch?.candidatesRecommended?.firstOrNull()
        val originAddr: String = activeRt?.originAddressKo ?: lastSearch?.originAddressKo ?: WayfindingNavigator.reverseGeocodeOrigin(WayfindingNavigator.currentLat, WayfindingNavigator.currentLng)
        val oLat = activeRt?.originLat ?: lastSearch?.originLat ?: WayfindingNavigator.currentLat
        val oLng = activeRt?.originLng ?: lastSearch?.originLng ?: WayfindingNavigator.currentLng

        val cleanedPlaceCandidate = WayfindingNavigator.extractCleanPlaceQuery(spoken)
        val isTransportSwitchUtterance =
            Regex("지하철|버스|도보|걸어서|노선").containsMatchIn(spoken) &&
                (cleanedPlaceCandidate.isEmpty() || spoken.startsWith("아니") || spoken.contains("말고") || spoken.contains("탄다고") || spoken.contains("탈래"))

        if (isTransportSwitchUtterance && targetDest != null) {
            when {
                spoken.contains("지하철") || spoken.contains("노선") -> {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = originAddr,
                        originLat = oLat,
                        originLng = oLng,
                        candidate = targetDest,
                        preferTransit = true,
                        preferSubwayOnly = true,
                        conversationalPrefixKo = "아, 버스를 타지 않고 지하철로 이동하시겠어요? 바로 ${targetDest.name}까지 가는 지하철 노선 계획으로 바꿔 드릴게요."
                    )
                    return
                }
                spoken.contains("버스") -> {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = originAddr,
                        originLat = oLat,
                        originLng = oLng,
                        candidate = targetDest,
                        preferTransit = true,
                        preferSubwayOnly = false,
                        conversationalPrefixKo = "네, ${targetDest.name}까지 버스로 이동하는 대중교통 계획으로 바꿔 드릴게요."
                    )
                    return
                }
                spoken.contains("도보") || spoken.contains("걸어서") -> {
                    confirmCandidateAndStartNavigation(
                        originAddressKo = originAddr,
                        originLat = oLat,
                        originLng = oLng,
                        candidate = targetDest,
                        preferTransit = false,
                        preferSubwayOnly = false,
                        conversationalPrefixKo = "네, 대중교통을 타지 않고 걸어서 이동하는 도보 계획으로 바꿔 드릴게요."
                    )
                    return
                }
            }
        }

        // If awaiting Phase 2 Macro Plan confirmation ("이 계획대로 출발할까요?") and user says "응/출발/좋아/네/시작"
        val currentRoute = WayfindingNavigator.activeRoute
        if (currentRoute != null && !currentRoute.isConfirmedByUser && candidateConfirmBox.visibility == View.VISIBLE) {
            if (Regex("^(?:응|네|좋아|출발|시작|그렇게|오케이|그래)").containsMatchIn(spoken.trim())) {
                startConfirmedMissionExecution()
                return
            }
        }

        val pendingSearch = WayfindingNavigator.lastSearchResult
        if (pendingSearch != null && candidateConfirmBox.visibility == View.VISIBLE) {
            val cands = pendingSearch.candidatesRecommended
            val numMatch = Regex("(\\d+)\\s*번").find(spoken)?.groupValues?.get(1)?.toIntOrNull()
            val matchedCand = when {
                numMatch != null -> cands.getOrNull(numMatch - 1)
                spoken.contains("첫") -> cands.getOrNull(0)
                spoken.contains("두") -> cands.getOrNull(1)
                spoken.contains("세") -> cands.getOrNull(2)
                else -> cands.find { spoken.contains(it.name) || (spoken.contains("에브리데이") && it.name.contains("에브리데이")) }
            }
            if (matchedCand != null) {
                val wantWalkOnly = spoken.contains("도보") || spoken.contains("걸어서")
                val wantTransit = spoken.contains("대중교통") || spoken.contains("지하철") || spoken.contains("버스") || (!wantWalkOnly && matchedCand.distanceMeters >= 500)
                confirmCandidateAndStartNavigation(
                    originAddressKo = pendingSearch.originAddressKo,
                    originLat = pendingSearch.originLat,
                    originLng = pendingSearch.originLng,
                    candidate = matchedCand,
                    preferTransit = wantTransit
                )
                return
            }
        }

        val navTrigger = Regex("(.+?)(?:으로|로)?\\s*(?:가자|안내해|길찾기|찾아줘|갈래|가고\\s*싶어|가는\\s*길)").find(spoken)
        if (navTrigger != null) {
            val placeKeyword = navTrigger.groupValues[1]
                .replace(Regex("^(루모야?|루모|지금|여기서|근처|나)\\s*"), "")
                .trim()
            if (placeKeyword.length >= 2) {
                searchDestinationAndPromptUser(placeKeyword)
                return
            }
        }

        // If user just typed a station or place name directly (e.g. "구의역", "이마트")
        if (spoken.endsWith("역") || spoken.contains("이마트") || spoken.contains("마트") || spoken.contains("백화점") || spoken.contains("약국") || spoken.contains("병원")) {
            if (spoken.length <= 12 && !spoken.contains("?")) {
                searchDestinationAndPromptUser(spoken)
                return
            }
        }

        runSingleInferenceStep(userQuery = spoken)
    }

    private data class CapturedFrameResult(
        val base64Jpeg: String?,
        val isTooDark: Boolean,
        val isLowLightZone: Boolean,
        val hasHighGlare: Boolean
    )

    private fun analyzeFrameLuminance(bmp: Bitmap): Triple<Boolean, Boolean, Boolean> {
        var sumLum = 0L
        var glarePixels = 0
        var count = 0
        val stepX = maxOf(1, bmp.width / 12)
        val stepY = maxOf(1, bmp.height / 12)
        for (y in 0 until bmp.height step stepY) {
            for (x in 0 until bmp.width step stepX) {
                val px = bmp.getPixel(x, y)
                val r = (px shr 16) and 0xFF
                val g = (px shr 8) and 0xFF
                val b = px and 0xFF
                val lum = (r * 299 + g * 587 + b * 114) / 1000
                sumLum += lum
                if (lum >= 242) glarePixels++
                count++
            }
        }
        val avgLum = if (count > 0) sumLum / count else 0L
        val glareRatio = if (count > 0) glarePixels.toFloat() / count else 0f
        val isTooDark = avgLum < 12L
        val isLowLight = avgLum in 12L..52L // UC-18: Night blindness / sudden indoor dark adaptation zone
        val hasHighGlare = glareRatio >= 0.32f // UC-19: Strong backlight / LED glare white-out zone
        return Triple(isTooDark, isLowLight, hasHighGlare)
    }

    private fun grabCurrentCameraFrame(): CapturedFrameResult {
        if (!cameraTextureView.isAvailable) return CapturedFrameResult(null, false, false, false)
        val bmp: Bitmap = cameraTextureView.getBitmap(384, 288) ?: return CapturedFrameResult(null, false, false, false)
        val (tooDark, lowLight, highGlare) = analyzeFrameLuminance(bmp)
        val baos = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 60, baos)
        val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
        return CapturedFrameResult(b64, tooDark, lowLight, highGlare)
    }

    private fun runSingleInferenceStep(userQuery: String = "") {
        if (requestInFlight) return
        requestInFlight = true

        updateActiveNavBannerUi()
        val captured = grabCurrentCameraFrame()
        if (captured.isTooDark && userQuery.isBlank()) {
            requestInFlight = false
            val darkReply = NativeLumoAiClient.AutoAiReply(
                ok = true,
                model = "on-device-luminance-guard",
                detectedModeTag = "DARK_FRAME",
                detectedModeLabelKo = "카메라 가림 · 어두움 감지",
                activeWindowSummary = "DARK_GUARD",
                earconKind = EarconKind.SCANNING_TICK,
                spokenKorean = "카메라 화면이 너무 어둡거나 가려져 있어요. 렌즈 앞을 한번 확인해 주실래요?",
                latencyMs = 5L
            )
            val saved = FeedbackLogStore.addEntry(this, darkReply, captured.base64Jpeg)
            if (aiEnabled) {
                speakNative(darkReply.spokenKorean)
            }
            prependEntryCard(saved)
            return
        }

        SpatialEarconSynthesizer.play(EarconKind.SCANNING_TICK)

        val lightingHint = when {
            captured.isLowLightZone -> " (현재 어두운 저조도 구간 진입: 바닥 평탄도와 난간/벽면 동선을 안심할 수 있게 설명해 주세요)"
            captured.hasHighGlare -> " (현재 역광/빛번짐 눈부심 구간: 저시력자가 읽기 힘든 전광판·표지판·신호등 글자를 대신 정확히 읽어 주세요)"
            else -> ""
        }

        ioExecutor.execute {
            val reply = NativeLumoAiClient.analyzeAutoSceneFlashLite(
                userQuery = (userQuery + lightingHint).trim(),
                imageBase64Jpeg = captured.base64Jpeg,
                previousSpeech = lastSpokenText
            )
            val savedEntry = FeedbackLogStore.addEntry(
                context = this,
                reply = reply,
                imageBase64 = captured.base64Jpeg
            )
            FeedbackLogStore.trySyncToServerAsync(this)

            runOnUiThread {
                requestInFlight = false
                lastSpokenText = reply.spokenKorean

                // Execute Single-Pass LLM Tool Call (`NAV_CONTROL`) if Gemini emitted a navigation action!
                if (!reply.navAction.isNullOrBlank()) {
                    val activeRt = WayfindingNavigator.activeRoute
                    val lastSearch = WayfindingNavigator.lastSearchResult
                    val targetDest = activeRt?.destination ?: lastSearch?.candidatesRecommended?.firstOrNull()
                    val originAddr = activeRt?.originAddressKo ?: lastSearch?.originAddressKo ?: WayfindingNavigator.reverseGeocodeOrigin(WayfindingNavigator.currentLat, WayfindingNavigator.currentLng)
                    val oLat = activeRt?.originLat ?: lastSearch?.originLat ?: WayfindingNavigator.currentLat
                    val oLng = activeRt?.originLng ?: lastSearch?.originLng ?: WayfindingNavigator.currentLng

                    when (reply.navAction) {
                        "SWITCH_SUBWAY" -> if (targetDest != null) {
                            confirmCandidateAndStartNavigation(originAddr, oLat, oLng, targetDest, preferTransit = true, preferSubwayOnly = true, conversationalPrefixKo = reply.spokenKorean)
                            return@runOnUiThread
                        }
                        "SWITCH_BUS" -> if (targetDest != null) {
                            confirmCandidateAndStartNavigation(originAddr, oLat, oLng, targetDest, preferTransit = true, preferSubwayOnly = false, conversationalPrefixKo = reply.spokenKorean)
                            return@runOnUiThread
                        }
                        "SWITCH_WALK" -> if (targetDest != null) {
                            confirmCandidateAndStartNavigation(originAddr, oLat, oLng, targetDest, preferTransit = false, preferSubwayOnly = false, conversationalPrefixKo = reply.spokenKorean)
                            return@runOnUiThread
                        }
                        "SEARCH_PLACE" -> if (!reply.navTargetPlace.isNullOrBlank()) {
                            searchDestinationAndPromptUser(reply.navTargetPlace)
                            return@runOnUiThread
                        }
                        "SELECT_CANDIDATE" -> {
                            val idx = (reply.navCandidateIndex ?: 1) - 1
                            val cand = lastSearch?.candidatesRecommended?.getOrNull(idx)
                            if (cand != null && lastSearch != null) {
                                confirmCandidateAndStartNavigation(lastSearch.originAddressKo, lastSearch.originLat, lastSearch.originLng, cand, preferTransit = cand.distanceMeters >= 500, preferSubwayOnly = true)
                                return@runOnUiThread
                            }
                        }
                        "CONFIRM_START" -> if (activeRt != null) {
                            startConfirmedMissionExecution()
                            return@runOnUiThread
                        }
                    }
                }

                if (aiEnabled || userQuery.isNotBlank()) {
                    SpatialEarconSynthesizer.play(reply.earconKind)
                    speakNative(reply.spokenKorean)
                }
                prependEntryCard(savedEntry)
            }
        }
    }

    private fun renderHistoryList() {
        historyContainer.removeAllViews()
        val list = FeedbackLogStore.listEntries(this)
        for (entry in list) {
            historyContainer.addView(buildEntryCard(entry))
        }
    }

    private fun prependEntryCard(entry: InferenceFeedbackEntry) {
        historyContainer.addView(buildEntryCard(entry), 0)
    }

    private fun buildEntryCard(entry: InferenceFeedbackEntry): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 22, 24, 22)
            setBackgroundColor(Color.parseColor("#161D2B"))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                setMargins(0, 0, 0, 22)
            }
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
        }

        val thumbView = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(210, 160).apply {
                setMargins(0, 0, 20, 0)
            }
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(Color.BLACK)
            if (!entry.imageBase64.isNullOrBlank()) {
                try {
                    val bytes = Base64.decode(entry.imageBase64, Base64.DEFAULT)
                    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    setImageBitmap(bmp)
                } catch (_: Exception) {}
            }
        }

        val metaCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        val modeLabel = TextView(this).apply {
            text = "🤖 추론 상황: [${entry.detectedMode}] ${entry.detectedModeLabelKo}"
            setTextColor(Color.parseColor("#FFD400"))
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
        }

        val timeMeta = TextView(this).apply {
            text = "🕒 ${entry.displayTime}  ·  ⏱️ ${entry.latencyMs}ms"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12.5f
            setPadding(0, 4, 0, 6)
        }

        val speechText = TextView(this).apply {
            text = "\"${entry.spokenKorean}\""
            setTextColor(Color.WHITE)
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
        }

        metaCol.addView(modeLabel)
        metaCol.addView(timeMeta)
        metaCol.addView(speechText)

        topRow.addView(thumbView)
        topRow.addView(metaCol)

        val voteRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 16, 0, 8)
        }

        lateinit var upBtn: Button
        lateinit var downBtn: Button

        fun styleVoteButtons(currentVote: String) {
            if (currentVote == "UP") {
                upBtn.setBackgroundColor(Color.parseColor("#00E676"))
                upBtn.setTextColor(Color.BLACK)
            } else {
                upBtn.setBackgroundColor(Color.parseColor("#243044"))
                upBtn.setTextColor(Color.WHITE)
            }
            if (currentVote == "DOWN") {
                downBtn.setBackgroundColor(Color.parseColor("#FF5252"))
                downBtn.setTextColor(Color.WHITE)
            } else {
                downBtn.setBackgroundColor(Color.parseColor("#243044"))
                downBtn.setTextColor(Color.WHITE)
            }
        }

        upBtn = Button(this).apply {
            text = "👍 추천"
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 8, 0)
            }
            setOnClickListener {
                val next = if (entry.vote == "UP") "NONE" else "UP"
                entry.vote = next
                styleVoteButtons(next)
                saveEntryFeedbackAsync(entry)
            }
        }

        downBtn = Button(this).apply {
            text = "👎 비추천"
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(8, 0, 0, 0)
            }
            setOnClickListener {
                val next = if (entry.vote == "DOWN") "NONE" else "DOWN"
                entry.vote = next
                styleVoteButtons(next)
                saveEntryFeedbackAsync(entry)
            }
        }

        styleVoteButtons(entry.vote)
        voteRow.addView(upBtn)
        voteRow.addView(downBtn)

        val memoRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val feedbackInput = EditText(this).apply {
            hint = "상세 피드백 입력 (터치 시 상단 화면이 접혀 넓게 보입니다)"
            setHintTextColor(Color.parseColor("#64748B"))
            setText(entry.feedbackText)
            setTextColor(Color.WHITE)
            textSize = 14f
            minLines = 2
            maxLines = 5
            setBackgroundColor(Color.parseColor("#0B0E14"))
            setPadding(20, 16, 20, 16)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, 0, 12, 0)
            }
            // LUM-72 Fix: Collapse top camera preview & candidate panels while typing feedback so the input box is NEVER covered!
            setOnFocusChangeListener { _, hasFocus ->
                if (hasFocus) {
                    tts?.stop()
                    cameraTextureView.visibility = View.GONE
                    candidateConfirmBox.visibility = View.GONE
                    activeNavBanner.maxLines = 1
                    historyScrollView.postDelayed({
                        historyScrollView.smoothScrollTo(0, maxOf(0, card.top - 20))
                    }, 180L)
                } else {
                    cameraTextureView.visibility = View.VISIBLE
                    activeNavBanner.maxLines = 4
                }
            }
            setOnClickListener {
                tts?.stop()
                cameraTextureView.visibility = View.GONE
                candidateConfirmBox.visibility = View.GONE
                historyScrollView.postDelayed({
                    historyScrollView.smoothScrollTo(0, maxOf(0, card.top - 20))
                }, 180L)
            }
        }

        val saveMemoBtn = Button(this).apply {
            text = "저장"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setBackgroundColor(Color.parseColor("#FFD400"))
            setTextColor(Color.BLACK)
            setOnClickListener {
                entry.feedbackText = feedbackInput.text.toString().trim()
                saveEntryFeedbackAsync(entry)
                feedbackInput.clearFocus()
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
                imm?.hideSoftInputFromWindow(feedbackInput.windowToken, 0)
                cameraTextureView.visibility = View.VISIBLE
                Toast.makeText(this@MainActivity, "피드백이 저장되었습니다.", Toast.LENGTH_SHORT).show()
            }
        }

        memoRow.addView(feedbackInput)
        memoRow.addView(saveMemoBtn)

        card.addView(topRow)
        card.addView(voteRow)
        card.addView(memoRow)
        return card
    }

    private fun saveEntryFeedbackAsync(entry: InferenceFeedbackEntry) {
        ioExecutor.execute {
            FeedbackLogStore.updateFeedback(
                context = this,
                id = entry.id,
                vote = entry.vote,
                feedbackText = entry.feedbackText
            )
            FeedbackLogStore.trySyncToServerAsync(this)
        }
    }

    @SuppressLint("MissingPermission")
    private fun openRearCamera() {
        if (cameraDevice != null) return
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return
        val surfaceTexture = cameraTextureView.surfaceTexture ?: return

        try {
            val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val rearCameraId = manager.cameraIdList.firstOrNull { id ->
                val chars = manager.getCameraCharacteristics(id)
                chars.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
            } ?: manager.cameraIdList.firstOrNull() ?: return

            surfaceTexture.setDefaultBufferSize(640, 480)
            val previewSurface = Surface(surfaceTexture)

            manager.openCamera(rearCameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    try {
                        val reqBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                            addTarget(previewSurface)
                        }
                        camera.createCaptureSession(
                            listOf(previewSurface),
                            object : CameraCaptureSession.StateCallback() {
                                override fun onConfigured(session: CameraCaptureSession) {
                                    captureSession = session
                                    try {
                                        session.setRepeatingRequest(reqBuilder.build(), null, mainHandler)
                                    } catch (_: Exception) {}
                                }
                                override fun onConfigureFailed(session: CameraCaptureSession) {}
                            },
                            mainHandler
                        )
                    } catch (_: Exception) {}
                }

                override fun onDisconnected(camera: CameraDevice) {
                    camera.close()
                    cameraDevice = null
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    camera.close()
                    cameraDevice = null
                }
            }, mainHandler)
        } catch (_: Exception) {}
    }

    private fun closeRearCamera() {
        try {
            captureSession?.close()
            captureSession = null
            cameraDevice?.close()
            cameraDevice = null
        } catch (_: Exception) {}
    }

    private fun requestRuntimePermissionsIfNeeded() {
        val perms = arrayOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        val missing = perms.filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            requestPermissions(missing.toTypedArray(), REQ_PERMS)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMS) {
            startGpsAndCompassTracking()
            if (cameraTextureView.isAvailable) {
                openRearCamera()
            }
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.KOREAN
            tts?.setSpeechRate(1.08f)
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) {
                    // When Lumo finishes asking a question (e.g. "어디로 안내해 드릴까요?", "출발할까요?"),
                    // automatically open the inline microphone for hands-free conversational reply!
                    if (utteranceId?.startsWith("lumo_question_") == true) {
                        mainHandler.postDelayed({ startInlineVoiceListening() }, 250L)
                    }
                }
                override fun onError(utteranceId: String?) {}
            })
        }
    }

    private fun speakNative(text: String) {
        val naturalSpeech = NativeLumoAiClient.cleanMovementRelativeDirection(text)
        val isQuestion = naturalSpeech.endsWith("?") || naturalSpeech.endsWith("까요") || naturalSpeech.endsWith("래요")
        val utterId = if (isQuestion) {
            "lumo_question_${System.currentTimeMillis()}"
        } else {
            "lumo_native_${System.currentTimeMillis()}"
        }
        tts?.speak(naturalSpeech, TextToSpeech.QUEUE_FLUSH, null, utterId)
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        try { locationManager?.removeUpdates(gpsListener) } catch (_: Exception) {}
        try { sensorManager?.unregisterListener(this) } catch (_: Exception) {}
        try { speechRecognizer?.destroy() } catch (_: Exception) {}
        closeRearCamera()
        tts?.stop()
        tts?.shutdown()
        ioExecutor.shutdownNow()
        super.onDestroy()
    }
}
