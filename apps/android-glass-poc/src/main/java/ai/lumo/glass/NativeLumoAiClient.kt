package ai.lumo.glass

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * 2-Layer Stateful Skill Harness for Android Smart Glasses / Phone Companion (Field-Test Hardened):
 * - Fixes LUM-17: Rejects `None`/`null`/`알수없음` slots and never hallucinates platform match on dark/unreadable frames.
 * - Fixes LUM-18/21/22/24/25/28: 18s readTimeout + automatic retry on transient subway LTE/5G drops + 160 maxOutputTokens.
 * - Fixes LUM-19: Active View-Finding Coaching ("스크린도어 쪽으로 3~4걸음 다가서서 상단 표지판을 바라봐 주세요") when signs are illegible.
 * - Fixes LUM-20/26/27/29: Persistent Top-Priority Mission Context + Pre-Departure Transit Card Check + Stage Progress + Live Seoul Bus/Subway Mapping.
 * - Fixes LUM-23: Movement-relative natural Korean directions ("지금 걸어가시는 정면 직진", "진행 방향 오른쪽/왼쪽") instead of "12시 방향".
 */
object NativeLumoAiClient {
    const val CHEAPEST_FAST_MODEL = "gemini-3.5-flash-lite"

    private val INVALID_SLOTS = setOf(
        "none", "null", "undefined", "n/a", "unknown",
        "알수없음", "알 수 없음", "미상", "없음", "?", "-"
    )

    fun isValidSlot(v: String?): Boolean {
        if (v.isNullOrBlank()) return false
        return v.trim().lowercase() !in INVALID_SLOTS
    }

    private val conversationHistory = mutableListOf<Pair<String, String>>()

    @Synchronized
    fun recordConversationTurn(role: String, text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        conversationHistory.add(role to clean)
        if (conversationHistory.size > 8) {
            conversationHistory.removeAt(0)
        }
    }

    @Synchronized
    private fun getRecentConversationLines(): List<String> {
        return conversationHistory.takeLast(5).map { (role, txt) ->
            val speaker = if (role == "user") "사용자" else "루모"
            "  - $speaker: \"$txt\""
        }
    }

    fun cleanMovementRelativeDirection(text: String): String {
        var raw = text
        if (raw.contains("%")) {
            try {
                raw = java.net.URLDecoder.decode(raw, "UTF-8")
            } catch (_: Exception) {}
        }
        // 1. Strip any bracketed tags `[...]`, arrows `→`/`->`, parens `(...)`, and symbols so TTS never reads punctuation
        var cleaned = raw
            .replace(Regex("\\[(?:수도권|서울)?(\\d+호선|신분당선|경의중앙선|수인분당선|공항철도)]"), " $1 ")
            .replace(Regex("\\[(?:간선|지선|광역|마을|수도권)\\s*:\\s*([^\\]]+)]"), "$1번 ")
            .replace(Regex("\\[[^\\]]*]"), " ")
            .replace(Regex("\\s*(?:→|->|▶|➔|⇒)\\s*"), "에서 ")
            .replace(Regex("\\(([^)]+)\\)"), ", $1, ")
            .replace(Regex("[·|•*#\"`~_]"), " ")
            .replace(Regex("(\\d+)\\s*/\\s*(\\d+)단계"), "$2단계 중 $1단계")

        // 2. Replace clock-face and visual-only color/light terms (LUM-23, LUM-45, LUM-75, LUM-86)
        cleaned = cleaned
            .replace("정면 12시 방향", "지금 걸어가시는 정면")
            .replace("12시 방향", "지금 걸어가시는 정면")
            .replace("11시 방향", "진행 방향 왼쪽 대각선 앞")
            .replace("10시 방향", "진행 방향 왼쪽 앞")
            .replace("1시 방향", "진행 방향 오른쪽 대각선 앞")
            .replace("2시 방향", "진행 방향 오른쪽 앞")
            .replace("9시 방향", "왼쪽")
            .replace("3시 방향", "오른쪽")
            .replace(Regex("밝은\\s*색상의?\\s*보행로"), "보행로")
            .replace(Regex("어두운\\s*색상의?\\s*보행로"), "보행로")
            .replace(Regex("(?:초록빛|파란빛|노란빛|붉은빛)\\s*조명이\\s*보이는\\s*"), "")
            .replace(Regex("플랫폼의?\\s*노란\\s*안전선"), "승강장 안전선")
            .replace("노란색 점자블록", "발바닥으로 느껴지는 점자블록")
            .replace(Regex("자리가\\s*비어\\s*있다면\\s*조심히\\s*앉아서\\s*다음\\s*안내를\\s*기다려\\s*볼까요\\??"), "출입문 옆 손잡이를 안전하게 잡고 계세요.")
            .replace(Regex("\\s+"), " ")
            .replace(Regex("\\s*,\\s*,+"), ", ")
            .trim()
            .removePrefix(",")
            .removeSuffix(",")
            .trim()

        // 3. LUM-49 & LUM-50 vs LUM-79 & LUM-89: Never trigger indoor window dead-end warning when inside a subway train!
        val isInsideTrain = Regex("지하철|열차|객차|정거장|승강장|출입문|손잡이").containsMatchIn(cleaned)
        if (isInsideTrain && Regex("(바로\\s*앞은\\s*(?:지하철\\s*)?창문이라\\s*막혀|창문에서\\s*몸을\\s*(?:살짝\\s*)?돌려)").containsMatchIn(cleaned)) {
            val subProg = WayfindingNavigator.computeLiveSubwayProgressForPrompt()
            return if (subProg.isNotBlank()) {
                "지금 지하철 출입문 앞에 안전하게 서 계시네요. 손잡이를 잘 잡고 계세요."
            } else {
                "지하철 열차 안 출입문 앞에 안전하게 서 계시네요. 손잡이를 잘 잡고 도착 안내를 기다려 주세요."
            }
        }
        val hasDeadEndAhead = Regex("(창문|블라인드|책상|모니터|벽면)\\s*(앞에\\s*계십니다|앞입니다|보입니다|있어요|있습니다)").containsMatchIn(cleaned)
        val tellsWalkForward = Regex("(정면|직진).*?(걸어|이동해|가).*?(나가|나서|현관)").containsMatchIn(cleaned)
        if (!isInsideTrain && hasDeadEndAhead && tellsWalkForward) {
            return "지금 바로 앞은 창문이나 책상으로 막혀 있어서 그대로 걸어가면 부딪혀요. 제자리에서 뒤로 돌아서거나 몸을 천천히 돌려서 방문 쪽을 먼저 비춰 보실래요?"
        }

        return cleaned
    }

    data class SkillDefinition(
        val id: String,
        val labelKo: String,
        val triggerDescriptionKo: String,
        val extractionRulesKo: String,
        val relatedSkillIds: List<String>,
        val earconKind: EarconKind
    )

    private val SKILLS: Map<String, SkillDefinition> = listOf(
        SkillDefinition(
            id = "WALKING_SAFETY",
            labelKo = "보행 안전 · 점자블록/저조도(UC-04,05,18)",
            triggerDescriptionKo = "보행로, 점자블록, 킥보드/볼라드(UC-05), 어두운 실내/야간 진입(UC-18)이 보일 때",
            extractionRulesKo = "`[WALKING_SAFETY | hazard=킥보드, steps=3]` — 진행 방향 기준 걸음 수와 회피 방향, 저조도 바닥 평탄도를 안내하세요.",
            relatedSkillIds = listOf("STEP_AND_GLASS_DOOR", "CROSSWALK_SIGNAL", "BUS_STOP"),
            earconKind = EarconKind.HAZARD_ALERT
        ),
        SkillDefinition(
            id = "STEP_AND_GLASS_DOOR",
            labelKo = "무표시 계단 · 단차 · 투명유리문 감지(UC-14)",
            triggerDescriptionKo = "대비감도가 낮은 회색 내리막 계단 첫 단, 보도턱 단차, 프레임 없는 투명 유리문과 손잡이가 보일 때",
            extractionRulesKo = "`[STEP_AND_GLASS_DOOR | type=내리막계단또는투명유리문, steps=2, handleSide=오른쪽, action=당기기]` — 평지나 열린 공간으로 착각하기 쉬운 단차/유리문과 손잡이/난간 위치를 즉시 경고하세요.",
            relatedSkillIds = listOf("WALKING_SAFETY", "INDOOR_SPACE"),
            earconKind = EarconKind.HAZARD_ALERT
        ),
        SkillDefinition(
            id = "CROSSWALK_SIGNAL",
            labelKo = "횡단보도 · 역광 신호등 인식(UC-06,19)",
            triggerDescriptionKo = "횡단보도나 보행자 신호등(적색/녹색/잔여초 및 역광 눈부심 구간 UC-19)이 보일 때",
            extractionRulesKo = "`[CROSSWALK_SIGNAL | signal=GREEN, remainSec=24]` — 역광 속에서도 신호등 색깔과 잔여 초, 정면 진행 방향을 안내하세요.",
            relatedSkillIds = listOf("WALKING_SAFETY", "BUS_STOP"),
            earconKind = EarconKind.SIGNAL_GREEN
        ),
        SkillDefinition(
            id = "BUS_STOP",
            labelKo = "버스 정류장 · 실시간 노선 매칭(UC-07,19)",
            triggerDescriptionKo = "버스 정류장 표지판(5자리 번호), 역광 BIT 전광판(UC-19), 진입 시내버스가 보일 때",
            extractionRulesKo = "`[BUS_STOP | arsId=22001, route=140]` — 정류소 번호나 진입 버스 번호와 앞문까지 걸음 수를 안내하세요.",
            relatedSkillIds = listOf("WALKING_SAFETY", "TAXI_MATCHER", "CROSSWALK_SIGNAL"),
            earconKind = EarconKind.TRANSIT_ARRIVING
        ),
        SkillDefinition(
            id = "TAXI_MATCHER",
            labelKo = "호출 택시 · 장애인콜택시 번호판 매칭(UC-15)",
            triggerDescriptionKo = "호출한 택시나 장애인 콜택시(장콜)가 진입하거나 정차해 번호판·색상·차종과 승차문을 확인할 때",
            extractionRulesKo = "`[TAXI_MATCHER | taxiPlate=34바5678, taxiColor=흰색, taxiModel=쏘나타]` — 차량 색상, 차종, 번호판 숫자와 뒷좌석 오른쪽 문 손잡이 위치를 정확히 읽어주세요.",
            relatedSkillIds = listOf("WALKING_SAFETY", "BUS_STOP"),
            earconKind = EarconKind.TRANSIT_ARRIVING
        ),
        SkillDefinition(
            id = "SUBWAY_PLATFORM",
            labelKo = "지하철 승강장 · 방면/호차 확인(UC-08,23)",
            triggerDescriptionKo = "지하철 타기 전 승강장, 스크린도어 호차-문번호(예: 3-2), 상단 역명판/방면 표지판이 보일 때",
            extractionRulesKo = "`[SUBWAY_PLATFORM | line=2호선, nextStation=한양대, door=3-2]` — 스크린도어 상단에서 어느 역 방면인지 먼저 읽어 확인하고, 실제로 열차가 도착해 문이 활짝 열리기 전에는 미리 타라고 하지 마세요.",
            relatedSkillIds = listOf("SUBWAY_ON_BOARD", "TRANSFER_CORRIDOR", "WALKING_SAFETY"),
            earconKind = EarconKind.TRANSIT_ARRIVING
        ),
        SkillDefinition(
            id = "SUBWAY_ON_BOARD",
            labelKo = "지하철 열차 탑승 중 · 정거장/하차문 안내(UC-08,23)",
            triggerDescriptionKo = "지하철 객차 내부(출입문 유리창, 손잡이, 주변 승객, 내부 전광판)가 보일 때",
            extractionRulesKo = "`[SUBWAY_ON_BOARD | currentStation=건대입구]` — 열차 안에서는 출입문 옆 손잡이를 잡게 안내하고, 실시간 정거장 추적 데이터의 [현재 역, 목적지까지 남은 정거장 수, 내리는 문 방향(오른쪽/왼쪽)]을 안내하세요.",
            relatedSkillIds = listOf("SUBWAY_PLATFORM", "TRANSFER_CORRIDOR"),
            earconKind = EarconKind.SCANNING_TICK
        ),
        SkillDefinition(
            id = "TRANSFER_CORRIDOR",
            labelKo = "하차 후 출구/환승 통로 내비(UC-09,23)",
            triggerDescriptionKo = "열차에서 내린 뒤 지하철 출구 번호 표지판(예: 1번 출구), 환승 표지판, 개찰구, 점자블록, 계단이 보일 때",
            extractionRulesKo = "`[TRANSFER_CORRIDOR | exit=1번출구]` — 하차 후에는 목적지 목표 출구 번호(예: 1번 출구)로 나가는 방향과 점자블록/개찰구/계단을 이어서 안내하세요.",
            relatedSkillIds = listOf("SUBWAY_PLATFORM", "RESTROOM_AND_SEAT", "WALKING_SAFETY"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "RESTROOM_AND_SEAT",
            labelKo = "공공화장실 성별/빈칸 · 카페 빈 좌석(UC-12,21)",
            triggerDescriptionKo = "공공화장실 남/녀 픽토그램 및 빈 칸(초록/빨강 표시)·세면대(UC-21), 또는 카페/식당의 빈 좌석과 바닥 가방 장애물(UC-12)이 보일 때",
            extractionRulesKo = "`[RESTROOM_AND_SEAT | gender=남자화장실, vacantStall=2, sink=오른쪽]` — 화장실 성별 입구와 빈 칸 번호·세면대 위치, 또는 카페 빈 좌석까지 걸음 수와 바닥 장애물을 안내하세요.",
            relatedSkillIds = listOf("TRANSFER_CORRIDOR", "INDOOR_SPACE"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "KIOSK_COACH",
            labelKo = "무인 키오스크 · 엘리베이터 1층 손끝 코칭(UC-10)",
            triggerDescriptionKo = "무인 키오스크 화면이나 엘리베이터 층수 버튼 패널(LUM-47)과 손가락이 보일 때",
            extractionRulesKo = "`[KIOSK_COACH | target=1층버튼또는메뉴명, dxCm=3, dyCm=-2, floorLit=false]` — 엘리베이터는 1층 버튼 점등 여부를 먼저 확인하고, 현재 손가락에서 목표 버튼까지 가로(dxCm)/세로(dyCm) 몇 cm 이동할지 추출하세요.",
            relatedSkillIds = listOf("INDOOR_SPACE", "APPLIANCE_SAFETY"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "APPLIANCE_SAFETY",
            labelKo = "평면 인덕션 잔열(H) · 정수기 · 가전 판독(UC-11,20)",
            triggerDescriptionKo = "주방 평면 인덕션 화구 켜짐/잔열 H 표시(UC-20), 평면 터치 정수기 온수/냉수(UC-11), 세탁기/전자레인지 LED 창이 보일 때",
            extractionRulesKo = "`[APPLIANCE_SAFETY | appliance=인덕션, zone=오른쪽아래, power=7단계, residualHeat=true]` — 인덕션 화구 가열 단계와 잔열(H) 화상 위험, 정수기 온수 위치, 가전 남은 시간을 정확히 판독하세요.",
            relatedSkillIds = listOf("KIOSK_COACH", "INDOOR_SPACE"),
            earconKind = EarconKind.HAZARD_ALERT
        ),
        SkillDefinition(
            id = "SMART_READER",
            labelKo = "약봉지/안약 · 소비기한 D-Day · 고지서 요약(UC-01,02,13)",
            triggerDescriptionKo = "약봉지/안약(UC-01), 냉장고 식품 소비기한(UC-02), 관리비 고지서/택배 송장(UC-13)이 가까이 보일 때",
            extractionRulesKo = "`[SMART_READER | docType=소비기한, product=우유, expiryDate=2026-11-18]` — 약봉지는 복용 시점/효능을, 식품은 소비기한 날짜(YYYY-MM-DD)를, 고지서/택배는 핵심 3요소만 요약하세요.",
            relatedSkillIds = listOf("GROCERY_SCANNER", "INDOOR_SPACE"),
            earconKind = EarconKind.SCANNING_TICK
        ),
        SkillDefinition(
            id = "GROCERY_SCANNER",
            labelKo = "마트/편의점 유사 용기 맛 · 제로 · 1+1 행사 리더(UC-16)",
            triggerDescriptionKo = "편의점이나 마트에서 캔/페트병/라면/통조림 상품이나 진열대 가격표·1+1 행사 라벨을 볼 때",
            extractionRulesKo = "`[GROCERY_SCANNER | product=코카콜라, flavor=레몬향500ml, zeroSugar=true, price=2000, promo=1+1]` — 정확한 상품명, 맛, 제로슈거 여부, 가격, 1+1/2+1 행사 여부를 추출하세요.",
            relatedSkillIds = listOf("SMART_READER", "KIOSK_COACH"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "DINING_ASSISTANT",
            labelKo = "식사 접시/식판 반찬 배치 · 생선 가시 · 남은 양(UC-17)",
            triggerDescriptionKo = "식탁 위 밥그릇, 국, 식판, 접시 위 반찬이나 음식이 보일 때",
            extractionRulesKo = "`[DINING_ASSISTANT | frontLeft=흰쌀밥, frontRight=된장국, topCenter=고등어구이, boneHazard=true]` — 앞쪽 왼쪽/오른쪽, 위쪽 칸 기준 음식 배치와 생선 가시/뼈 주의, 식사 후반 남은 반찬 위치를 안내하세요.",
            relatedSkillIds = listOf("INDOOR_SPACE", "SMART_READER"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "INDOOR_SPACE",
            labelKo = "실내 동선 · 집안 물건 위치 기억/찾기 · 복장 점검(UC-03)",
            triggerDescriptionKo = "집안 생활 물건(에어팟, 안경, 열쇠, 지갑) 위치 기억/찾기 및 외출 복장 얼룩 점검(UC-03), 또는 실내 출입문 탐색 시",
            extractionRulesKo = "`[INDOOR_SPACE | rememberedItem=에어팟, itemLocation=소파 오른쪽 쿠션 옆, recallItem=에어팟]` — 생활 물건이 보이면 위치를 기록하고, 정면에 창문/책상이 막혀 있으면 뒤로 돌아 방문을 찾게 안내하세요.",
            relatedSkillIds = listOf("SMART_READER", "APPLIANCE_SAFETY", "WALKING_SAFETY"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "SOCIAL_MEETING",
            labelKo = "상대방 명함/악수 제스처 · 회의 슬라이드 요약(UC-22)",
            triggerDescriptionKo = "대화 상대방이 명함/악수/물건을 건네며 손을 내밀거나 회의실 프로젝터/모니터 발표 슬라이드가 보일 때",
            extractionRulesKo = "`[SOCIAL_MEETING | cueType=HANDING_OBJECT또는PRESENTATION_SLIDE, title=미팅상대방또는슬라이드제목, detail=오른손으로 명함을 건네고]` — 상대방의 손짓 위치나 발표 슬라이드 핵심을 1~2문장으로 코칭하세요.",
            relatedSkillIds = listOf("INDOOR_SPACE", "SMART_READER"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "NAV_CONTROL",
            labelKo = "내비게이션 경로 · 이동수단 제어 도구",
            triggerDescriptionKo = "사용자가 목적지 변경/검색, 후보 선택, 또는 이동수단 변경(지하철/전철/버스/도보 전환)을 요청할 때",
            extractionRulesKo = "`[NAV_CONTROL | navAction=SWITCH_SUBWAY또는SWITCH_BUS또는SWITCH_WALK또는SEARCH_PLACE또는SELECT_CANDIDATE또는CONFIRM_START, place=추출된순수장소명, index=후보번호]` — 사용자의 의도에 맞는 navAction 슬롯을 채우고 공감하는 1문장을 답하세요.",
            relatedSkillIds = listOf("WALKING_SAFETY", "SUBWAY_PLATFORM", "BUS_STOP"),
            earconKind = EarconKind.TARGET_FOUND
        )
    ).associateBy { it.id }

    @Volatile
    var stickyModeTag: String = "WALKING_SAFETY"
        private set

    @Volatile
    var selectedUseCaseCategory: String = "AUTO"

    @Volatile
    var expectedTaxiPlate: String = ""

    private val visualMemoryMap = mutableMapOf(
        "에어팟" to "거실 소파 오른쪽 쿠션 옆",
        "안경" to "침대 머리맡 협탁 위",
        "열쇠" to "현관 신발장 위 트레이"
    )

    @Synchronized
    fun rememberObjectLocation(itemName: String, locationKo: String) {
        if (itemName.isNotBlank() && locationKo.isNotBlank()) {
            visualMemoryMap[itemName.trim()] = locationKo.trim()
        }
    }

    @Synchronized
    fun getVisualMemorySummaryForPrompt(): String {
        if (visualMemoryMap.isEmpty()) return "저장된 물건 위치 없음"
        return visualMemoryMap.entries.joinToString(", ") { "${it.key}: ${it.value}" }
    }

    @Volatile
    var activeMissionGoal: String = ""
        private set

    @Volatile
    var missionStageIndex: Int = 1
        private set

    private val STAGE_DESC = mapOf(
        1 to "1/4단계(정류장·역사 진입)",
        2 to "2/4단계(승강장·노선 방면 확인)",
        3 to "3/4단계(탑승 및 환승 이동)",
        4 to "4/4단계(목적지 도착 마무리)"
    )

    fun startOrClearMission(goalText: String): String {
        val cleaned = goalText.trim()
        if (cleaned.isEmpty()) {
            activeMissionGoal = ""
            missionStageIndex = 1
            return "목적지 미션을 종료했습니다."
        }
        activeMissionGoal = cleaned
        missionStageIndex = 1
        return "목표 미션 '$cleaned' 안내를 시작합니다. 출발 전 교통카드(대중교통 결제 카드)를 챙기셨는지 먼저 확인해 주세요. 현재 ${STAGE_DESC[1]}부터 이동 방향을 따라 실시간 안내합니다."
    }

    private fun advanceMissionStage(detectedMode: String) {
        if (activeMissionGoal.isEmpty()) return
        if ((detectedMode == "BUS_STOP" || detectedMode == "SUBWAY_PLATFORM") && missionStageIndex < 2) {
            missionStageIndex = 2
        } else if (detectedMode == "TRANSFER_CORRIDOR" && missionStageIndex < 3) {
            missionStageIndex = 3
        }
    }

    data class AutoAiReply(
        val ok: Boolean,
        val model: String,
        val detectedModeTag: String,
        val detectedModeLabelKo: String,
        val activeWindowSummary: String,
        val earconKind: EarconKind,
        val spokenKorean: String,
        val latencyMs: Long,
        val navAction: String? = null,
        val navTargetPlace: String? = null,
        val navCandidateIndex: Int? = null
    )

    /**
     * Context-Gated Micro-Skill Router:
     * Selects AT MOST 4 mutually compatible Micro-Skills for the current frame/query so prompt size
     * stays constant (~400 tokens) and unrelated Use Cases never interfere with each other!
     */
    private fun getActiveCandidateSkillIds(userQuery: String = ""): Set<String> {
        val activeSet = linkedSetOf<String>()
        val q = userQuery.trim()

        if (q.isNotEmpty()) {
            if (Regex("계단|단차|유리문").containsMatchIn(q)) activeSet.add("STEP_AND_GLASS_DOOR")
            if (Regex("신호등|횡단보도|초록불|빨간불").containsMatchIn(q)) activeSet.add("CROSSWALK_SIGNAL")
            if (Regex("택시|장콜|번호판|승차문").containsMatchIn(q)) activeSet.add("TAXI_MATCHER")
            if (Regex("버스|정류장").containsMatchIn(q)) activeSet.add("BUS_STOP")
            if (Regex("승강장|스크린도어|빠른\\s*환승|방면").containsMatchIn(q)) activeSet.add("SUBWAY_PLATFORM")
            if (Regex("열차\\s*안|정거장|하차문|내릴").containsMatchIn(q)) activeSet.add("SUBWAY_ON_BOARD")
            if (Regex("환승\\s*통로|출구").containsMatchIn(q)) activeSet.add("TRANSFER_CORRIDOR")
            if (Regex("화장실|빈\\s*칸|세면대|빈\\s*좌석|빈자리|카페").containsMatchIn(q)) activeSet.add("RESTROOM_AND_SEAT")
            if (Regex("엘리베이터|키오스크|버튼|몇\\s*cm").containsMatchIn(q)) activeSet.add("KIOSK_COACH")
            if (Regex("인덕션|잔열|화구|정수기|온수|세탁기|전자레인지|가전").containsMatchIn(q)) activeSet.add("APPLIANCE_SAFETY")
            if (Regex("약봉지|안약|소비기한|유통기한|고지서|택배").containsMatchIn(q)) activeSet.add("SMART_READER")
            if (Regex("마트|편의점|1\\+1|제로|가격|맛|음료|상품").containsMatchIn(q)) activeSet.add("GROCERY_SCANNER")
            if (Regex("반찬|식탁|접시|식판|가시|밥|식사").containsMatchIn(q)) activeSet.add("DINING_ASSISTANT")
            if (Regex("기억|에어팟|안경|열쇠|지갑|옷|얼룩|복장").containsMatchIn(q)) activeSet.add("INDOOR_SPACE")
            if (Regex("명함|악수|슬라이드|회의|발표").containsMatchIn(q)) activeSet.add("SOCIAL_MEETING")
        }

        when (selectedUseCaseCategory) {
            "WAYFINDING" -> {
                activeSet.add("WALKING_SAFETY")
                activeSet.add("STEP_AND_GLASS_DOOR")
                activeSet.add("CROSSWALK_SIGNAL")
            }
            "TRANSIT_TAXI" -> {
                activeSet.add("SUBWAY_PLATFORM")
                activeSet.add("SUBWAY_ON_BOARD")
                activeSet.add("TAXI_MATCHER")
                activeSet.add("BUS_STOP")
            }
            "SHOPPING_DINING_DOC" -> {
                activeSet.add("GROCERY_SCANNER")
                activeSet.add("DINING_ASSISTANT")
                activeSet.add("SMART_READER")
            }
            "HOME_APPLIANCE_KIOSK" -> {
                activeSet.add("APPLIANCE_SAFETY")
                activeSet.add("KIOSK_COACH")
                activeSet.add("INDOOR_SPACE")
            }
            "PUBLIC_OFFICE" -> {
                activeSet.add("RESTROOM_AND_SEAT")
                activeSet.add("SOCIAL_MEETING")
                activeSet.add("TRANSFER_CORRIDOR")
            }
        }

        if (stickyModeTag != "SUBWAY_ON_BOARD" && activeSet.size < 4) {
            activeSet.add("WALKING_SAFETY")
        }
        val current = SKILLS[stickyModeTag] ?: SKILLS.getValue("WALKING_SAFETY")
        if (activeSet.size < 4) {
            activeSet.add(current.id)
        }
        for (rel in current.relatedSkillIds) {
            if (activeSet.size >= 4) break
            activeSet.add(rel)
        }
        if (activeMissionGoal.isNotEmpty() && activeSet.size < 4) {
            for (mMode in listOf("SUBWAY_PLATFORM", "SUBWAY_ON_BOARD", "TRANSFER_CORRIDOR", "BUS_STOP")) {
                if (activeSet.size >= 4) break
                activeSet.add(mMode)
            }
        }
        return activeSet.take(4).toSet()
    }

    private fun assembleLayer1Prompt(userQuery: String, previousSpeech: String?): String {
        val activeIds = getActiveCandidateSkillIds(userQuery)
        val sb = StringBuilder()
        sb.append("당신은 시각장애인 사용자의 옆에서 함께 걸으며 대화하는 다정한 AI 길동무 '루모'입니다 (Gemini Live / Pickle 스타일).\n")
        sb.append("[Layer 1 상태 유지 라우터 | 직전 모드: $stickyModeTag]\n")
        sb.append("맨 앞에만 시스템용 `[모드ID | 키=값]` 헤더를 적고, 그 뒤에 이어지는 말은 **기계적인 스크린 리더기가 아니라 옆에 있는 친구가 말하듯 자연스러운 구어체(~해요, ~있어요, ~볼까요?)로 짧게 1~2문장(70자 이내)**만 작성하세요.\n")
        sb.append("⚠️ 필수 대화형 음성 UX 규칙:\n")
        sb.append("1. [기호·화살표·괄호 절대 금지]: 본문에는 `→`, `[`, `]`, `(`, `)`, `·`, `/` 같은 기호나 '1/4단계' 같은 딱딱한 보고서 말머리를 절대 쓰지 마세요.\n")
        sb.append("2. [창문/책상 충돌 방지]: 실내에서 정면에 책상, 창문, 블라인드, 벽이 보이면 절대 앞으로 걸어 나가라고 하지 마세요! '어이쿠, 바로 앞은 창문(또는 책상)이라 막혀 있어요. 뒤로 돌아서서 방문 쪽을 먼저 비춰 보실래요?'라고 말하세요.\n")
        sb.append("3. [색상 지시 및 시계 방향 금지]: '12시 방향'이나 '밝은 색 보도' 대신 '지금 걸어가시는 방향 그대로 다섯 걸음만 가볼까요?', '오른쪽으로 살짝 돌아서세요'처럼 자연스럽게 말하세요.\n")
        sb.append("4. [엘리베이터 층수 확인]: 외출 미션 중 엘리베이터 버튼이 보이면 닫힘 버튼보다 먼저 1층 버튼에 불이 켜져 있는지 봐주고, 안 눌려 있으면 '일단 1층 버튼부터 눌러볼까요? 지금 손에서 조금만 아래로 내려보세요'처럼 코칭하세요.\n")

        sb.append("5. [지하철 탑승 및 정지 화면 환각 금지 (LUM-74~109)]: 카메라 화면이 직전과 비슷하다고 해서 상상으로 '문이 열렸다', '열차에 탔다', '승강장으로 나왔다', '환승통로 표지판이 보인다'고 지어내지 마세요! 지하철 객차 안에서는 `[SUBWAY_ON_BOARD]`를 선택하고, 빈자리를 찾으라거나 유리창이 막혀 있으니 돌아서라고 하지 말고 출입문 옆 손잡이를 잡게 한 뒤 [현재 역, 목적지까지 남은 정거장 수, 내릴 문 방향(오른쪽/왼쪽)]을 안내하세요.\n")

        val historyLines = getRecentConversationLines()
        if (historyLines.isNotEmpty()) {
            sb.append("\n💬 [최근 사용자와의 대화 맥락]:\n")
            for (line in historyLines) {
                sb.append("$line\n")
            }
        }

        if (activeMissionGoal.isNotEmpty()) {
            val stageStr = STAGE_DESC[missionStageIndex] ?: "진행 중"
            val liveNavCtx = WayfindingNavigator.buildLiveNavContextForPrompt()
            sb.append("\n🎯 [현재 함께 가는 목적지]: \"$activeMissionGoal\" ($stageStr)\n")
            if (liveNavCtx.isNotEmpty()) {
                sb.append("- [실시간 위치/정거장/출구/문방향 데이터]: $liveNavCtx\n")
            }
        }
        if (expectedTaxiPlate.isNotBlank()) {
            sb.append("\n🚕 [호출 택시/장콜 대기 번호]: \"$expectedTaxiPlate\" — 진입 차량의 번호판, 색상, 차종과 뒷좌석 문 손잡이 위치를 대조해 주세요(UC-15).\n")
        }
        sb.append("\n📌 [온디바이스 시각 메모리 (기억해 둔 집안 물건 위치 - UC-03)]: ${getVisualMemorySummaryForPrompt()}\n")
        sb.append("- 카메라에 에어팟, 안경, 열쇠, 지갑, 리모컨, 약봉지 등 생활 물건이 보이면 `[INDOOR_SPACE | rememberedItem=물건명, itemLocation=구체적위치]` 슬롯을 함께 적고, 사용자가 물건 위치를 물어보면 기억해 둔 위치를 알려주세요.\n")
        sb.append("- 식품 유통기한/소비기한이 보이면 `[SMART_READER | product=제품명, expiryDate=YYYY-MM-DD]` 슬롯을 적으세요.\n")
        sb.append("- 평면 인덕션 잔열(H) 표시가 보이면 `[KIOSK_COACH | appliance=인덕션, residualHeat=true]`를 적어 화상을 예방하세요.\n")

        sb.append("\n[우선 활성 스킬 규칙]:\n")
        for ((id, sk) in SKILLS) {
            if (id in activeIds || id == "SUBWAY_ON_BOARD") {
                sb.append("• [$id] (${sk.labelKo}): ${sk.triggerDescriptionKo}\n  - 규칙: ${sk.extractionRulesKo}\n")
            }
        }
        if (!previousSpeech.isNullOrBlank() && userQuery.isBlank()) {
            sb.append("\n(직전 루모 발화: \"$previousSpeech\" — 만약 카메라 화면 상황이 직전과 동일하면 억지로 다른 상황(하차/문열림/환승통로)을 지어내지 말고, 현재 위치와 목적지까지 남은 정거장·내릴 문 방향 또는 대기 안내를 일관되게 말하세요.)\n")
        }
        if (userQuery.isNotBlank()) {
            val pendingCands = WayfindingNavigator.lastSearchResult?.candidatesRecommended?.take(4)?.joinToString(", ") { "${it.index}번:${it.name}" } ?: "없음"
            val curDest = WayfindingNavigator.activeRoute?.destination?.name ?: "미정"
            sb.append("\n🧭 [내비게이션 도구 호출 규칙 (NAV_CONTROL)]:\n")
            sb.append("- 현재 목적지: $curDest | 대기 중인 검색 후보: [$pendingCands]\n")
            sb.append("- 만약 사용자의 말이 이동수단 변경(예: 지하철/전철로 가고 싶다, 버스 싫다, 걸어가겠다), 새 장소 검색(예: ~찾아줘, ~가자), 후보 선택, 출발 확정이라면 카메라 묘사 대신 반드시 아래 헤더를 맨 앞에 출력하세요:\n")
            sb.append("  • 지하철/전철 경로로 전환 요청 시: `[NAV_CONTROL | navAction=SWITCH_SUBWAY]`\n")
            sb.append("  • 버스 경로로 전환 요청 시: `[NAV_CONTROL | navAction=SWITCH_BUS]`\n")
            sb.append("  • 도보/걸어서 경로로 전환 요청 시: `[NAV_CONTROL | navAction=SWITCH_WALK]`\n")
            sb.append("  • 새로운 장소 검색 요청 시(실제 장소명 명사만 추출): `[NAV_CONTROL | navAction=SEARCH_PLACE, place=순수장소명]`\n")
            sb.append("  • 대기 후보 중 번호/이름 선택 시: `[NAV_CONTROL | navAction=SELECT_CANDIDATE, index=번호]`\n")
            sb.append("  • 계획에 동의해 출발 확정 시: `[NAV_CONTROL | navAction=CONFIRM_START]`\n")
            sb.append("\n🎤 사용자가 방금 한 말: \"$userQuery\" -> 위 도구 규칙 또는 카메라 화면을 참고해 친구처럼 자연스럽게 답하세요.")
        } else {
            sb.append("\n현재 카메라 화면을 보고 가장 알맞은 [모드ID]와 자연스러운 구어체 안내 1~2문장을 출력하세요.")
        }
        return sb.toString()
    }

    private fun executeLayer2SkillPostProcess(rawText: String): Triple<SkillDefinition, String, Map<String, String>> {
        val cleaned = cleanMovementRelativeDirection(rawText.replace("**", "").trim())
        val headerRegex = Regex(
            "^\\[(WALKING_SAFETY|STEP_AND_GLASS_DOOR|CROSSWALK_SIGNAL|BUS_STOP|TAXI_MATCHER|SUBWAY_PLATFORM|SUBWAY_ON_BOARD|TRANSFER_CORRIDOR|RESTROOM_AND_SEAT|KIOSK_COACH|APPLIANCE_SAFETY|SMART_READER|GROCERY_SCANNER|DINING_ASSISTANT|INDOOR_SPACE|SOCIAL_MEETING|NAV_CONTROL)(?:\\s*\\|\\s*([^\\]]+))?]\\s*(.*)$",
            RegexOption.DOT_MATCHES_ALL
        )
        val match = headerRegex.find(cleaned)
        val slots = mutableMapOf<String, String>()

        val modeId = if (match != null) {
            val rawSlots = match.groupValues[2].trim()
            if (rawSlots.isNotEmpty()) {
                for (pair in rawSlots.split(",")) {
                    val kv = pair.split("=", limit = 2)
                    if (kv.size == 2 && isValidSlot(kv[1])) {
                        slots[kv[0].trim()] = kv[1].trim()
                    }
                }
            }
            match.groupValues[1]
        } else {
            when {
                cleaned.contains("킥보드") || cleaned.contains("장애물") || cleaned.contains("위험") -> "WALKING_SAFETY"
                cleaned.contains("신호등") || cleaned.contains("횡단보도") -> "CROSSWALK_SIGNAL"
                cleaned.contains("버스") || cleaned.contains("정류장") -> "BUS_STOP"
                cleaned.contains("승강장") || cleaned.contains("스크린도어") -> "SUBWAY_PLATFORM"
                cleaned.contains("환승") || cleaned.contains("계단") -> "TRANSFER_CORRIDOR"
                cleaned.contains("키오스크") || cleaned.contains("버튼") -> "KIOSK_COACH"
                cleaned.contains("약봉지") || cleaned.contains("고지서") || cleaned.contains("유통기한") -> "SMART_READER"
                else -> stickyModeTag
            }
        }

        var draftSpeech = WayfindingNavigator.guardSubwayRideSpeech(
            cleanMovementRelativeDirection(
                match?.groupValues?.get(3)?.trim()?.takeIf { it.isNotEmpty() } ?: cleaned
            )
        )
        val skill = SKILLS[modeId] ?: SKILLS.getValue("INDOOR_SPACE")
        stickyModeTag = skill.id
        advanceMissionStage(skill.id)

        // Layer 2 Guard & Enrichment for SUBWAY_PLATFORM (Fixes LUM-17 & LUM-19)
        if (skill.id == "SUBWAY_PLATFORM") {
            val door = slots["door"] ?: Regex("(\\d{1,2}-\\d)").find(draftSpeech)?.groupValues?.get(1)
            val nextStn = slots["nextStation"]?.takeIf { isValidSlot(it) }
            val line = slots["line"]?.takeIf { isValidSlot(it) }

            if (door != null && nextStn != null) {
                val arrivalMin = fetchSeoulSubwayLive(nextStn, nextStn)
                val enriched = KoreanTransitDoorCalculator.calculateTransferGuidance(
                    lineName = line ?: "지하철",
                    intendedDirectionStation = nextStn,
                    observedNextStation = nextStn,
                    observedDoorRaw = door,
                    targetDoorRaw = "5-3",
                    transferStationName = "${nextStn.removeSuffix("역")}역",
                    transferTargetLine = slots["transferLine"]?.takeIf { isValidSlot(it) } ?: "환승 노선",
                    higherCarIsRight = true,
                    arrivalMinutes = arrivalMin
                )
                return Triple(skill, cleanMovementRelativeDirection(enriched), slots)
            }

            if (draftSpeech.contains("None") || draftSpeech.contains("알수없음") || draftSpeech.contains("알 수 없음")) {
                draftSpeech = "승강장 표지판 글씨가 아직 잘 안 보여요. 정면 스크린도어 쪽으로 서너 걸음만 더 다가가서 위쪽 역명판을 비춰 보실래요?"
            }
            return Triple(skill, draftSpeech, slots)
        }

        // Layer 2 Live Seoul Bus & Called Taxi Enrichment for BUS_STOP (Fixes LUM-29 & UC-15)
        if (skill.id == "BUS_STOP") {
            val obsPlate = slots["taxiPlate"]?.takeIf { isValidSlot(it) }
            if (obsPlate != null) {
                val color = slots["taxiColor"] ?: "택시"
                val model = slots["taxiModel"] ?: "승용차"
                if (expectedTaxiPlate.isNotBlank()) {
                    val isMatch = obsPlate.replace(" ", "").endsWith(expectedTaxiPlate.replace(" ", "").takeLast(4))
                    val taxiSpeech = if (isMatch) {
                        "네, 호출하신 $color $model $obsPlate 차량이 맞아요! 지금 걸어가시는 정면 세 걸음 앞에 뒷좌석 오른쪽 문 손잡이가 있어요."
                    } else {
                        "앞에 멈춘 $color $model 차량은 번호가 $obsPlate 번이라 호출하신 $expectedTaxiPlate 차량이 아니에요. 잠시 더 기다려 주세요."
                    }
                    return Triple(skill, taxiSpeech, slots)
                }
            }
            val arsId = slots["arsId"] ?: Regex("(\\d{2}-\\d{3}|\\b\\d{5}\\b)").find(draftSpeech)?.groupValues?.get(1)
            val route = slots["route"] ?: Regex("(\\d{2,4})번").find(draftSpeech)?.groupValues?.get(1)
            if (arsId != null || route != null) {
                val liveBusInfo = fetchSeoulBusStopLive(arsId ?: "22001", route)
                if (liveBusInfo != null) {
                    return Triple(skill, cleanMovementRelativeDirection("$liveBusInfo $draftSpeech"), slots)
                }
            }
        }

        // Layer 2 Real-Date Food Expiry D-Day Calculator for SMART_READER (UC-02)
        if (skill.id == "SMART_READER") {
            val expRaw = slots["expiryDate"] ?: Regex("(20\\d{2}[-.]\\d{2}[-.]\\d{2})").find(draftSpeech)?.groupValues?.get(1)
            val prod = slots["product"]?.takeIf { isValidSlot(it) } ?: "식품"
            if (expRaw != null) {
                try {
                    val expDate = LocalDate.parse(expRaw.replace(".", "-"))
                    val diffDays = ChronoUnit.DAYS.between(LocalDate.now(), expDate)
                    val dDaySpeech = when {
                        diffDays < 0 -> "주의하세요! $prod 소비기한이 ${expDate.monthValue}월 ${expDate.dayOfMonth}일까지로 이미 ${kotlin.math.abs(diffDays)}일 지났어요. 드시지 마세요."
                        diffDays == 0L -> "$prod 소비기한이 오늘(${expDate.monthValue}월 ${expDate.dayOfMonth}일)까지예요."
                        else -> "$prod 소비기한은 ${expDate.monthValue}월 ${expDate.dayOfMonth}일까지로 오늘부터 ${diffDays}일 남았어요."
                    }
                    return Triple(skill, dDaySpeech, slots)
                } catch (_: Exception) {}
            }
        }

        // Layer 2 Visual Memory Indexing for INDOOR_SPACE (UC-03)
        if (skill.id == "INDOOR_SPACE") {
            val remItem = slots["rememberedItem"]?.takeIf { isValidSlot(it) }
            val remLoc = slots["itemLocation"]?.takeIf { isValidSlot(it) }
            if (remItem != null && remLoc != null) {
                rememberObjectLocation(remItem, remLoc)
            }
        }

        // Layer 2 P0 Residual Heat & Fingertip cm Math for KIOSK_COACH / APPLIANCE_SAFETY (UC-10, UC-20)
        if (skill.id == "KIOSK_COACH") {
            val target = slots["target"]?.takeIf { isValidSlot(it) }
            val dx = slots["dxCm"]?.toDoubleOrNull()
            val dy = slots["dyCm"]?.toDoubleOrNull()
            if (target != null && dx != null && dy != null) {
                val hMove = when {
                    dx > 0.4 -> "오른쪽으로 ${kotlin.math.round(dx).toInt()}cm"
                    dx < -0.4 -> "왼쪽으로 ${kotlin.math.round(-dx).toInt()}cm"
                    else -> ""
                }
                val vMove = when {
                    dy > 0.4 -> "위로 ${kotlin.math.round(dy).toInt()}cm"
                    dy < -0.4 -> "아래로 ${kotlin.math.round(-dy).toInt()}cm"
                    else -> ""
                }
                val moves = listOf(hMove, vMove).filter { it.isNotEmpty() }.joinToString(", ")
                val cmSpeech = if (moves.isEmpty()) {
                    "지금 손가락 위치가 바로 $target 위예요. 그대로 누르세요."
                } else {
                    "$target 까지 지금 손가락에서 $moves 이동해 누르세요."
                }
                return Triple(skill, cmSpeech, slots)
            }
        }
        if ((skill.id == "APPLIANCE_SAFETY" || skill.id == "KIOSK_COACH") && slots["residualHeat"] == "true") {
            val hotSkill = skill.copy(earconKind = EarconKind.HAZARD_ALERT)
            return Triple(hotSkill, draftSpeech, slots)
        }
        if (skill.id == "TAXI_MATCHER") {
            val obsPlate = slots["taxiPlate"]?.takeIf { isValidSlot(it) }
            if (obsPlate != null && expectedTaxiPlate.isNotBlank()) {
                val color = slots["taxiColor"] ?: "택시"
                val model = slots["taxiModel"] ?: "승용차"
                val isMatch = obsPlate.replace(" ", "").endsWith(expectedTaxiPlate.replace(" ", "").takeLast(4))
                val taxiSpeech = if (isMatch) {
                    "네, 호출하신 $color $model $obsPlate 차량이 맞아요! 지금 걸어가시는 정면 세 걸음 앞에 뒷좌석 오른쪽 문 손잡이가 있어요."
                } else {
                    "앞에 멈춘 $color $model 차량은 번호가 $obsPlate 번이라 호출하신 $expectedTaxiPlate 차량이 아니에요. 잠시 더 기다려 주세요."
                }
                return Triple(skill, taxiSpeech, slots)
            }
        }

        return Triple(skill, draftSpeech, slots)
    }

    fun analyzeAutoSceneFlashLite(
        userQuery: String,
        imageBase64Jpeg: String? = null,
        previousSpeech: String? = null
    ): AutoAiReply {
        val t0 = System.currentTimeMillis()
        val apiKey = BuildConfig.GEMINI_API_KEY
        val activeWindowSummary = getActiveCandidateSkillIds().joinToString("+")

        if (apiKey.isBlank()) {
            return AutoAiReply(
                ok = false,
                model = CHEAPEST_FAST_MODEL,
                detectedModeTag = "OFFLINE",
                detectedModeLabelKo = "오프라인 보조 모드",
                activeWindowSummary = activeWindowSummary,
                earconKind = EarconKind.HAZARD_ALERT,
                spokenKorean = "API 키가 설정되지 않았습니다.",
                latencyMs = System.currentTimeMillis() - t0
            )
        }

        val encodedKey = URLEncoder.encode(apiKey, "UTF-8")
        val endpoint =
            "https://generativelanguage.googleapis.com/v1beta/models/$CHEAPEST_FAST_MODEL:generateContent?key=$encodedKey"

        val parts = JSONArray()
        if (!imageBase64Jpeg.isNullOrBlank()) {
            val inlineData = JSONObject()
                .put("mimeType", "image/jpeg")
                .put("data", imageBase64Jpeg)
            parts.put(JSONObject().put("inlineData", inlineData))
        }
        val dynamicPrompt = assembleLayer1Prompt(userQuery, previousSpeech)
        parts.put(JSONObject().put("text", dynamicPrompt))

        val bodyString = JSONObject()
            .put(
                "contents",
                JSONArray().put(
                    JSONObject()
                        .put("role", "user")
                        .put("parts", parts)
                )
            )
            .put(
                "generationConfig",
                JSONObject()
                    .put("temperature", 0.2)
                    .put("maxOutputTokens", 160)
            )
            .toString()

        var lastError = ""
        // Automatic retry up to 2 attempts to survive subway LTE/5G handoffs (Fixes LUM-18/21/22/24/25/28)
        for (attempt in 1..2) {
            try {
                val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10000
                    readTimeout = 18000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }

                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(bodyString)
                }

                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val raw = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }

                if (status in 200..299) {
                    val json = JSONObject(raw)
                    val contentParts = json.optJSONArray("candidates")
                        ?.optJSONObject(0)
                        ?.optJSONObject("content")
                        ?.optJSONArray("parts")

                    val sb = StringBuilder()
                    if (contentParts != null) {
                        for (i in 0 until contentParts.length()) {
                            val t = contentParts.optJSONObject(i)?.optString("text", "") ?: ""
                            if (t.isNotBlank()) {
                                if (sb.isNotEmpty()) sb.append(" ")
                                sb.append(t.trim())
                            }
                        }
                    }
                    val rawOut = sb.toString().trim()
                    if (rawOut.isNotEmpty()) {
                        if (userQuery.isNotBlank()) {
                            recordConversationTurn("user", userQuery)
                        }
                        val (skill, finalSpeech, extractedSlots) = executeLayer2SkillPostProcess(rawOut)
                        recordConversationTurn("assistant", finalSpeech)
                        return AutoAiReply(
                            ok = true,
                            model = CHEAPEST_FAST_MODEL,
                            detectedModeTag = skill.id,
                            detectedModeLabelKo = skill.labelKo,
                            activeWindowSummary = activeWindowSummary,
                            earconKind = skill.earconKind,
                            spokenKorean = finalSpeech,
                            latencyMs = System.currentTimeMillis() - t0,
                            navAction = extractedSlots["navAction"],
                            navTargetPlace = extractedSlots["place"]?.takeIf { isValidSlot(it) },
                            navCandidateIndex = extractedSlots["index"]?.toIntOrNull()
                        )
                    }
                }

                lastError = try {
                    JSONObject(raw).optJSONObject("error")?.optString("message") ?: "HTTP $status"
                } catch (_: Exception) {
                    "HTTP $status"
                }
            } catch (e: Exception) {
                lastError = e.javaClass.simpleName
                if (attempt == 1) {
                    try { Thread.sleep(600) } catch (_: Exception) {}
                }
            }
        }

        return AutoAiReply(
            ok = false,
            model = CHEAPEST_FAST_MODEL,
            detectedModeTag = "NETWORK_RETRY_FAILED",
            detectedModeLabelKo = "통신 재시도 대기 ($lastError)",
            activeWindowSummary = activeWindowSummary,
            earconKind = EarconKind.SCANNING_TICK,
            spokenKorean = "지하 구간 등 무선 신호가 약해 재연결 중입니다. 잠시 후 다음 화면에서 다시 안내합니다.",
            latencyMs = System.currentTimeMillis() - t0
        )
    }

    fun fetchSeoulSubwayLive(stationName: String, directionKeyword: String): Int {
        val key = BuildConfig.SEOUL_SUBWAY_KEY
        if (key.isBlank()) return 3
        return try {
            val clean = stationName.removeSuffix("역")
            val url =
                "http://swopenAPI.seoul.go.kr/api/subway/${URLEncoder.encode(key, "UTF-8")}/json/realtimeStationArrival/0/10/${URLEncoder.encode(clean, "UTF-8")}"
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 4500
                readTimeout = 4500
            }
            val raw = conn.inputStream.bufferedReader().readText()
            val list = JSONObject(raw).optJSONArray("realtimeArrivalList") ?: return 3
            for (i in 0 until list.length()) {
                val item = list.optJSONObject(i) ?: continue
                val lineNm = item.optString("trainLineNm", "")
                if (lineNm.contains(directionKeyword)) {
                    val sec = item.optString("barvlDt", "0").toIntOrNull() ?: 0
                    if (sec > 0) return maxOf(1, Math.round(sec / 60f))
                }
            }
            3
        } catch (_: Exception) {
            3
        }
    }

    fun fetchSeoulBusStopLive(arsIdRaw: String, targetRoute: String?): String? {
        val key = BuildConfig.SEOUL_BUS_KEY
        if (key.isBlank()) return null
        return try {
            val digits = arsIdRaw.replace(Regex("\\D"), "").ifEmpty { "22001" }
            val url =
                "http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid?serviceKey=${URLEncoder.encode(key, "UTF-8")}&arsId=$digits&resultType=json"
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 4500
                readTimeout = 4500
            }
            val raw = conn.inputStream.bufferedReader().readText()
            val items = JSONObject(raw).optJSONObject("msgBody")?.optJSONArray("itemList") ?: return null
            if (items.length() == 0) return null

            var matched = items.optJSONObject(0)
            if (!targetRoute.isNullOrBlank()) {
                for (i in 0 until items.length()) {
                    val it = items.optJSONObject(i) ?: continue
                    if (it.optString("rtNm") == targetRoute || it.optString("busRouteAbrv") == targetRoute) {
                        matched = it
                        break
                    }
                }
            }
            val stNm = matched?.optString("stNm", "정류소") ?: "정류소"
            val rtNm = matched?.optString("rtNm", targetRoute ?: "") ?: ""
            val nxtStn = matched?.optString("nxtStn", "") ?: ""
            val arrmsg1 = matched?.optString("arrmsg1", "도착 정보 확인 중") ?: ""
            "실시간 정류소 확인: $stNm($nxtStn 방면), ${rtNm}번 버스 $arrmsg1."
        } catch (_: Exception) {
            null
        }
    }
}
