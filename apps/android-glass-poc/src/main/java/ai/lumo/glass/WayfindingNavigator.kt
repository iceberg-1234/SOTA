package ai.lumo.glass

import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

data class PoiCandidate(
    val index: Int,
    val name: String,
    val categoryLabelKo: String,
    val areaRoadPrefixKo: String,
    val spokenPlaceWithAddrKo: String,
    val shortAddressKo: String,
    val lat: Double,
    val lng: Double,
    val distanceMeters: Int,
    val walkMinutes: Int,
    val transitMinutes: Int,
    val bearingDeg: Int,
    val cardinalKo: String,
    val recommendationScore: Int
)

data class NavTurnStep(
    val stepIndex: Int,
    val roadName: String,
    val distanceMeters: Int,
    val stepsCount: Int,
    val turnDirectionKo: String,
    val targetLat: Double,
    val targetLng: Double,
    val instructionKo: String
)

data class ActivePedestrianRoute(
    val routeSource: String,
    val originAddressKo: String,
    val originLat: Double,
    val originLng: Double,
    val destination: PoiCandidate,
    val totalDistanceMeters: Int,
    val totalStepsCount: Int,
    val estimatedMinutes: Int,
    val turnSteps: List<NavTurnStep>,
    val transitSummaryKo: String = "",
    val subwayRouteStations: List<String> = emptyList(),
    val destinationDoorSideKo: String = "오른쪽",
    val targetExitTextKo: String = "출구",
    val macroPlanOverviewKo: String = "",
    val macroMilestones: List<String> = emptyList(),
    var isConfirmedByUser: Boolean = false,
    var currentStepIndex: Int = 0
)

/**
 * Powered by Official SKT TMAP APIs (`BuildConfig.TMAP_API_KEY`):
 * 1. TMAP Reverse Geocoding (`/tmap/geo/reversegeocoding`) for exact starting road/building address
 * 2. TMAP POI Integrated Search (`/tmap/pois`, `searchtypCd=R` & `A` + Brand Expansion `이마트` -> `이마트` + `이마트에브리데이`)
 *    with dual sorting (`RECOMMENDED` vs `DISTANCE`)
 * 3. TMAP Pedestrian Turn-by-Turn Route (`/tmap/routes/pedestrian?version=1`)
 * 4. TMAP Public Transit Multi-Modal Route (`/transit/routes`) for bus/subway/transfer legs when > 1km.
 */
object WayfindingNavigator {
    private const val STEP_LENGTH_M = 0.7
    private val EXCLUDED_SUB_POI = Regex("주차장|충전소|정문|후문|휴게소|ATM|세탁|안경|치과|의원|화장실|고객센터|하역장")

    @Volatile
    var currentLat: Double = 37.5006

    @Volatile
    var currentLng: Double = 127.0364

    @Volatile
    var hasGpsFix: Boolean = false

    @Volatile
    var currentCompassHeadingDeg: Float = 0f

    @Volatile
    var hasCompassFix: Boolean = false

    @Volatile
    var activeRoute: ActivePedestrianRoute? = null
        private set

    @Volatile
    var lastSearchResult: SearchCandidatesResult? = null
        private set

    fun clearRoute() {
        activeRoute = null
    }

    fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Int {
        val r = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLng / 2) * sin(dLng / 2)
        return (r * 2 * atan2(sqrt(a), sqrt(1 - a))).roundToInt()
    }

    fun bearingDegrees(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Int {
        val dLng = Math.toRadians(lng2 - lng1)
        val y = sin(dLng) * cos(Math.toRadians(lat2))
        val x = cos(Math.toRadians(lat1)) * sin(Math.toRadians(lat2)) -
            sin(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * cos(dLng)
        return ((Math.toDegrees(atan2(y, x)).roundToInt()) + 360) % 360
    }

    fun bearingToCardinalKo(deg: Int): String {
        val dirs = listOf("북쪽", "북동쪽", "동쪽", "남동쪽", "남쪽", "남서쪽", "서쪽", "북서쪽")
        return dirs[((deg + 22) / 45) % 8]
    }

    fun coachHeadingAlignmentKo(userHeadingDeg: Float, targetBearingDeg: Int): String {
        val diff = ((targetBearingDeg - userHeadingDeg.roundToInt() + 540) % 360) - 180
        val absDiff = abs(diff)
        return when {
            absDiff <= 30 -> "몸 방향이 경로와 일치합니다(그대로 직진 가능)"
            absDiff >= 135 -> "경로와 반대 방향을 보고 계십니다(제자리에서 뒤로 180도 돌아서야 함)"
            diff > 0 -> "목적지 방향은 현재 몸 기준 오른쪽으로 약 ${absDiff}도 방향입니다"
            else -> "목적지 방향은 현재 몸 기준 왼쪽으로 약 ${absDiff}도 방향입니다"
        }
    }

    private val SEOUL_SUBWAY_LINES: Map<String, List<String>> = mapOf(
        "2호선" to listOf(
            "시청", "을지로입구", "을지로3가", "을지로4가", "동대문역사문화공원", "신당", "상왕십리",
            "왕십리", "한양대", "뚝섬", "성수", "건대입구", "구의", "강변", "잠실나루", "잠실",
            "잠실새내", "종합운동장", "삼성", "선릉", "역삼", "강남", "교대", "서초", "방배", "사당",
            "낙성대", "서울대입구", "봉천", "신림", "신대방", "구로디지털단지", "대림", "신도림",
            "문래", "영등포구청", "당산", "합정", "홍대입구", "신촌", "이대", "아현", "충정로"
        ),
        "3호선" to listOf(
            "종로3가", "을지로3가", "충무로", "동대입구", "약수", "금호", "옥수", "압구정", "신사",
            "잠원", "고속터미널", "교대", "남부터미널", "양재", "매봉", "도곡", "대치", "학여울", "수서"
        ),
        "4호선" to listOf(
            "혜화", "동대문", "동대문역사문화공원", "충무로", "명동", "회현", "서울역", "숙대입구",
            "삼각지", "신용산", "이촌", "동작", "총신대입구", "사당"
        ),
        "5호선" to listOf(
            "광화문", "종로3가", "을지로4가", "동대문역사문화공원", "청구", "신금호", "행당",
            "왕십리", "마장", "답십리", "장한평", "군자", "아차산", "광나루", "천호", "강동",
            "여의도", "여의나루", "마포", "공덕", "충정로"
        ),
        "7호선" to listOf(
            "건대입구", "자양", "청담", "강남구청", "학동", "논현", "반포", "고속터미널", "내방",
            "이수", "남성", "숭실대입구", "대림"
        ),
        "9호선" to listOf(
            "김포공항", "당산", "국회의사당", "여의도", "샛강", "노량진", "흑석", "동작",
            "고속터미널", "신논현", "언주", "선정릉", "삼성중앙", "봉은사", "종합운동장", "석촌"
        ),
        "수인분당선" to listOf(
            "청량리", "왕십리", "서울숲", "압구정로데오", "강남구청", "선정릉", "선릉", "한티", "도곡", "수서"
        ),
        "신분당선" to listOf("신사", "논현", "신논현", "강남", "양재", "양재시민의숲", "판교")
    )

    private fun normalizeStationCore(raw: String): String {
        return raw.replace(Regex("\\[[^\\]]*]"), "")
            .replace(Regex("\\([^)]*\\)"), "")
            .replace(Regex("(?:수도권|서울)?(?:\\d+호선|수인분당선|신분당선|경의중앙선|공항철도|경춘선|우이신설선|신림선|김포골드라인|서해선)"), "")
            .replace(Regex("\\d+번출구"), "")
            .replace(" ", "")
            .removeSuffix("역")
    }

    data class StationCoordDoor(val lat: Double, val lng: Double, val doorSideKo: String)

    private val SEOUL_STATION_COORDS: Map<String, StationCoordDoor> = mapOf(
        "상왕십리" to StationCoordDoor(37.5643, 127.0293, "오른쪽"),
        "왕십리" to StationCoordDoor(37.5612, 127.0370, "오른쪽"),
        "한양대" to StationCoordDoor(37.5553, 127.0436, "오른쪽"),
        "뚝섬" to StationCoordDoor(37.5472, 127.0474, "오른쪽"),
        "성수" to StationCoordDoor(37.5446, 127.0560, "오른쪽"),
        "건대입구" to StationCoordDoor(37.5404, 127.0692, "오른쪽"),
        "구의" to StationCoordDoor(37.5371, 127.0861, "오른쪽"),
        "강변" to StationCoordDoor(37.5351, 127.0947, "오른쪽"),
        "잠실나루" to StationCoordDoor(37.5207, 127.1038, "왼쪽"),
        "잠실" to StationCoordDoor(37.5133, 127.1001, "오른쪽"),
        "잠실새내" to StationCoordDoor(37.5116, 127.0862, "오른쪽"),
        "종합운동장" to StationCoordDoor(37.5110, 127.0736, "오른쪽"),
        "삼성" to StationCoordDoor(37.5088, 127.0632, "왼쪽"),
        "선릉" to StationCoordDoor(37.5045, 127.0490, "오른쪽"),
        "역삼" to StationCoordDoor(37.5006, 127.0364, "오른쪽"),
        "강남" to StationCoordDoor(37.4979, 127.0276, "오른쪽"),
        "교대" to StationCoordDoor(37.4934, 127.0141, "오른쪽"),
        "서초" to StationCoordDoor(37.4919, 127.0079, "오른쪽"),
        "방배" to StationCoordDoor(37.4814, 126.9976, "오른쪽"),
        "사당" to StationCoordDoor(37.4765, 126.9816, "오른쪽"),
        "신도림" to StationCoordDoor(37.5088, 126.8913, "왼쪽"),
        "여의도" to StationCoordDoor(37.5216, 126.9242, "오른쪽"),
        "행당" to StationCoordDoor(37.5574, 127.0295, "오른쪽"),
        "답십리" to StationCoordDoor(37.5667, 127.0527, "오른쪽"),
        "군자" to StationCoordDoor(37.5571, 127.0795, "오른쪽"),
        "아차산" to StationCoordDoor(37.5519, 127.0898, "오른쪽"),
        "광나루" to StationCoordDoor(37.5453, 127.1036, "오른쪽")
    )

    data class SubwayRoutePlanData(
        val summaryKo: String,
        val allStations: List<String>,
        val destDoorSideKo: String
    )

    fun computeSeoulSubwayRoutePlan(startStnRaw: String, endStnRaw: String): SubwayRoutePlanData? {
        val sCore = normalizeStationCore(startStnRaw)
        val eCore = normalizeStationCore(endStnRaw)
        if (sCore.isEmpty() || eCore.isEmpty() || sCore == eCore) return null
        val destDoor = SEOUL_STATION_COORDS[eCore]?.doorSideKo ?: "오른쪽"

        // 1. Direct same-line route
        for ((lineName, stations) in SEOUL_SUBWAY_LINES) {
            val sIdx = stations.indexOf(sCore)
            val eIdx = stations.indexOf(eCore)
            if (sIdx != -1 && eIdx != -1) {
                val path = mutableListOf<String>()
                if (lineName == "2호선") {
                    val n = stations.size
                    val fwd = (eIdx - sIdx + n) % n
                    val bwd = (sIdx - eIdx + n) % n
                    if (fwd <= bwd) {
                        for (i in 1..fwd) path.add(stations[(sIdx + i) % n])
                    } else {
                        for (i in 1..bwd) path.add(stations[(sIdx - i + n) % n])
                    }
                } else {
                    if (sIdx < eIdx) {
                        path.addAll(stations.subList(sIdx + 1, eIdx + 1))
                    } else {
                        path.addAll(stations.subList(eIdx, sIdx).reversed())
                    }
                }
                val stops = path.size
                val mins = max(2, stops * 2)
                val nextStn = path.firstOrNull() ?: eCore
                val viaSample = if (path.size > 2) "${path.dropLast(1).take(3).joinToString(", ")} 등을 지나 " else ""
                val summary = "${sCore}역에서 $lineName $nextStn 방면 열차를 타고 ${viaSample}${stops}정거장, 약 ${mins}분 이동해 ${eCore}역, ${destDoor} 문 열림, 에서 하차"
                return SubwayRoutePlanData(summary, listOf(sCore) + path, destDoor)
            }
        }

        // 2. 1-Transfer route
        for ((lineA, stnsA) in SEOUL_SUBWAY_LINES) {
            if (!stnsA.contains(sCore)) continue
            for ((lineB, stnsB) in SEOUL_SUBWAY_LINES) {
                if (lineA == lineB || !stnsB.contains(eCore)) continue
                val transferStn = stnsA.firstOrNull { stnsB.contains(it) } ?: continue
                val leg1 = computeSeoulSubwayRoutePlan(sCore, transferStn) ?: continue
                val leg2 = computeSeoulSubwayRoutePlan(transferStn, eCore) ?: continue
                val combined = leg1.allStations + leg2.allStations.drop(1)
                val summary = "${sCore}역에서 $lineA 탑승 후 ${transferStn}역에서 ${lineB}으로 환승하여 ${eCore}역, ${destDoor} 문 열림, 에서 하차"
                return SubwayRoutePlanData(summary, combined, destDoor)
            }
        }
        return null
    }

    fun computeSeoulSubwayRouteSummaryKo(startStnRaw: String, endStnRaw: String): String? {
        return computeSeoulSubwayRoutePlan(startStnRaw, endStnRaw)?.summaryKo
    }

    fun findNearestSubwayStation(lat: Double, lng: Double): Pair<String, Int>? {
        val tmapKey = BuildConfig.TMAP_API_KEY
        if (tmapKey.isBlank()) return null
        return try {
            val url =
                "https://apis.openapi.sk.com/tmap/pois?version=1&searchKeyword=${URLEncoder.encode("지하철역", "UTF-8")}&searchtypCd=R&centerLon=$lng&centerLat=$lat&radius=3&reqCoordType=WGS84GEO&resCoordType=WGS84GEO&count=6"
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 3500
                readTimeout = 3500
                setRequestProperty("appKey", tmapKey)
                setRequestProperty("Accept", "application/json")
            }
            if (conn.responseCode !in 200..299) return null
            val pois = JSONObject(conn.inputStream.bufferedReader().readText())
                .optJSONObject("searchPoiInfo")?.optJSONObject("pois")?.optJSONArray("poi") ?: return null
            for (i in 0 until pois.length()) {
                val p = pois.optJSONObject(i) ?: continue
                val rawName = p.optString("name", "").trim()
                val biz = p.optString("lowerBizName", "")
                if (biz == "지하철역" || rawName.contains("호선]") || (rawName.endsWith("역") && !rawName.contains("출구"))) {
                    val sLat = p.optString("noorLat", p.optString("frontLat")).toDoubleOrNull() ?: continue
                    val sLon = p.optString("noorLon", p.optString("frontLon")).toDoubleOrNull() ?: continue
                    val dist = haversineMeters(lat, lng, sLat, sLon)
                    val cleanName = rawName.replace(Regex("\\[(?:수도권)?([^\\]]+)]"), " $1").trim()
                    return cleanName to dist
                }
            }
            null
        } catch (_: Exception) {
            null
        }
    }

    private val CONVERSATIONAL_STOPWORDS = setOf(
        "아니", "아니야", "아뇨", "그냥", "일단", "그러면", "그럼", "대신", "취소",
        "목적지", "목적지를", "바꿔", "바꿔줘", "바꿀래", "바꿀게요", "변경", "변경해줘",
        "그게", "아니라", "말고", "거기", "여기", "저기", "아까", "말한", "데", "곳",
        "조금", "더", "가까운", "먼", "다른", "근처", "주변", "인근", "쪽으로", "쪽",
        "지하철", "지하철로", "전철", "전철로", "버스", "버스로", "대중교통", "대중교통으로",
        "도보", "도보로", "걸어서", "노선", "노선도", "경로", "코스", "코스로", "타고", "타는",
        "탄다고", "탈래", "안", "타고싶어", "가고싶어", "가자", "갈래", "가는", "길", "길찾기",
        "검색", "검색해", "검색해줘", "찾아", "찾아줘", "찾아봐", "안내", "안내해", "안내해줘", "알려줘", "다시", "짜줘",
        "루모", "루모야", "지금", "여기서", "나", "내", "제일", "가장"
    )

    fun tokenizePlaceQuery(rawInput: String): List<String> {
        val cleaned = rawInput.replace(Regex("[?!.,~\"'()\\[\\]]"), " ").trim()
        if (cleaned.isEmpty()) return emptyList()
        val result = mutableListOf<String>()
        for (tok in cleaned.split(Regex("\\s+"))) {
            if (tok in CONVERSATIONAL_STOPWORDS) continue
            val stripped = tok.replace(Regex("^(.{1,}?)(?:으로|로|에서|까지|이랑|랑|이나|나|은|는|이|가|을|를)$"), "$1")
            if (stripped in CONVERSATIONAL_STOPWORDS) continue
            if (stripped.length >= 2) {
                result.add(stripped)
            }
        }
        return result
    }

    fun extractCleanPlaceQuery(rawInput: String): String {
        return tokenizePlaceQuery(rawInput).joinToString(" ")
    }

    fun doesPoiMatchTokens(poiName: String, poiAddr: String, tokens: List<String>): Boolean {
        if (tokens.isEmpty()) return false
        val haystack = "$poiName $poiAddr".replace(" ", "")
        return tokens.any { tok ->
            val core = tok.removeSuffix("역")
            core.length >= 2 && haystack.contains(core)
        }
    }
    private fun expandBrandQueries(rawQuery: String): List<String> {
        val q = extractCleanPlaceQuery(rawQuery)
        if (q.isEmpty()) return emptyList()
        if (q == "이마트") return listOf("이마트", "이마트에브리데이")
        if (q == "홈플러스") return listOf("홈플러스", "홈플러스익스프레스")
        if (q == "롯데마트") return listOf("롯데마트", "롯데슈퍼")
        val tokens = tokenizePlaceQuery(q)
        val queries = linkedSetOf(q)
        if (tokens.size >= 3) {
            // LUM-138: Drop penultimate token (often an STT neighborhood mishearing like "홈즈" for "홍제")
            val withoutPenultimate = (tokens.dropLast(2) + tokens.last()).joinToString(" ")
            queries.add(withoutPenultimate)
        }
        return queries.toList()
    }

    private fun classifyStoreCategoryAndIntent(name: String, bizName: String, rawQuery: String): Pair<String, Int> {
        val n = name.replace(" ", "").replace(Regex("\\[[^\\]]*]"), "").replace(Regex("\\([^)]*\\)"), "")
        val q = rawQuery.replace(" ", "")
        if (bizName == "지하철역" || name.contains("호선")) {
            return "지하철역" to 165
        }
        if (bizName.contains("지하철") || n == q) {
            return (if (bizName.contains("지하철")) "지하철출구" else bizName.ifBlank { "주요장소" }) to (if (n == q) 150 else 115)
        }
        if (n.contains("에브리데이") || n.contains("익스프레스") || n.contains("롯데슈퍼") || n.contains("더프레시") || bizName.contains("슈퍼")) {
            return "대형슈퍼·에브리데이" to (if (q.contains("에브리데이")) 100 else 96)
        }
        if (n.contains("이마트24") || bizName.contains("편의점")) {
            return "편의점·이마트24" to (if (q.contains("24") || q.contains("편의점")) 100 else 80)
        }
        if (n.contains("노브랜드")) {
            return "노브랜드" to 88
        }
        if (n.contains("이마트") || n.contains("홈플러스") || n.contains("롯데마트") || bizName.contains("대형마트")) {
            return "대형마트" to 100
        }
        return (bizName.ifBlank { "일반장소" }) to 90
    }

    fun reverseGeocodeOrigin(lat: Double, lng: Double): String {
        val tmapKey = BuildConfig.TMAP_API_KEY
        if (tmapKey.isNotBlank()) {
            try {
                val url =
                    "https://apis.openapi.sk.com/tmap/geo/reversegeocoding?version=1&lat=$lat&lon=$lng&coordType=WGS84GEO&addressType=A10"
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 4000
                    readTimeout = 4000
                    setRequestProperty("appKey", tmapKey)
                    setRequestProperty("Accept", "application/json")
                }
                if (conn.responseCode in 200..299) {
                    val info = JSONObject(conn.inputStream.bufferedReader().readText()).optJSONObject("addressInfo")
                    if (info != null) {
                        val addr = listOf(
                            info.optString("city_do"),
                            info.optString("gu_gun"),
                            info.optString("roadName"),
                            info.optString("buildingIndex"),
                            info.optString("buildingName")
                        ).filter { it.isNotBlank() }.joinToString(" ").replace("서울특별시 ", "서울 ").trim()
                        if (addr.isNotBlank()) return addr
                    }
                }
            } catch (_: Exception) {}
        }
        return "현재 위치 (${String.format(Locale.US, "%.4f, %.4f", lat, lng)})"
    }

    data class SearchCandidatesResult(
        val originAddressKo: String,
        val originLat: Double,
        val originLng: Double,
        val candidatesRecommended: List<PoiCandidate>,
        val candidatesByDistance: List<PoiCandidate>,
        val spokenConfirmationPromptKo: String
    )

    fun searchDestinationCandidates(query: String): SearchCandidatesResult {
        val oLat = currentLat
        val oLng = currentLng
        val originAddressKo = reverseGeocodeOrigin(oLat, oLng)
        val q = extractCleanPlaceQuery(query)
        val rawList = mutableListOf<PoiCandidate>()
        val tmapKey = BuildConfig.TMAP_API_KEY

        if (q.isEmpty()) {
            return SearchCandidatesResult(
                originAddressKo = originAddressKo,
                originLat = oLat,
                originLng = oLng,
                candidatesRecommended = emptyList(),
                candidatesByDistance = emptyList(),
                spokenConfirmationPromptKo = "가고 싶은 역 이름이나 장소 이름을 말씀해 주세요. 예를 들어 구의역 가자, 또는 이마트 찾아줘처럼 말씀하시면 돼요."
            )
        }

        if (tmapKey.isNotBlank()) {
            val keywords = expandBrandQueries(q)
            val queryTokens = tokenizePlaceQuery(q)
            for (kw in keywords) {
                for (searchType in listOf("A", "R")) {
                    try {
                        val url =
                            "https://apis.openapi.sk.com/tmap/pois?version=1&searchKeyword=${URLEncoder.encode(kw, "UTF-8")}&searchtypCd=$searchType&centerLon=$oLng&centerLat=$oLat&radius=0&reqCoordType=WGS84GEO&resCoordType=WGS84GEO&count=12"
                        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                            connectTimeout = 4000
                            readTimeout = 4000
                            setRequestProperty("appKey", tmapKey)
                            setRequestProperty("Accept", "application/json")
                        }
                        if (conn.responseCode !in 200..299) continue
                        val root = JSONObject(conn.inputStream.bufferedReader().readText())
                        val pois = root.optJSONObject("searchPoiInfo")?.optJSONObject("pois")?.optJSONArray("poi") ?: continue
                        for (i in 0 until pois.length()) {
                            val p = pois.optJSONObject(i) ?: continue
                            val rawName = p.optString("name", "").trim()
                            if (rawName.isEmpty() || EXCLUDED_SUB_POI.containsMatchIn(rawName)) continue
                            val addr = listOf(
                                p.optString("middleAddrName"),
                                p.optString("roadName"),
                                p.optString("firstBuildNo")
                            ).filter { it.isNotBlank() }.joinToString(" ").trim()
                            if (!doesPoiMatchTokens(rawName, addr, queryTokens)) continue
                            val name = rawName.replace(Regex("\\[(?:수도권)?([^\\]]+)]"), " $1").trim()
                            val lat = p.optString("noorLat", p.optString("frontLat")).toDoubleOrNull() ?: continue
                            val lon = p.optString("noorLon", p.optString("frontLon")).toDoubleOrNull() ?: continue
                            val bizName = p.optString("lowerBizName", "")

                            val dist = max(5, haversineMeters(oLat, oLng, lat, lon))
                            val brg = bearingDegrees(oLat, oLng, lat, lon)
                            val (catKo, intentScore) = classifyStoreCategoryAndIntent(name, bizName, q)
                            val distScore = (100.0 / (1.0 + (dist / 450.0).pow(1.35))).roundToInt()
                            val walkScore = if (dist <= 900) 100 else if (dist <= 1600) 75 else 35
                            val recScore = (0.50 * distScore + 0.35 * intentScore + 0.15 * walkScore).roundToInt()

                            val areaRoadPrefix = listOf(
                                p.optString("middleAddrName"),
                                p.optString("roadName").ifBlank { p.optString("detailAddrName") }
                            ).filter { it.isNotBlank() }.joinToString(" ").trim()
                            val spokenWithAddr = if (areaRoadPrefix.isNotBlank()) "$areaRoadPrefix 근처 $name" else name
                            val transitMin = if (dist <= 400) {
                                max(4, (dist / 52.0).roundToInt())
                            } else {
                                val km = dist / 1000.0
                                val transferBuf = if (dist >= 4500) 7 else 0
                                max(12, (15.0 + km * 3.6 + transferBuf).roundToInt())
                            }

                            val isDup = rawList.any {
                                haversineMeters(it.lat, it.lng, lat, lon) < 35 &&
                                    it.name.replace(" ", "") == name.replace(" ", "")
                            }
                            if (!isDup) {
                                rawList.add(
                                    PoiCandidate(
                                        index = rawList.size + 1,
                                        name = name,
                                        categoryLabelKo = catKo,
                                        areaRoadPrefixKo = areaRoadPrefix,
                                        spokenPlaceWithAddrKo = spokenWithAddr,
                                        shortAddressKo = spokenWithAddr,
                                        lat = lat,
                                        lng = lon,
                                        distanceMeters = dist,
                                        walkMinutes = max(1, (dist / 65.0).roundToInt()),
                                        transitMinutes = transitMin,
                                        bearingDeg = brg,
                                        cardinalKo = bearingToCardinalKo(brg),
                                        recommendationScore = recScore
                                    )
                                )
                            }
                        }
                    } catch (_: Exception) {}
                }
            }
        }

        // LUM-69 Fix: NEVER invent a fake hallucinated POI when TMAP returns 0 results!
        if (rawList.isEmpty()) {
            val emptyRes = SearchCandidatesResult(
                originAddressKo = originAddressKo,
                originLat = oLat,
                originLng = oLng,
                candidatesRecommended = emptyList(),
                candidatesByDistance = emptyList(),
                spokenConfirmationPromptKo = "'$q'에 해당하는 장소를 찾지 못했어요. 가고 싶은 역 이름이나 매장 이름을 다시 말씀해 주실래요?"
            )
            lastSearchResult = emptyRes
            return emptyRes
        }

        val byRec = rawList.sortedWith(
            compareByDescending<PoiCandidate> { it.recommendationScore }.thenBy { it.distanceMeters }
        ).take(8).mapIndexed { idx, c -> c.copy(index = idx + 1) }

        val byDist = rawList.sortedBy { it.distanceMeters }
            .take(8).mapIndexed { idx, c -> c.copy(index = idx + 1) }

        fun formatCandidateEtaKo(c: PoiCandidate): String {
            return if (c.distanceMeters >= 350) {
                "대중교통 약 ${c.transitMinutes}분"
            } else {
                "도보 약 ${c.walkMinutes}분"
            }
        }

        val first = byRec.firstOrNull()
        val second = byRec.getOrNull(1)
        val promptKo = if (first != null && second != null) {
            "지금 계신 곳은 $originAddressKo 근처예요. 첫 번째 추천은 ${formatCandidateEtaKo(first)} 걸리는 ${first.spokenPlaceWithAddrKo}이고, 두 번째는 ${formatCandidateEtaKo(second)} 거리의 ${second.spokenPlaceWithAddrKo}예요. 어디로 안내해 드릴까요?"
        } else if (first != null) {
            "지금 계신 $originAddressKo 근처에서 ${formatCandidateEtaKo(first)} 걸리는 ${first.spokenPlaceWithAddrKo}을 찾았어요. 이곳으로 출발할까요?"
        } else {
            "$q 검색 결과를 찾지 못했어요. 다시 한번 말씀해 주실래요?"
        }

        val res = SearchCandidatesResult(
            originAddressKo = originAddressKo,
            originLat = oLat,
            originLng = oLng,
            candidatesRecommended = byRec,
            candidatesByDistance = byDist,
            spokenConfirmationPromptKo = promptKo
        )
        lastSearchResult = res
        return res
    }

    private fun tmapTurnTypeToKo(turnType: Int, desc: String): String {
        if (desc.contains("횡단보도")) return "횡단보도"
        return when (turnType) {
            201 -> "도착"
            12, 16, 212 -> "좌회전"
            13, 18, 213 -> "우회전"
            17 -> "왼쪽 대각선"
            19 -> "오른쪽 대각선"
            14 -> "유턴(뒤로 돌기)"
            else -> "직진"
        }
    }

    fun confirmAndBuildRoute(
        originAddressKo: String,
        originLat: Double,
        originLng: Double,
        candidate: PoiCandidate,
        preferTransit: Boolean = candidate.distanceMeters >= 500,
        preferSubwayOnly: Boolean = true
    ): Pair<ActivePedestrianRoute, String> {
        val steps = mutableListOf<NavTurnStep>()
        var totalDist = candidate.distanceMeters
        var routeSource = "TMAP_PEDESTRIAN"
        var transitSummaryKo = ""
        var subwayStationsList = emptyList<String>()
        var destDoorSideKo = "오른쪽"
        val exitMatch = Regex("(\\d+\\s*번\\s*출구)").find(candidate.name)?.groupValues?.get(1) ?: "출구"
        val tmapKey = BuildConfig.TMAP_API_KEY

        if (tmapKey.isNotBlank()) {
            // 1. TMAP Pedestrian Turn-by-Turn Route
            try {
                val conn = (URL("https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 5000
                    readTimeout = 5000
                    doOutput = true
                    setRequestProperty("appKey", tmapKey)
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("Accept", "application/json")
                }
                val body = JSONObject()
                    .put("startX", originLng)
                    .put("startY", originLat)
                    .put("endX", candidate.lng)
                    .put("endY", candidate.lat)
                    .put("reqCoordType", "WGS84GEO")
                    .put("resCoordType", "WGS84GEO")
                    .put("startName", "출발지")
                    .put("endName", "목적지")
                    .put("searchOption", "0")
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }

                if (conn.responseCode in 200..299) {
                    val features = JSONObject(conn.inputStream.bufferedReader().readText()).optJSONArray("features")
                    if (features != null && features.length() > 0) {
                        val firstProps = features.optJSONObject(0)?.optJSONObject("properties")
                        if (firstProps != null && firstProps.has("totalDistance")) {
                            totalDist = max(10, firstProps.optInt("totalDistance", totalDist))
                        }
                        var stepNum = 1
                        for (i in 0 until features.length()) {
                            val f = features.optJSONObject(i) ?: continue
                            val geom = f.optJSONObject("geometry") ?: continue
                            if (geom.optString("type") != "Point") continue
                            val props = f.optJSONObject("properties") ?: continue
                            var desc = props.optString("description", "보행로 이동").trim()
                            if (desc.contains("%")) {
                                try { desc = java.net.URLDecoder.decode(desc, "UTF-8") } catch (_: Exception) {}
                            }
                            val distMatch = Regex("(\\d+)\\s*m").find(desc)?.groupValues?.get(1)?.toIntOrNull() ?: 25
                            val stepsCnt = max(1, (distMatch / STEP_LENGTH_M).roundToInt())
                            val coords = geom.optJSONArray("coordinates")
                            val tLng = coords?.optDouble(0) ?: candidate.lng
                            val tLat = coords?.optDouble(1) ?: candidate.lat
                            val turnKo = tmapTurnTypeToKo(props.optInt("turnType", 11), desc)

                            steps.add(
                                NavTurnStep(
                                    stepIndex = stepNum++,
                                    roadName = props.optString("name", "보행로").ifBlank { "보행로" },
                                    distanceMeters = distMatch,
                                    stepsCount = stepsCnt,
                                    turnDirectionKo = turnKo,
                                    targetLat = tLat,
                                    targetLng = tLng,
                                    instructionKo = "$desc, 약 ${stepsCnt}걸음"
                                )
                            )
                        }
                    }
                }
            } catch (_: Exception) {}

            // 2. Subway Route Map Resolver (Fixes LUM-68 & LUM-70: Provides reliable Subway Line Map route even if TMAP transit quota is exceeded or returns bus)
            if (preferTransit && preferSubwayOnly) {
                val originStn = findNearestSubwayStation(originLat, originLng)
                val destStn = if (candidate.categoryLabelKo.contains("지하철") || candidate.name.contains("역")) {
                    candidate.name to 0
                } else {
                    findNearestSubwayStation(candidate.lat, candidate.lng)
                }
                if (originStn != null && destStn != null) {
                    val subPlan = computeSeoulSubwayRoutePlan(originStn.first, destStn.first)
                    if (subPlan != null) {
                        routeSource = "TMAP_SUBWAY_AND_WALK"
                        subwayStationsList = subPlan.allStations
                        destDoorSideKo = subPlan.destDoorSideKo
                        val legsList = mutableListOf(
                            "현재 위치에서 ${normalizeStationCore(originStn.first)}역까지 도보 ${originStn.second}미터 이동",
                            subPlan.summaryKo
                        )
                        if (destStn.second > 30) {
                            legsList.add("${normalizeStationCore(destStn.first)}역 하차 후 ${candidate.name}까지 도보 ${destStn.second}미터 이동")
                        } else if (exitMatch != "출구") {
                            legsList.add("${normalizeStationCore(destStn.first)}역 하차 후 $exitMatch 방향으로 이동")
                        }
                        transitSummaryKo = legsList.joinToString(" | ")
                    }
                }
            }

            // 3. If Bus/Transit requested (or Subway summary not matched), also query TMAP `/transit/routes`
            if (preferTransit && transitSummaryKo.isBlank()) {
                try {
                    val trConn = (URL("https://apis.openapi.sk.com/transit/routes").openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        connectTimeout = 5000
                        readTimeout = 5000
                        doOutput = true
                        setRequestProperty("appKey", tmapKey)
                        setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        setRequestProperty("Accept", "application/json")
                    }
                    val trBody = JSONObject()
                        .put("startX", originLng.toString())
                        .put("startY", originLat.toString())
                        .put("endX", candidate.lng.toString())
                        .put("endY", candidate.lat.toString())
                        .put("count", 5)
                        .put("lang", 0)
                        .put("format", "json")
                    OutputStreamWriter(trConn.outputStream, Charsets.UTF_8).use { it.write(trBody.toString()) }

                    if (trConn.responseCode in 200..299) {
                        val trRoot = JSONObject(trConn.inputStream.bufferedReader().readText())
                        val itins = trRoot.optJSONObject("metaData")?.optJSONObject("plan")?.optJSONArray("itineraries")
                        var chosenLegs: JSONArray? = null
                        if (itins != null && itins.length() > 0) {
                            if (preferSubwayOnly) {
                                for (k in 0 until itins.length()) {
                                    val candidateLegs = itins.optJSONObject(k)?.optJSONArray("legs") ?: continue
                                    var hasSubway = false
                                    for (m in 0 until candidateLegs.length()) {
                                        if (candidateLegs.optJSONObject(m)?.optString("mode") == "SUBWAY") {
                                            hasSubway = true
                                            break
                                        }
                                    }
                                    if (hasSubway) {
                                        chosenLegs = candidateLegs
                                        break
                                    }
                                }
                            }
                            if (chosenLegs == null) {
                                chosenLegs = itins.optJSONObject(0)?.optJSONArray("legs")
                            }
                        }
                        val legs = chosenLegs
                        if (legs != null && legs.length() > 0) {
                            routeSource = "TMAP_TRANSIT_AND_WALK"
                            val legSummaries = mutableListOf<String>()
                            for (i in 0 until legs.length()) {
                                val leg = legs.optJSONObject(i) ?: continue
                                val mode = leg.optString("mode", "WALK")
                                val sName = leg.optJSONObject("start")?.optString("name", "출발지") ?: "출발지"
                                val eName = leg.optJSONObject("end")?.optString("name", "도착지") ?: "도착지"
                                val d = leg.optInt("distance", 0)
                                val rName = leg.optString("route", "").replace(Regex("^[^:]+:"), "")
                                if (mode == "WALK") {
                                    if (d > 10) legSummaries.add("${sName}에서 ${eName}까지 도보 ${d}미터 이동")
                                } else {
                                    legSummaries.add("${sName}에서 $rName 탑승 후 ${eName} 하차")
                                }
                            }
                            transitSummaryKo = legSummaries.joinToString(" | ")
                        }
                    }
                } catch (_: Exception) {}
            }
        }

        if (steps.isEmpty()) {
            val stepsCnt = max(1, (totalDist / STEP_LENGTH_M).roundToInt())
            steps.add(
                NavTurnStep(
                    stepIndex = 1,
                    roadName = "보행로",
                    distanceMeters = totalDist,
                    stepsCount = stepsCnt,
                    turnDirectionKo = "직진",
                    targetLat = candidate.lat,
                    targetLng = candidate.lng,
                    instructionKo = "${candidate.name} 방향(${candidate.cardinalKo})으로 ${totalDist}m(약 ${stepsCnt}걸음) 이동"
                )
            )
        }

        val totalSteps = max(1, (totalDist / STEP_LENGTH_M).roundToInt())
        val estMin = max(1, (totalDist / 65.0).roundToInt())

        // Build Macro Plan Overview & Milestones BEFORE starting micro step-by-step guidance (Fixes LUM-53, LUM-68, LUM-71)
        val milestones = mutableListOf<String>()
        val macroPlanOverviewKo = if (transitSummaryKo.isNotBlank()) {
            val parts = transitSummaryKo.split(" | ")
            parts.forEachIndexed { idx, s -> milestones.add("${idx + 1}구간: $s") }
            val naturalSteps = parts.joinToString("하신 다음, ")
            val modeTitle = if (routeSource == "TMAP_SUBWAY_AND_WALK") "지하철 노선" else "대중교통"
            "전체 $modeTitle 이동 계획을 말씀드릴게요. 지금 계신 $originAddressKo 부근에서 ${candidate.name}까지는 총 ${parts.size}구간으로 이동해요. 순서대로 $naturalSteps 하시면 됩니다. 이 계획대로 안내를 시작할까요?"
        } else {
            val roadNames = steps.map { it.roadName }.filter { it.isNotBlank() && it != "보행로" }.distinct().take(3)
            val crosswalkCnt = steps.count { it.turnDirectionKo == "횡단보도" || it.instructionKo.contains("횡단보도") }
            val roadStr = if (roadNames.isNotEmpty()) "${roadNames.joinToString("와 ")}를 따라" else "${candidate.cardinalKo} 보행로를 따라"
            val cwStr = if (crosswalkCnt > 0) " 중간에 횡단보도를 ${crosswalkCnt}번 건너게 돼요." else ""

            milestones.add("1구간: 건물 밖으로 나와 ${roadNames.firstOrNull() ?: "첫 보행로"} 진입")
            milestones.add("2구간: $roadStr 약 ${totalDist}미터 도보 이동")
            milestones.add("3구간: ${candidate.name} 도착")

            "전체 이동 계획을 먼저 말씀드릴게요. 지금 계신 $originAddressKo 부근에서 ${candidate.name}까지는 $roadStr 걸어서 약 ${estMin}분, 총 ${totalDist}미터를 이동하는 도보 경로예요.$cwStr 이 계획대로 출발할까요?"
        }

        val route = ActivePedestrianRoute(
            routeSource = routeSource,
            originAddressKo = originAddressKo,
            originLat = originLat,
            originLng = originLng,
            destination = candidate,
            totalDistanceMeters = totalDist,
            totalStepsCount = totalSteps,
            estimatedMinutes = estMin,
            turnSteps = steps,
            transitSummaryKo = transitSummaryKo,
            subwayRouteStations = subwayStationsList,
            destinationDoorSideKo = destDoorSideKo,
            targetExitTextKo = exitMatch,
            macroPlanOverviewKo = macroPlanOverviewKo,
            macroMilestones = milestones,
            isConfirmedByUser = false,
            currentStepIndex = 0
        )
        activeRoute = route
        return route to macroPlanOverviewKo
    }

    fun activateConfirmedRoute(): String {
        val route = activeRoute ?: return "먼저 목적지를 검색해 주세요."
        route.isConfirmedByUser = true
        NativeLumoAiClient.startOrClearMission("${route.destination.shortAddressKo} (${route.macroPlanOverviewKo})")
        val firstInstr = route.turnSteps.first().instructionKo.replace(Regex("\\([^)]*\\)"), "").trim()
        return "좋아요, ${route.destination.name} 안내를 지금부터 시작할게요! 교통카드는 챙기셨죠? 우선 첫 번째 구간으로 $firstInstr 해 볼까요?"
    }

    fun computeLiveSubwayProgressForPrompt(): String {
        val route = activeRoute ?: return ""
        val stns = route.subwayRouteStations
        if (stns.size < 2) return ""
        val uLat = currentLat
        val uLng = currentLng

        var closestIdx = 0
        var bestDist = Int.MAX_VALUE
        for (i in stns.indices) {
            val info = SEOUL_STATION_COORDS[stns[i]] ?: continue
            val d = haversineMeters(uLat, uLng, info.lat, info.lng)
            if (d < bestDist) {
                bestDist = d
                closestIdx = i
            }
        }
        val curStn = stns[closestIdx]
        val destStn = stns.last()
        val remainingStops = max(0, stns.size - 1 - closestIdx)
        val doorSide = route.destinationDoorSideKo
        val exitStr = route.targetExitTextKo

        return when {
            remainingStops >= 2 ->
                "현재 GPS 기준 가장 가까운 역: ${curStn}역 (목적지 ${destStn}역까지 ${remainingStops}정거장 남음 — 아직 내릴 역이 아니므로 절대 내리라고 하지 마세요! ${destStn}역 내리실 문 방향: $doorSide)"
            remainingStops == 1 ->
                "현재 GPS 기준 ${curStn}역 부근 — 바로 다음 역이 하차할 목적지 ${destStn}역(1정거장 남음)! ${destStn}역에서는 $doorSide 문이 열리니 지금부터 문 앞에서 내릴 준비를 하라고 안내하세요."
            else ->
                "현재 목적지 ${destStn}역 도착 구간(0정거장 남음) — 열차 ${doorSide} 문이 실제로 완전히 열리고 앞사람이 내린 뒤 하차하여 $exitStr 방향 표지판과 점자블록을 따라 나가라고 안내하세요."
        }
    }

    /**
     * Layer 2 Deterministic Guard for Subway Riding (Fixes LUM-73 ~ LUM-108):
     * Prevents premature "get off now / transfer corridor / window blocked" hallucinations when GPS shows
     * the train is still >= 1 stop away from the destination station, and injects exact station + door side + exit info.
     */
    fun guardSubwayRideSpeech(draftSpeech: String): String {
        val route = activeRoute ?: return draftSpeech
        val stns = route.subwayRouteStations
        if (stns.size < 2) return draftSpeech

        var closestIdx = 0
        var bestDist = Int.MAX_VALUE
        for (i in stns.indices) {
            val info = SEOUL_STATION_COORDS[stns[i]] ?: continue
            val d = haversineMeters(currentLat, currentLng, info.lat, info.lng)
            if (d < bestDist) {
                bestDist = d
                closestIdx = i
            }
        }
        val curStn = stns[closestIdx]
        val destStn = stns.last()
        val remainingStops = max(0, stns.size - 1 - closestIdx)
        val doorSide = route.destinationDoorSideKo
        val exitStr = route.targetExitTextKo

        val mentionsPrematureExitOrCorridor =
            Regex("내릴\\s*준비|내려볼까요|내리느라|환승\\s*통로|승강장으로\\s*(?:무사히\\s*)?나왔|도착했네요|창문이라\\s*막혀|창문에서\\s*몸을").containsMatchIn(draftSpeech)

        if (remainingStops >= 2 && mentionsPrematureExitOrCorridor) {
            return "지금은 ${curStn}역 부근을 지나고 있어요. 내리실 ${destStn}역까지는 아직 ${remainingStops}정거장 남았으니 내리지 마시고, 출입문 옆 손잡이를 안전하게 잡고 계세요. ${destStn}역 내리실 문은 ${doorSide}입니다."
        }
        if (remainingStops == 1 && (draftSpeech.contains("${destStn}역에 도착") || mentionsPrematureExitOrCorridor)) {
            return "지금은 ${curStn}역이에요. 바로 다음 역이 내리실 ${destStn}역입니다! ${destStn}역에서는 ${doorSide} 문이 열리니 지금부터 출입문 앞에서 내릴 준비를 해주세요."
        }
        if (remainingStops == 0 && exitStr != "출구" && !draftSpeech.contains(exitStr) && Regex("점자블록|개찰구|계단|에스컬레이터|출구").containsMatchIn(draftSpeech)) {
            return "$draftSpeech ${destStn}역 $exitStr 방향 표지판과 점자블록을 따라 나가시면 됩니다."
        }
        return draftSpeech
    }

    fun buildLiveNavContextForPrompt(): String {
        val route = activeRoute ?: return ""
        val uLat = currentLat
        val uLng = currentLng

        while (route.currentStepIndex < route.turnSteps.size - 1) {
            val st = route.turnSteps[route.currentStepIndex]
            val d = haversineMeters(uLat, uLng, st.targetLat, st.targetLng)
            if (d <= 15) {
                route.currentStepIndex += 1
            } else {
                break
            }
        }

        val currentStep = route.turnSteps[route.currentStepIndex]
        val nextStep = route.turnSteps.getOrNull(route.currentStepIndex + 1)
        val distToDest = haversineMeters(uLat, uLng, route.destination.lat, route.destination.lng)
        val stepsToDest = max(1, (distToDest / STEP_LENGTH_M).roundToInt())
        val targetBrg = bearingDegrees(uLat, uLng, currentStep.targetLat, currentStep.targetLng)

        val compassCoaching = if (hasCompassFix) {
            coachHeadingAlignmentKo(currentCompassHeadingDeg, targetBrg)
        } else {
            "목표 방위각 ${bearingToCardinalKo(targetBrg)}(${targetBrg}도)"
        }

        val subwayProgress = computeLiveSubwayProgressForPrompt()
        val subwayNote = if (subwayProgress.isNotBlank()) " | 실시간 지하철 정거장 추적: $subwayProgress" else ""
        val transitNote = if (route.transitSummaryKo.isNotBlank()) " | 전체 대중교통 환승계획: ${route.transitSummaryKo}" else " | 전체 이동계획: ${route.macroMilestones.joinToString(" -> ")}"
        val nextStepText = if (nextStep != null) " | 다음 구간: ${nextStep.instructionKo}" else ""
        return "출발지: ${route.originAddressKo} -> 목적지: ${route.destination.shortAddressKo} (목표 출구: ${route.targetExitTextKo}, 내릴 문 방향: ${route.destinationDoorSideKo}, 남은 직선거리 ${distToDest}m)$transitNote$subwayNote | 현재 세부 구간(${route.currentStepIndex + 1}/${route.turnSteps.size}): ${currentStep.instructionKo}$nextStepText | 나침반 정렬: $compassCoaching"
    }
}
