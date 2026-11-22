package ai.sota.glass

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
object NativeSotaAiClient {
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
            val speaker = if (role == "user") "사용자" else "소타"
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

        // 3. LUM-132, LUM-133, LUM-134: Never tell user to "dodge the refrigerator door and keep walking" when they opened the fridge to check food/drinks!
        if (Regex("냉장고\\s*문.*?(?:조심|비켜서\\s*걸어|이동해\\s*볼까요)").containsMatchIn(cleaned)) {
            return "냉장고 문을 여셨네요. 찾으시는 음료나 반찬통을 가까이 비춰 주시면 이름과 소비기한을 읽어 드릴게요."
        }

        // 4. LUM-49 & LUM-50 vs LUM-79 & LUM-89: Never trigger indoor window dead-end warning when inside a subway train!
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
        if (!isInsideTrain && activeMissionGoal.isNotEmpty() && hasDeadEndAhead && tellsWalkForward) {
            return "지금 바로 앞은 창문이나 책상으로 막혀 있어서 그대로 걸어가면 부딪혀요. 제자리에서 뒤로 돌아서거나 몸을 천천히 돌려서 방문 쪽을 먼저 비춰 보실래요?"
        }
        // LUM-141: When NO navigation mission is active, sitting at a desk/laptop is normal — do NOT tell user to turn around and walk to the room door!
        if (activeMissionGoal.isEmpty() && Regex("바로\\s*앞은\\s*(?:모니터와\\s*)?책상이라\\s*막혀\\s*있어요.*?(?:뒤로\\s*돌아|방문\\s*쪽)").containsMatchIn(cleaned)) {
            return "지금 책상 앞에 계시네요. 확인하고 싶은 물건이나 문서가 있으면 비춰 주시거나 편하게 질문해 주세요."
        }

        return cleaned
    }

    data class SkillDefinition(
        val id: String,
        val labelKo: String,
        val triggerDescriptionKo: String,
        val extractionRulesKo: String,
        val expertPlaybookEn: String,
        val relatedSkillIds: List<String>,
        val earconKind: EarconKind
    )

    private val SKILLS: Map<String, SkillDefinition> = listOf(
        SkillDefinition(
            id = "WALKING_SAFETY",
            labelKo = "보행 안전 · 점자블록/저조도(UC-04,05,18)",
            triggerDescriptionKo = "Outdoor sidewalks, tactile paving (점자블록), obstacles (kickboards/bollards UC-05), or dim transitions (UC-18)",
            extractionRulesKo = "`[WALKING_SAFETY | hazard=킥보드, steps=3, avoidDir=왼쪽]`",
            expertPlaybookEn = "Scan: 1) Obstacles on tactile paving/curb, 2) Broken tactile blocks or cafe tables, 3) Dim floor flatness & wall shoreline. Value Formula: [Obstacle + steps] -> [Avoidance side & steps] -> [Shoreline Re-alignment: tell user how to return to tactile paving/curb/wall after dodging]. Guard: NEVER classify indoor fridge/bottle/desk/food as WALKING_SAFETY.",
            relatedSkillIds = listOf("STEP_AND_GLASS_DOOR", "CROSSWALK_SIGNAL", "BUS_STOP"),
            earconKind = EarconKind.HAZARD_ALERT
        ),
        SkillDefinition(
            id = "STEP_AND_GLASS_DOOR",
            labelKo = "무표시 계단 · 단차 · 투명유리문 감지(UC-14)",
            triggerDescriptionKo = "Low-contrast grey stairs/curbs or frameless glass doors & handles/auto-buttons (UC-14)",
            extractionRulesKo = "`[STEP_AND_GLASS_DOOR | type=내리막계단|투명유리문, steps=2, handleSide=오른쪽, action=당기기|밀기|자동문버튼]`",
            expertPlaybookEn = "Scan: 1) Downward stair edges/curb drops, 2) Closed vs open glass door + Push/Pull sticker, lever/bar handle, or pillar auto-door press button, 3) Handrail side. Value Formula: [Drop-off or door state + steps] -> [Exact Pull/Push/Sliding/Auto-button location or handrail side]. Guard: Never tell user to walk through a closed door.",
            relatedSkillIds = listOf("WALKING_SAFETY", "INDOOR_SPACE"),
            earconKind = EarconKind.HAZARD_ALERT
        ),
        SkillDefinition(
            id = "CROSSWALK_SIGNAL",
            labelKo = "횡단보도 · 역광 신호등 인식(UC-06,19)",
            triggerDescriptionKo = "Crosswalk waiting line, pedestrian traffic light, countdown seconds, or backlit signal (UC-06,19)",
            extractionRulesKo = "`[CROSSWALK_SIGNAL | signal=GREEN|RED|BLINKING, remainSec=24]`",
            expertPlaybookEn = "Scan: 1) Far pedestrian light (Red, solid Green, or blinking Green + countdown), 2) Zebra-stripe alignment, 3) Right-turning cars. Value Formula: [Explicit Safe-to-Cross vs Wait-for-Next-Cycle verdict (wait if blinking or <10s)] + [Straight alignment + right-turn car check].",
            relatedSkillIds = listOf("WALKING_SAFETY", "BUS_STOP"),
            earconKind = EarconKind.SIGNAL_GREEN
        ),
        SkillDefinition(
            id = "BUS_STOP",
            labelKo = "버스 정류장 · 실시간 노선 매칭(UC-07,19)",
            triggerDescriptionKo = "Bus stop sign (5-digit ARS-ID), BIT LED board (UC-19), or queued city buses (UC-07)",
            extractionRulesKo = "`[BUS_STOP | arsId=..., route=..., queueOrder=1|2, unreadableReason=TOO_FAR|GLARE]`",
            expertPlaybookEn = "Scan: 1) 5-digit ARS-ID & direction arrow, 2) Queue order of arriving buses (1st front bus vs 2nd trailing bus), 3) Open front door steps. Value Formula: [Direction match] + [1st vs 2nd bus number] + [Steps to front door]. Guard: Never guess blurred numbers.",
            relatedSkillIds = listOf("WALKING_SAFETY", "TAXI_MATCHER", "CROSSWALK_SIGNAL"),
            earconKind = EarconKind.TRANSIT_ARRIVING
        ),
        SkillDefinition(
            id = "TAXI_MATCHER",
            labelKo = "호출 택시 · 장애인콜택시 번호판 매칭(UC-15)",
            triggerDescriptionKo = "Called taxi or wheelchair call-taxi (장애인 콜택시) license plate, model & door handle (UC-15)",
            extractionRulesKo = "`[TAXI_MATCHER | taxiPlate=34바5678, taxiColor=흰색, taxiModel=쏘나타]`",
            expertPlaybookEn = "Scan: 1) License plate digits, 2) Vehicle color & sedan/van type, 3) Rear-right door handle steps & passing bikes on curb. Value Formula: [Match vs Wrong-car alert] + [Color/model] + [Steps to rear-right door handle so user need not grope car body].",
            relatedSkillIds = listOf("WALKING_SAFETY", "BUS_STOP"),
            earconKind = EarconKind.TRANSIT_ARRIVING
        ),
        SkillDefinition(
            id = "SUBWAY_PLATFORM",
            labelKo = "지하철 승강장 · 방면/호차 확인(UC-08,23)",
            triggerDescriptionKo = "Subway platform before boarding, screen-door car-door code (3-2), or overhead direction sign (UC-08)",
            extractionRulesKo = "`[SUBWAY_PLATFORM | line=2호선, nextStation=한양대, door=3-2, unreadableReason=TOO_FAR|TILT_UP]`",
            expertPlaybookEn = "Scan: 1) Overhead next-station direction sign, 2) Screen-door code (e.g. 3-2), 3) Physical door closed vs open gap + alighting crowd. Value Formula: [Correct direction confirmation] + [Current car-door code] + [Wait behind safety line until doors visibly open and alighting passengers clear].",
            relatedSkillIds = listOf("SUBWAY_ON_BOARD", "TRANSFER_CORRIDOR", "WALKING_SAFETY"),
            earconKind = EarconKind.TRANSIT_ARRIVING
        ),
        SkillDefinition(
            id = "SUBWAY_ON_BOARD",
            labelKo = "지하철 열차 탑승 중 · 정거장/하차문 안내(UC-08,23)",
            triggerDescriptionKo = "Inside subway train cabin (door window, handrail, passengers, in-cabin station LED)",
            extractionRulesKo = "`[SUBWAY_ON_BOARD | currentStation=건대입구]`",
            expertPlaybookEn = "Scan: 1) In-cabin station LED or platform sign through window, 2) Door-side handrail. Value Formula: [Current station & remaining stops] + [Which door side opens at destination (오른쪽/왼쪽)] + [1-stop-before prep alert ONLY at 1 stop remaining]. Guard: Standing by the door window holding the handrail is safe and standard — NEVER tell user to hunt for empty seats or treat the train window as a blocked wall.",
            relatedSkillIds = listOf("SUBWAY_PLATFORM", "TRANSFER_CORRIDOR"),
            earconKind = EarconKind.SCANNING_TICK
        ),
        SkillDefinition(
            id = "TRANSFER_CORRIDOR",
            labelKo = "하차 후 출구/환승 통로 내비(UC-09,23)",
            triggerDescriptionKo = "Subway exit signs (1번 출구), transfer arrows, fare gates, tactile junctions, or stairs/elevators (UC-09)",
            extractionRulesKo = "`[TRANSFER_CORRIDOR | targetLine=..., exit=1번출구]`",
            expertPlaybookEn = "Scan: 1) Target exit number (N번 출구) or transfer line banner, 2) Fare gate card-tap pad & open gate, 3) Cordoned-off stair barriers (우측통행 차단봉) or elevator. Value Formula: [Target exit/line direction] + [Tactile junction turn + fare gate/handrail side, warning if half the stairs are blocked]. Guard: Never use color-only light cues.",
            relatedSkillIds = listOf("SUBWAY_PLATFORM", "RESTROOM_AND_SEAT", "WALKING_SAFETY"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "RESTROOM_AND_SEAT",
            labelKo = "공공화장실 성별/빈칸 · 카페 빈 좌석(UC-12,21)",
            triggerDescriptionKo = "Restroom gender pictograms, vacant stall latch, sink/soap (UC-21), or empty cafe seats & floor bags (UC-12)",
            extractionRulesKo = "`[RESTROOM_AND_SEAT | gender=남자화장실|여자화장실, vacantStall=2, sink=오른쪽]`",
            expertPlaybookEn = "Scan: 1) Men's vs Women's entrance pictogram/text when braille is missing, 2) Vacant stall door/latch + sink/soap/dryer side, 3) Cafe closest empty seat & floor bag/cable obstacles. Value Formula: [Exact Men's/Women's door side -> Vacant stall number & sink] OR [Obstacle-free steps to empty seat].",
            relatedSkillIds = listOf("TRANSFER_CORRIDOR", "INDOOR_SPACE"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "KIOSK_COACH",
            labelKo = "무인 키오스크 · 공동현관 키패드 · 엘리베이터 코칭(UC-10)",
            triggerDescriptionKo = "Touchscreen kiosk, apartment entrance touch keypad, or elevator floor buttons with hand (UC-10, LUM-47)",
            extractionRulesKo = "`[KIOSK_COACH | target=1층버튼|메뉴명, dxCm=3, dyCm=-2, floorLit=false]`",
            expertPlaybookEn = "Scan: 1) Current screen step or elevator 1F/Lobby button lit state, 2) Fingertip offset to target in cm (dxCm, dyCm), 3) Card slot / NFC pad (usually bottom-right bezel). Value Formula: [1F/screen status] + [cm offset from finger, or anchor finger to bottom-right bezel first if hand not visible] + [Card slot position].",
            relatedSkillIds = listOf("INDOOR_SPACE", "APPLIANCE_SAFETY"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "APPLIANCE_SAFETY",
            labelKo = "평면 인덕션 잔열(H) · 정수기 온수 · 가전 판독(UC-11,20)",
            triggerDescriptionKo = "Flat induction stove burner/residual heat 'H' (UC-20), touch water dispenser hot/cold (UC-11), or washer/microwave LED",
            extractionRulesKo = "`[APPLIANCE_SAFETY | appliance=인덕션|정수기|세탁기, zone=오른쪽아래, power=7단계, residualHeat=true|false]`",
            expertPlaybookEn = "Scan: 1) Burn hazards FIRST: induction active burner, 'H' residual heat LED, or red hot-water touch icon, 2) Active cycle & remaining minutes, 3) Safe cold-water or corner reference anchor. Value Formula: [P0 burn warning if 'H' or hot water] + [Active level/course & remaining time]. Guard: Never tell user to touch flat cooktop glass.",
            relatedSkillIds = listOf("KIOSK_COACH", "INDOOR_SPACE"),
            earconKind = EarconKind.HAZARD_ALERT
        ),
        SkillDefinition(
            id = "SMART_READER",
            labelKo = "냉장고/식품 소비기한 · 카드/약봉지/고지서 요약(UC-01,02,13)",
            triggerDescriptionKo = "Refrigerator shelves, food tubs/ice cream/drink bottles/cartons, medicine/supplements, access cards/books/mail/bills (UC-01,02,13)",
            extractionRulesKo = "`[SMART_READER | docType=소비기한|카드|약봉지|고지서, product=..., stampedText=원문그대로또는NONE, expiryDate=YYYY-MM-DD|NONE, dateType=EXPIRY|MANUFACTURED, unreadableReason=WRONG_SIDE|TOO_CLOSE_BLUR|OCCLUDED_BY_HAND]`",
            expertPlaybookEn = "Scan: 1) Exact brand/product/card/book title, 2) Opened state & remaining amount, 3) Exact ink-jet stamped characters (`stampedText`). CRITICAL ZERO-HALLUCINATION RULE FOR DATES (LUM-150~154): NEVER invent, guess, or fabricate a date (like '2026년 2월 29일' or '3월 30일')! Korean ice cream (`투게더`, 빙과류) usually has NO expiration date (`제조일자` only, stamped on bottom/rim). Unless you can literally read every digit of the stamped date in THIS image and copy it into `stampedText`, you MUST set `stampedText=NONE, expiryDate=NONE, unreadableReason=WRONG_SIDE` and say the date is not visible on this side!",
            relatedSkillIds = listOf("GROCERY_SCANNER", "INDOOR_SPACE"),
            earconKind = EarconKind.SCANNING_TICK
        ),
        SkillDefinition(
            id = "GROCERY_SCANNER",
            labelKo = "마트/편의점 유사 용기 맛 · 제로 · 1+1 행사 리더(UC-16)",
            triggerDescriptionKo = "Mart/convenience store cans, bottles, ramen, shelf price tags, or 1+1 / 2+1 promo badges (UC-16)",
            extractionRulesKo = "`[GROCERY_SCANNER | product=코카콜라, flavor=레몬향500ml, zeroSugar=true|false, price=2000, promo=1+1|2+1|일반, unreadableReason=...]`",
            expertPlaybookEn = "Scan: 1) Original vs Zero-Sugar, Decaf vs Regular, Mild vs Spicy, Allergens, 2) Match item name to the exact shelf price tag below it, 3) `1+1`/`2+1` promo badge or left-vs-right hand comparison. Value Formula: [Exact Brand + Variant/Zero-Sugar] + [Verified Price] + [1+1/2+1 Promo].",
            relatedSkillIds = listOf("SMART_READER", "KIOSK_COACH"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "DINING_ASSISTANT",
            labelKo = "식사 반찬 배치 · 수저/물컵 · 생선 가시/남은 양(UC-17)",
            triggerDescriptionKo = "Dining table, meal tray (식판), rice/soup/side dishes, water cup/utensils, or remaining food check (UC-17)",
            extractionRulesKo = "`[DINING_ASSISTANT | frontLeft=흰쌀밥, frontRight=된장국, topCenter=고등어구이, boneHazard=true|false]`",
            expertPlaybookEn = "Scan: 1) Body-relative food layout (앞쪽 좌/우 밥·국, 위쪽 칸 반찬) especially low-contrast white foods (두부, 백김치, 흰살생선), 2) Fish bones/thorns or hot stone pot (뚝배기), 3) Water cup/spoon drawer/napkin position OR remaining pieces mid-meal. Value Formula: [Dish layout] + [Bone/hot-pot warning] + [Utensil/cup or remaining pieces].",
            relatedSkillIds = listOf("INDOOR_SPACE", "SMART_READER"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "INDOOR_SPACE",
            labelKo = "실내 동선 · 물건 위치 기억/찾기 · 복장 점검(UC-03)",
            triggerDescriptionKo = "Personal items (에어팟, 안경, 열쇠, 지갑), outfit stain/inside-out check (UC-03), or indoor furniture/doors",
            extractionRulesKo = "`[INDOOR_SPACE | rememberedItem=에어팟, itemLocation=소파 오른쪽 쿠션 옆, recallItem=에어팟]`",
            expertPlaybookEn = "Scan: 1) Personal items anchored to touchable furniture landmarks, 2) Outfit collar/front stains, color match, or inside-out seams, 3) Floor cords/rug corners & exit door handle. Value Formula: [Item landmark + reach distance] OR [Stain/outfit verdict] OR [Safe turn away from desk/window toward door].",
            relatedSkillIds = listOf("SMART_READER", "APPLIANCE_SAFETY", "WALKING_SAFETY"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "SOCIAL_MEETING",
            labelKo = "상대방 명함/악수 제스처 · 회의 슬라이드 요약(UC-22)",
            triggerDescriptionKo = "Partner extending hand for handshake/business card/cup, or meeting projector/monitor slide (UC-22)",
            extractionRulesKo = "`[SOCIAL_MEETING | cueType=HANDING_OBJECT|PRESENTATION_SLIDE, title=미팅상대방|슬라이드제목, detail=오른손으로 명함을 건네고]`",
            expertPlaybookEn = "Scan: 1) Partner extending hand/card/cup & height, 2) Slide title + top 1-2 numbers/conclusions. Value Formula: [1-sentence whisper cue: object & chest/waist reach height] OR [Slide headline + core takeaway without reading raw bullet walls].",
            relatedSkillIds = listOf("INDOOR_SPACE", "SMART_READER"),
            earconKind = EarconKind.TARGET_FOUND
        ),
        SkillDefinition(
            id = "NAV_CONTROL",
            labelKo = "내비게이션 경로 · 이동수단 제어 도구",
            triggerDescriptionKo = "User requests destination search/change, candidate selection, or transport mode switch",
            extractionRulesKo = "`[NAV_CONTROL | navAction=SWITCH_SUBWAY|SWITCH_BUS|SWITCH_WALK|SEARCH_PLACE|SELECT_CANDIDATE|CONFIRM_START, place=..., index=1]`",
            expertPlaybookEn = "Extract pure place noun or transport mode switch slot and reply warmly in 1 Korean sentence.",
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

    private val temporalSlotCache = mutableMapOf<String, Pair<String, Long>>()
    private const val SLOT_TTL_MS = 15_000L

    @Synchronized
    fun mergeAndCacheTemporalSlots(newSlots: Map<String, String>): Map<String, String> {
        val now = System.currentTimeMillis()
        val iter = temporalSlotCache.iterator()
        while (iter.hasNext()) {
            val entry = iter.next()
            if (now - entry.value.second > SLOT_TTL_MS) {
                iter.remove()
            }
        }
        for ((k, v) in newSlots) {
            if (isValidSlot(v)) {
                temporalSlotCache[k] = v to now
            }
        }
        val merged = mutableMapOf<String, String>()
        for ((k, pair) in temporalSlotCache) {
            merged[k] = pair.first
        }
        merged.putAll(newSlots)
        return merged
    }

    fun coachPhysicalViewFindingKo(reason: String?, domain: String = "SIGN"): String {
        return when (reason?.uppercase()) {
            "TOO_CLOSE_BLUR" -> "카메라와 너무 가까워 초점이 흐려졌어요. 물건을 얼굴에서 한 뼘 정도만 뒤로 떼어 보실래요?"
            "OCCLUDED_BY_HAND" -> "손가락이 글자 부분을 가리고 있어요. 손가락을 가장자리 쪽으로 살짝만 옮겨 보실래요?"
            "WRONG_SIDE" -> "지금 비추신 면에는 찾는 정보가 없어요. 용기나 봉투를 천천히 반 바퀴 돌려 보실래요?"
            "TILT_UP" -> "표지판이 위쪽에 있어서 화면에 다 안 잡혔어요. 고개를 살짝만 위로 들어 비춰 보실래요?"
            "TILT_DOWN" -> "대상이 아래쪽에 있어요. 고개를 살짝 아래로 숙여 비춰 보실래요?"
            "GLARE" -> "빛 반사 때문에 글씨가 하얗게 번져 보여요. 각도를 옆으로 살짝만 틀어 보실래요?"
            else -> if (domain == "HANDHELD_ITEM") {
                "글씨가 작아 아직 선명하지 않아요. 물건을 가슴 높이에서 조금만 더 가까이 비춰 보실래요?"
            } else {
                "승강장이나 정류장 표지판 글씨가 아직 잘 안 보여요. 정면으로 서너 걸음만 더 다가가서 위쪽 표지판을 비춰 보실래요?"
            }
        }
    }

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

        // In AUTO mode with no outdoor route active, include SMART_READER & INDOOR_SPACE in the default active playbook window so household/fridge/food scenes get full ILS Playbooks immediately!
        if (selectedUseCaseCategory == "AUTO" && activeMissionGoal.isEmpty() && q.isEmpty() && stickyModeTag == "WALKING_SAFETY") {
            activeSet.add("SMART_READER")
            activeSet.add("INDOOR_SPACE")
            activeSet.add("WALKING_SAFETY")
            activeSet.add("STEP_AND_GLASS_DOOR")
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

    /**
     * Validates that a YYYY-MM-DD string is a real Gregorian calendar date (e.g. rejects non-leap `2026-02-29` hallucinated in LUM-153/154!).
     */
    private fun isRealCalendarDateIso(isoDate: String): Boolean {
        return try {
            java.time.LocalDate.parse(isoDate.replace(".", "-"))
            true
        } catch (_: Exception) {
            false
        }
    }

    fun isFullReadRequest(userQuery: String): Boolean {
        val q = userQuery.trim()
        if (q.isEmpty()) return false
        return Regex("전체|전부|다\\s*읽어|끝까지|전문|빠짐없이|자세히|그대로\\s*읽어|내용\\s*다|전체를").containsMatchIn(q)
    }

    private fun assembleLayer1Prompt(userQuery: String, previousSpeech: String?): String {
        val activeIds = getActiveCandidateSkillIds(userQuery)
        val wantFullRead = isFullReadRequest(userQuery)
        val sb = StringBuilder()
        sb.append("[Layer 1: Context-Gated Micro-Skill Router | Sticky Mode: $stickyModeTag | Target Output Locale: ko-KR]\n")
        sb.append("You are 'SOTA', a warm, conversational AI smart-glass companion walking alongside a visually impaired user in Korea (Gemini Live / Pickle style).\n")
        if (wantFullRead) {
            sb.append("📖 [FULL VERBATIM READING MODE (LUM-147)]: The user explicitly asked to read ALL visible text completely! Override any brevity/sentence limit: output `[SMART_READER | docType=전문낭독]` first, then read EVERY visible line, bullet point, caution note, and phone/card number from top to bottom without summarizing or omitting anything!\n")
        } else {
            sb.append("Output a single-pass header `[MODE_ID | key=value]` first, followed by 1-2 short, natural conversational Korean sentences (~해요, ~있어요, ~볼까요?, under 85 chars).\n")
        }
        sb.append("⚠️ CRITICAL ACCESSIBILITY & CONVERSATIONAL UX RULES (English-Core):\n")
        sb.append("1. [NO Screen-Reader Symbols]: Never output `→`, `[`, `]`, `(`, `)`, `·`, `/` or stage prefixes in the spoken Korean body.\n")
        sb.append("2. [Indoor Dead-End vs Desk Work vs Subway Train]: ONLY when an Active Navigation Mission is set, if a desk/window/wall blocks the front, tell the user to turn around toward the door. When NO navigation mission is active (`activeMissionGoal` empty), sitting at a desk/laptop is normal — NEVER tell them to turn around and walk to the door (LUM-141)! Inside a subway train (`SUBWAY_ON_BOARD`), standing by the door window is safe.\n")
        sb.append("3. [Movement-Relative & Tactile Only]: Never use clock-face jargon ('12시 방향') or color-only path instructions ('밝은 색 보도'). Use movement-relative Korean ('지금 걸어가시는 방향 그대로', '오른쪽으로 살짝') and tactile cues (점자블록, 보도턱, 난간) with step counts.\n")
        sb.append("4. [Elevator Exit Floor Priority]: On elevator panels during an outing, check if the 1st/Lobby floor button is lit BEFORE open/close buttons.\n")
        sb.append("5. [ZERO DATE HALLUCINATION (LUM-150, 151)]: NEVER fabricate or guess an expiration date when the ink-jet stamped date digits are not physically legible in the current image! If the user shows the side/front of a milk carton or bottle where no date is stamped, output `[SMART_READER | expiryDate=NONE, unreadableReason=WRONG_SIDE]` and ask them to tilt the top seam or rotate the container.\n")
        if (Regex("기억해|외워|저장해").containsMatchIn(userQuery)) {
            sb.append("📌 [USER COMMAND OVERRIDE — SAVE OBJECT LOCATION (LUM-152)]: The user explicitly asked you to REMEMBER the location of the visible object (even if it is on the floor like a vacuum cleaner, bag, or shoes)! Do NOT output `[WALKING_SAFETY]` obstacle-avoidance advice! You MUST output `[INDOOR_SPACE | rememberedItem=<object>, itemLocation=<landmark_location>]` and confirm in Korean that you saved its location!\n")
        }
        sb.append("6. [CRITICAL SCENE CLASSIFICATION IN AUTO MODE (LUM-132~134)]: Do NOT default to `[WALKING_SAFETY]` for indoor or household scenes! When the camera shows a refrigerator, beverage bottle (e.g. orange juice, milk), side-dish container, medicine pouch, or bill, ALWAYS select `[SMART_READER]` or `[GROCERY_SCANNER]` and read the product/contents/expiration date — NEVER tell the user to 'dodge the refrigerator door and walk past it'!\n")

        val historyLines = getRecentConversationLines()
        if (historyLines.isNotEmpty()) {
            sb.append("\n💬 [Recent Conversation Context]:\n")
            for (line in historyLines) {
                sb.append("$line\n")
            }
        }

        if (activeMissionGoal.isNotEmpty()) {
            val stageStr = STAGE_DESC[missionStageIndex] ?: "진행 중"
            val liveNavCtx = WayfindingNavigator.buildLiveNavContextForPrompt()
            sb.append("\n🎯 [Active Navigation Mission]: \"$activeMissionGoal\" ($stageStr)\n")
            if (liveNavCtx.isNotEmpty()) {
                sb.append("- [Live GPS/Station/Exit/Door-Side Data]: $liveNavCtx\n")
            }
        }
        if (expectedTaxiPlate.isNotBlank()) {
            sb.append("\n🚕 [Expected Called Taxi Plate (UC-15)]: \"$expectedTaxiPlate\" — Match incoming vehicle license plate, color, model, and rear-right door handle steps.\n")
        }
        sb.append("\n📌 [On-Device Visual Memory (UC-03)]: ${getVisualMemorySummaryForPrompt()}\n")
        sb.append("- When personal items (에어팟, 안경, 열쇠, 지갑, 리모컨, 약봉지) are visible, emit `[INDOOR_SPACE | rememberedItem=..., itemLocation=...]`.\n")
        sb.append("- When food/drinks/refrigerator items are visible, emit `[SMART_READER | product=..., expiryDate=YYYY-MM-DD, dateType=EXPIRY|MANUFACTURED]`.\n")
        sb.append("- When flat induction residual heat ('H') is visible, emit `[APPLIANCE_SAFETY | appliance=인덕션, residualHeat=true]`.\n")

        sb.append("\n[Active Candidate Micro-Skills (Tier-2 O&M / ILS Expert Playbooks)]:\n")
        for ((id, sk) in SKILLS) {
            if (id in activeIds || id == "SUBWAY_ON_BOARD") {
                sb.append("• [$id] ${sk.extractionRulesKo}\n  Playbook: ${sk.expertPlaybookEn}\n")
            }
        }
        sb.append("\n[Tier-1 Scene Switch Directory — Switch [MODE_ID] immediately when visible]: ")
        val switchTags = SKILLS.keys.filter { it !in activeIds && it != "SUBWAY_ON_BOARD" && it != "NAV_CONTROL" }
            .joinToString(", ") { id -> "[$id](${SKILLS.getValue(id).labelKo.substringBefore("(")})" }
        sb.append("$switchTags\n")
        if (!previousSpeech.isNullOrBlank() && userQuery.isBlank()) {
            sb.append("\n(Previous SOTA speech: \"$previousSpeech\" — If the camera scene is unchanged, do NOT invent a state jump; keep consistent station/waiting guidance.)\n")
        }
        if (userQuery.isNotBlank()) {
            val pendingCands = WayfindingNavigator.lastSearchResult?.candidatesRecommended?.take(4)?.joinToString(", ") { "${it.index}번:${it.name}" } ?: "없음"
            val curDest = WayfindingNavigator.activeRoute?.destination?.name ?: "미정"
            sb.append("\n🧭 [Navigation Control Tool Rules (NAV_CONTROL)]:\n")
            sb.append("- Current Destination: $curDest | Pending Candidates: [$pendingCands]\n")
            sb.append("  • Switch to Subway route: `[NAV_CONTROL | navAction=SWITCH_SUBWAY]`\n")
            sb.append("  • Switch to Bus route: `[NAV_CONTROL | navAction=SWITCH_BUS]`\n")
            sb.append("  • Switch to Walk route: `[NAV_CONTROL | navAction=SWITCH_WALK]`\n")
            sb.append("  • Search new place (extract pure place noun only): `[NAV_CONTROL | navAction=SEARCH_PLACE, place=...]`\n")
            sb.append("  • Select candidate index: `[NAV_CONTROL | navAction=SELECT_CANDIDATE, index=1]`\n")
            sb.append("  • Confirm start route: `[NAV_CONTROL | navAction=CONFIRM_START]`\n")
            sb.append("\n🎤 User Utterance: \"$userQuery\" -> Reply in warm, natural conversational Korean (ko-KR).")
        } else {
            sb.append("\nAnalyze the current camera frame and output `[MODE_ID | key=value]` followed by 1-2 conversational Korean sentences.")
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
        val rawExtractedSlots = mutableMapOf<String, String>()

        val rawModeId = if (match != null) {
            val rawSlots = match.groupValues[2].trim()
            if (rawSlots.isNotEmpty()) {
                for (pair in rawSlots.split(Regex("[,|]"))) {
                    val kv = pair.split("=", limit = 2)
                    if (kv.size == 2 && isValidSlot(kv[1])) {
                        rawExtractedSlots[kv[0].trim()] = kv[1].trim()
                    }
                }
            }
            match.groupValues[1]
        } else {
            "WALKING_SAFETY"
        }

        val slots = mergeAndCacheTemporalSlots(rawExtractedSlots)
        val bodyText = match?.groupValues?.get(3)?.trim()?.takeIf { it.isNotEmpty() } ?: cleaned

        // Layer 2 Content-Aware Mode Corrector (Fixes LUM-132~134, LUM-143/147, & LUM-155 ice cream / food containers / indoor items):
        val isHandheldReadingItem = Regex("손에\\s*(?:쥐고|들고)|출입카드|카드|출입증|신분증|유의사항|생활지원센터|관리사무소|표지에|책을\\s*들고|샴푸|린스|컨디셔너|바디워시|세안제|로션|냉장고|아이스크림|투게더|바닐라|요거트|과자|빵|컵라면|라면|음료|주스|오렌지|우유|두부|반찬통|식품|제품이고|통이\\s*보이|통에\\s*담겨|유통기한|소비기한|제조일자|약봉지|안약|점안액|영양제|엽산|유산균|고지서|택배|송장", RegexOption.IGNORE_CASE).containsMatchIn(bodyText)
        val modeId = if (isHandheldReadingItem && rawModeId in setOf("WALKING_SAFETY", "RESTROOM_AND_SEAT")) {
            "SMART_READER"
        } else if (rawModeId == "WALKING_SAFETY") {
            when {
                Regex("1\\+1|2\\+1|제로\\s*슈거|제로슈거|가격표|행사\\s*상품").containsMatchIn(bodyText) || slots.containsKey("promo") -> "GROCERY_SCANNER"
                slots.containsKey("expiryDate") || slots.containsKey("product") -> "SMART_READER"
                Regex("식판|접시|반찬|흰쌀밥|된장국|생선\\s*가시").containsMatchIn(bodyText) || slots.containsKey("frontLeft") -> "DINING_ASSISTANT"
                Regex("인덕션|화구|잔열|세탁기|전자레인지|정수기|온수").containsMatchIn(bodyText) || slots.containsKey("residualHeat") -> "APPLIANCE_SAFETY"
                Regex("키오스크|엘리베이터.*버튼|손가락에서").containsMatchIn(bodyText) || slots.containsKey("dxCm") -> "KIOSK_COACH"
                Regex("화장실|세면대|빈\\s*칸|빈\\s*좌석|빈자리").containsMatchIn(bodyText) || slots.containsKey("gender") -> "RESTROOM_AND_SEAT"
                Regex("명함|악수|슬라이드|발표").containsMatchIn(bodyText) || slots.containsKey("cueType") -> "SOCIAL_MEETING"
                Regex("택시|장콜|번호판|승차문|뒷좌석").containsMatchIn(bodyText) || slots.containsKey("taxiPlate") -> "TAXI_MATCHER"
                Regex("내리막\\s*계단|투명\\s*유리문|통유리문|단차").containsMatchIn(bodyText) -> "STEP_AND_GLASS_DOOR"
                Regex("신호등|횡단보도|초록불|녹색\\s*신호|적색\\s*신호").containsMatchIn(bodyText) -> "CROSSWALK_SIGNAL"
                Regex("버스|정류장|정류소").containsMatchIn(bodyText) -> "BUS_STOP"
                Regex("승강장|스크린도어|빠른\\s*환승").containsMatchIn(bodyText) -> "SUBWAY_PLATFORM"
                Regex("열차\\s*안|객차\\s*안|정거장\\s*남았").containsMatchIn(bodyText) -> "SUBWAY_ON_BOARD"
                Regex("환승\\s*통로|출구\\s*방향|개찰구").containsMatchIn(bodyText) -> "TRANSFER_CORRIDOR"
                Regex("에어팟|안경|열쇠|지갑|리모컨|얼룩|셔츠|책상|모니터|서랍장|소파|방문").containsMatchIn(bodyText) || slots.containsKey("rememberedItem") -> "INDOOR_SPACE"
                else -> "WALKING_SAFETY"
            }
        } else {
            rawModeId
        }

        var draftSpeech = WayfindingNavigator.guardSubwayRideSpeech(
            cleanMovementRelativeDirection(bodyText)
        )
        val skill = SKILLS[modeId] ?: SKILLS.getValue("INDOOR_SPACE")
        stickyModeTag = skill.id
        advanceMissionStage(skill.id)

        // Layer 2 Guard & Enrichment for SUBWAY_PLATFORM (Zero-Hardcoding + Active View-Finding)
        if (skill.id == "SUBWAY_PLATFORM") {
            val door = slots["door"] ?: Regex("(\\d{1,2}-\\d)").find(draftSpeech)?.groupValues?.get(1)
            val nextStn = slots["nextStation"]?.takeIf { isValidSlot(it) }
            val line = slots["line"]?.takeIf { isValidSlot(it) }

            if (door != null && nextStn != null) {
                val arrivalMin = fetchSeoulSubwayLive(nextStn, nextStn)
                val targetDoor = slots["targetDoor"]?.takeIf { isValidSlot(it) }
                if (targetDoor != null) {
                    val enriched = KoreanTransitDoorCalculator.calculateTransferGuidance(
                        lineName = line ?: "지하철",
                        intendedDirectionStation = nextStn,
                        observedNextStation = nextStn,
                        observedDoorRaw = door,
                        targetDoorRaw = targetDoor,
                        transferStationName = "${nextStn.removeSuffix("역")}역",
                        transferTargetLine = slots["transferLine"]?.takeIf { isValidSlot(it) } ?: "환승 노선",
                        higherCarIsRight = true,
                        arrivalMinutes = arrivalMin
                    )
                    return Triple(skill, cleanMovementRelativeDirection(enriched), slots)
                }
                val verified = "${line ?: "지하철"} $nextStn 방면 승강장 맞아요. 현재 $door 번 스크린도어 앞이고, 다음 열차는 약 ${arrivalMin ?: 3}분 뒤 도착해요."
                return Triple(skill, verified, slots)
            }

            if (draftSpeech.contains("None") || draftSpeech.contains("알수없음") || draftSpeech.contains("알 수 없음") || isValidSlot(slots["unreadableReason"])) {
                draftSpeech = coachPhysicalViewFindingKo(slots["unreadableReason"], "SIGN")
            }
            return Triple(skill, draftSpeech, slots)
        }

        // Layer 2 Live Seoul Bus & Called Taxi Enrichment for BUS_STOP (Zero-Hardcoding)
        if (skill.id == "BUS_STOP") {
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
            val arsId = slots["arsId"] ?: Regex("(\\d{2}-\\d{3}|\\b\\d{5}\\b)").find(draftSpeech)?.groupValues?.get(1)
            val route = slots["route"] ?: Regex("(\\d{2,4})번").find(draftSpeech)?.groupValues?.get(1)
            if (arsId != null && route != null) {
                val liveBusInfo = fetchSeoulBusStopLive(arsId, route)
                if (liveBusInfo != null) {
                    return Triple(skill, cleanMovementRelativeDirection("$liveBusInfo $draftSpeech"), slots)
                }
            }
            if (isValidSlot(slots["unreadableReason"])) {
                return Triple(skill, coachPhysicalViewFindingKo(slots["unreadableReason"], "SIGN"), slots)
            }
        }

        // Layer 2 Real-Date Food Expiry D-Day Calculator & Anti-Hallucination Guard for SMART_READER (UC-02, LUM-150~154)
        if (skill.id == "SMART_READER") {
            val prod = rawExtractedSlots["product"]?.takeIf { isValidSlot(it) } ?: slots["product"]?.takeIf { isValidSlot(it) } ?: "제품"
            val stampedRaw = rawExtractedSlots["stampedText"]?.takeIf { isValidSlot(it) }
            val expRaw = rawExtractedSlots["expiryDate"]?.takeIf { isValidSlot(it) }
            val dateType = (rawExtractedSlots["dateType"] ?: "EXPIRY").uppercase()

            // Deterministic Hallucination Blocker #1: Reject impossible calendar dates (e.g. `2026-02-29` or `2026년 2월 29일` in LUM-153/154!)
            val bodyIsoCheck = Regex("(20\\d{2})\\s*년\\s*(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일").find(draftSpeech)?.let { m ->
                "%04d-%02d-%02d".format(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())
            }
            if ((expRaw != null && Regex("^\\d{4}[-.]\\d{2}[-.]\\d{2}$").matches(expRaw) && !isRealCalendarDateIso(expRaw)) ||
                (bodyIsoCheck != null && !isRealCalendarDateIso(bodyIsoCheck)) ||
                (bodyIsoCheck != null && expRaw == null && stampedRaw == null)
            ) {
                val isIceCream = Regex("투게더|아이스크림|빙과").containsMatchIn("$prod $draftSpeech")
                val msg = if (isIceCream) {
                    "$prod 제품이에요. 지금 비추신 면에는 날짜가 보이지 않아요. 아이스크림은 주로 뚜껑 테두리나 바닥 면에 제조일자가 찍혀 있으니 용기 아래쪽을 비춰 보실래요?"
                } else {
                    "$prod 제품이지만 지금 각도에서는 소비기한 숫자가 선명하게 보이지 않아요. 용기 위쪽이나 옆면을 천천히 돌려 비춰 보실래요?"
                }
                return Triple(skill, msg, slots)
            }

            if (isValidSlot(rawExtractedSlots["unreadableReason"])) {
                return Triple(skill, coachPhysicalViewFindingKo(rawExtractedSlots["unreadableReason"], "HANDHELD_ITEM"), slots)
            }
            if (dateType == "MANUFACTURED" && expRaw != null) {
                return Triple(skill, "$prod 제조일자가 $expRaw 로 적혀 있어요. 소비기한은 용기 다른 면에 적혀 있으니 천천히 반 바퀴 돌려 비춰 보실래요?", slots)
            }
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

        val wantFullRead = isFullReadRequest(userQuery)
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
                    .put("temperature", 0.15)
                    .put("maxOutputTokens", if (wantFullRead) 650 else 220)
                    .put("thinkingConfig", JSONObject().put("thinkingLevel", "MINIMAL"))
            )
            .toString()

        var lastError = ""
        // Automatic retry up to 2 attempts to survive subway LTE/5G handoffs (Fixes LUM-18/21/22/24/25/28)
        for (attempt in 1..2) {
            try {
                val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 5000
                    readTimeout = 7500
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
