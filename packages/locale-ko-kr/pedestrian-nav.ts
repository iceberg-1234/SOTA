import {
  getSecretFromKeychainOrEnv,
  KEYCHAIN_SERVICE_TMAP,
  maskSecretMetadata,
} from "../core/keychain.ts";
import { metersToSteps } from "../core/spatial-language.ts";
import { guideTransferCorridorKo } from "../core/transit-engine.ts";
import {
  computeSeoulSubwayRouteKo,
  findSubwayTransferRule,
} from "./subway-transfer-db.ts";

export type PoiSortMode = "RECOMMENDED" | "DISTANCE";
export type RouteTransportPreference = "SUBWAY_FIRST" | "BUS_OR_TRANSIT" | "WALK_ONLY";

export interface PlaceCandidate {
  id: string;
  name: string;
  categoryLabelKo: string;
  /** Short area + road prefix e.g. "광진구 아차산로" */
  areaRoadPrefixKo: string;
  /** Spoken label combining short address + place name e.g. "광진구 아차산로 부근 구의역 (2호선)" */
  spokenPlaceWithAddrKo: string;
  shortAddressKo: string;
  fullAddressKo: string;
  lat: number;
  lng: number;
  straightDistanceMeters: number;
  estimatedWalkSteps: number;
  estimatedWalkMinutes: number;
  /** Estimated door-to-door public transit minutes (walk to station/stop + subway/bus travel) */
  estimatedTransitMinutes: number;
  bearingDegrees: number;
  cardinalDirectionKo: string;
  distanceScore: number;
  intentScore: number;
  walkabilityScore: number;
  recommendationScore: number;
}

export interface PedestrianTurnStep {
  stepIndex: number;
  roadName: string;
  distanceMeters: number;
  stepsCount: number;
  maneuverType: string;
  turnDirectionKo:
    | "직진"
    | "우회전"
    | "좌회전"
    | "오른쪽 대각선"
    | "왼쪽 대각선"
    | "유턴(뒤로 돌기)"
    | "횡단보도"
    | "대중교통 탑승"
    | "도착";
  targetLat: number;
  targetLng: number;
  instructionKo: string;
}

export interface TransitLegSummary {
  mode: "WALK" | "BUS" | "SUBWAY" | string;
  routeName?: string;
  startName: string;
  endName: string;
  distanceMeters: number;
  sectionTimeSeconds: number;
  summaryKo: string;
}

export interface ConfirmedPedestrianRoute {
  routeSource:
    | "TMAP_SUBWAY_AND_WALK"
    | "TMAP_PEDESTRIAN"
    | "TMAP_TRANSIT_AND_WALK"
    | "OSM_FALLBACK";
  transportPreference: RouteTransportPreference;
  originAddressKo: string;
  originLat: number;
  originLng: number;
  destination: PlaceCandidate;
  totalDistanceMeters: number;
  totalStepsCount: number;
  estimatedMinutes: number;
  turnSteps: PedestrianTurnStep[];
  transitLegs?: TransitLegSummary[];
  subwayRouteSummaryKo?: string;
  /** High-level macro journey overview spoken BEFORE starting micro step-by-step camera guidance (Fixes LUM-53) */
  macroPlanOverviewKo: string;
  /** Structured milestone stages of the entire trip so user always knows the overall plan */
  macroMilestones: string[];
  currentStepIndex: number;
}

export interface OutdoorPedestrianCheckpoint {
  id: string;
  distanceFromStartMeters: number;
  landmarkName: string;
  turnClock: 9 | 10 | 12 | 2 | 3;
  tactileContinues: boolean;
  hasCrosswalk?: boolean;
}

export interface OutdoorRouteSession {
  destinationName: string;
  totalDistanceMeters: number;
  walkedMeters: number;
  currentCheckpointIndex: number;
  checkpoints: readonly OutdoorPedestrianCheckpoint[];
}

const EXCLUDED_SUB_POI_REGEX =
  /주차장|충전소|정문|후문|휴게소|ATM|세탁|안경|치과|의원|화장실|고객센터|하역장/;

export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function computeBearingDegrees(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (Math.round(toDeg(Math.atan2(y, x))) + 360) % 360;
}

export function bearingToCardinalKo(deg: number): string {
  const dirs = ["북쪽", "북동쪽", "동쪽", "남동쪽", "남쪽", "남서쪽", "서쪽", "북서쪽"];
  return dirs[Math.round(deg / 45) % 8];
}

export function coachHeadingAlignmentKo(
  userHeadingDeg: number,
  targetBearingDeg: number,
): { isAligned: boolean; deltaDegrees: number; coachingKo: string } {
  const diff = ((targetBearingDeg - userHeadingDeg + 540) % 360) - 180;
  const absDiff = Math.abs(diff);

  if (absDiff <= 30) {
    return {
      isAligned: true,
      deltaDegrees: diff,
      coachingKo: "현재 몸이 목적지 진행 방향과 바르게 정렬되어 있습니다.",
    };
  }
  if (absDiff >= 135) {
    return {
      isAligned: false,
      deltaDegrees: diff,
      coachingKo:
        "현재 경로와 반대 방향을 보고 계십니다. 제자리에서 뒤로(180도) 돌아서 주세요.",
    };
  }
  const dirKo = diff > 0 ? "오른쪽" : "왼쪽";
  const angleDesc = absDiff >= 70 ? "직각(90도) 가까이" : "대각선 방향으로 조금";
  return {
    isAligned: false,
    deltaDegrees: diff,
    coachingKo: `목적지 방향으로 맞추려면 제자리에서 ${dirKo}으로 ${angleDesc} 몸을 돌려주세요.`,
  };
}

export function expandKoreanPoiQuery(rawQuery: string): string[] {
  const q = VisualPedestrianNavigator.extractCleanPlaceQuery(rawQuery);
  if (!q) return [];
  if (q === "이마트") {
    return ["이마트", "이마트에브리데이"];
  }
  if (q === "홈플러스") {
    return ["홈플러스", "홈플러스익스프레스"];
  }
  if (q === "롯데마트") {
    return ["롯데마트", "롯데슈퍼"];
  }
  const tokens = VisualPedestrianNavigator.tokenizePlaceQuery(q);
  const queries = new Set<string>([q]);
  if (tokens.length >= 3) {
    // LUM-138: Drop the second-to-last token (often an STT neighborhood mishearing like "홈즈" for "홍제")
    const withoutPenultimate = [
      ...tokens.slice(0, -2),
      tokens[tokens.length - 1],
    ].join(" ");
    queries.add(withoutPenultimate);
  }
  return Array.from(queries);
}

export function classifyKoreanStoreCategory(
  name: string,
  bizName: string,
  rawQuery: string,
): { categoryLabelKo: string; intentScore: number } {
  const n = name.replace(/\s+/g, "").replace(/\[[^\]]*\]/g, "");
  const q = rawQuery.replace(/\s+/g, "");

  if (bizName === "지하철역" || name.includes("호선)") || name.includes("호선]")) {
    return {
      categoryLabelKo: "지하철역",
      intentScore: 165,
    };
  }
  if (bizName.includes("지하철") || n === q) {
    return {
      categoryLabelKo: bizName.includes("지하철") ? "지하철출구" : bizName || "주요장소",
      intentScore: n === q ? 150 : 115,
    };
  }

  if (
    n.includes("에브리데이") ||
    n.includes("익스프레스") ||
    n.includes("롯데슈퍼") ||
    n.includes("더프레시") ||
    bizName.includes("슈퍼")
  ) {
    return {
      categoryLabelKo: "대형슈퍼·에브리데이",
      intentScore: q.includes("에브리데이") ? 100 : 96,
    };
  }
  if (n.includes("이마트24") || bizName.includes("편의점")) {
    return {
      categoryLabelKo: "편의점(이마트24)",
      intentScore: q.includes("24") || q.includes("편의점") ? 100 : 80,
    };
  }
  if (n.includes("노브랜드")) {
    return {
      categoryLabelKo: "노브랜드",
      intentScore: q.includes("노브랜드") ? 100 : 88,
    };
  }
  if (
    n.includes("이마트") ||
    n.includes("홈플러스") ||
    n.includes("롯데마트") ||
    bizName.includes("대형마트")
  ) {
    return {
      categoryLabelKo: "대형마트",
      intentScore: 100,
    };
  }
  return {
    categoryLabelKo: bizName || "일반장소",
    intentScore: n.includes(q) ? 95 : 82,
  };
}

/**
 * Conservative Door-to-Door Public Transit ETA for Visually Impaired Travelers (Fixes LUM-136):
 * Accounts for cane walking speed (0.85m/s) to/from stations, elevator/stair/screen-door navigation (+15 min base),
 * road/rail tortuosity (~3.6 min per straight-line km), and cross-river/transfer corridor buffer (+7 min when >= 4.5km).
 */
export function estimatePublicTransitMinutes(distanceMeters: number): number {
  if (distanceMeters <= 400) {
    return Math.max(4, Math.round(distanceMeters / 52));
  }
  const km = distanceMeters / 1000;
  const transferBuffer = distanceMeters >= 4500 ? 7 : 0;
  return Math.max(12, Math.round(15 + km * 3.6 + transferBuffer));
}

export function scoreAndRankPoiCandidates(
  rawQuery: string,
  rawList: Array<{
    id: string;
    name: string;
    bizName?: string;
    categoryLabelKo?: string;
    areaRoadPrefixKo?: string;
    shortAddressKo: string;
    fullAddressKo: string;
    lat: number;
    lng: number;
    straightDistanceMeters: number;
    bearingDegrees: number;
    cardinalDirectionKo: string;
  }>,
  sortMode: PoiSortMode = "RECOMMENDED",
): PlaceCandidate[] {
  const deduped: typeof rawList = [];
  for (const item of rawList) {
    const isDup = deduped.some(
      (existing) =>
        haversineDistanceMeters(
          existing.lat,
          existing.lng,
          item.lat,
          item.lng,
        ) < 35 &&
        existing.name.replace(/\s+/g, "") === item.name.replace(/\s+/g, ""),
    );
    if (!isDup) {
      deduped.push(item);
    }
  }

  const scored: PlaceCandidate[] = deduped.map((c) => {
    const d = Math.max(5, c.straightDistanceMeters);
    const distanceScore = Math.round(100 / (1 + Math.pow(d / 450, 1.35)));
    const { categoryLabelKo, intentScore } = classifyKoreanStoreCategory(
      c.name,
      c.bizName ?? c.categoryLabelKo ?? "",
      rawQuery,
    );
    const walkabilityScore = d <= 900 ? 100 : d <= 1600 ? 75 : 35;
    const recommendationScore = Math.round(
      0.5 * distanceScore + 0.35 * intentScore + 0.15 * walkabilityScore,
    );
    const areaRoadPrefixKo = (c.areaRoadPrefixKo ?? "").trim();
    const spokenPlaceWithAddrKo = areaRoadPrefixKo
      ? `${areaRoadPrefixKo} 근처 ${c.name}`
      : c.name;

    return {
      id: c.id,
      name: c.name,
      categoryLabelKo: c.categoryLabelKo || categoryLabelKo,
      areaRoadPrefixKo,
      spokenPlaceWithAddrKo,
      shortAddressKo: c.shortAddressKo,
      fullAddressKo: c.fullAddressKo,
      lat: c.lat,
      lng: c.lng,
      straightDistanceMeters: d,
      estimatedWalkSteps: metersToSteps(d),
      estimatedWalkMinutes: Math.max(1, Math.round(d / 65)),
      estimatedTransitMinutes: estimatePublicTransitMinutes(d),
      bearingDegrees: c.bearingDegrees,
      cardinalDirectionKo: c.cardinalDirectionKo,
      distanceScore,
      intentScore,
      walkabilityScore,
      recommendationScore,
    };
  });

  if (sortMode === "DISTANCE") {
    scored.sort((a, b) => a.straightDistanceMeters - b.straightDistanceMeters);
  } else {
    scored.sort(
      (a, b) =>
        b.recommendationScore - a.recommendationScore ||
        a.straightDistanceMeters - b.straightDistanceMeters,
    );
  }

  return scored;
}

function tmapTurnTypeToKo(
  turnType?: number,
  desc?: string,
): PedestrianTurnStep["turnDirectionKo"] {
  if (desc?.includes("횡단보도")) return "횡단보도";
  switch (turnType) {
    case 201:
      return "도착";
    case 12:
    case 16:
    case 212:
      return "좌회전";
    case 13:
    case 18:
    case 213:
      return "우회전";
    case 17:
      return "왼쪽 대각선";
    case 19:
      return "오른쪽 대각선";
    case 14:
      return "유턴(뒤로 돌기)";
    default:
      return "직진";
  }
}

export class VisualPedestrianNavigator {
  private readonly tmapApiKey: string | null;

  constructor(tmapApiKey?: string) {
    this.tmapApiKey =
      tmapApiKey ??
      getSecretFromKeychainOrEnv(KEYCHAIN_SERVICE_TMAP, "TMAP_API_KEY");
  }

  getTmapStatus() {
    return maskSecretMetadata(this.tmapApiKey);
  }

  /**
   * Stage 1: Uses live TMAP Reverse Geocoding (`/tmap/geo/reversegeocoding`) to get the exact Korean road/building address.
   */
  async reverseGeocodeOriginKo(lat: number, lng: number): Promise<string> {
    if (this.tmapApiKey) {
      try {
        const url = `https://apis.openapi.sk.com/tmap/geo/reversegeocoding?version=1&lat=${lat}&lon=${lng}&coordType=WGS84GEO&addressType=A10`;
        const res = await fetch(url, {
          headers: { appKey: this.tmapApiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const info = data?.addressInfo;
          const roadAddr = [
            info?.city_do,
            info?.gu_gun,
            info?.roadName,
            info?.buildingIndex,
            info?.buildingName,
          ]
            .filter(Boolean)
            .join(" ")
            .trim();
          if (roadAddr) {
            return roadAddr.replace("서울특별시 ", "서울 ");
          }
          if (info?.fullAddress) {
            const parts = String(info.fullAddress).split(",");
            return (parts[parts.length - 1] || parts[0])
              .trim()
              .replace("서울특별시 ", "서울 ");
          }
        }
      } catch {}
    }

    return `현재 위치 (위도 ${lat.toFixed(4)}, 경도 ${lng.toFixed(4)})`;
  }

  private static readonly CONVERSATIONAL_STOPWORDS = new Set([
    "아니", "아니야", "아뇨", "그냥", "일단", "그러면", "그럼", "대신", "취소",
    "목적지", "목적지를", "바꿔", "바꿔줘", "바꿀래", "바꿀게요", "변경", "변경해줘",
    "그게", "아니라", "말고", "거기", "여기", "저기", "아까", "말한", "데", "곳",
    "조금", "더", "가까운", "먼", "다른", "근처", "주변", "인근", "쪽으로", "쪽",
    "지하철", "지하철로", "전철", "전철로", "버스", "버스로", "대중교통", "대중교통으로",
    "도보", "도보로", "걸어서", "노선", "노선도", "경로", "코스", "코스로", "타고", "타는",
    "탄다고", "탈래", "안", "타고싶어", "가고싶어", "가자", "갈래", "가는", "길", "길찾기",
    "검색", "검색해", "검색해줘", "찾아", "찾아줘", "찾아봐", "안내", "안내해", "안내해줘", "알려줘", "다시", "짜줘",
    "읽어", "읽어줘", "봐줘", "보여줘", "유통기한", "소비기한", "기억", "기억해", "기억해줘", "위치", "설명", "설명해줘",
    "소타", "소타야", "지금", "여기서", "나", "내", "제일", "가장",
  ]);

  /**
   * Tokenizes a Korean utterance into pure place-name search tokens by stripping conversational
   * stop-words and trailing particles (`~으로/로`, `~에서`, `~까지`).
   * Returns an empty array if the utterance contains no actual place noun (e.g. "아니 지하철로 대중교통 검색", "거기 말고 조금 더 가까운 곳").
   */
  static tokenizePlaceQuery(rawInput: string): string[] {
    const cleaned = rawInput
      .replace(/[?!.,~"'()\[\]]/g, " ")
      .trim();
    if (!cleaned) return [];

    const rawTokens = cleaned.split(/\s+/);
    const placeTokens: string[] = [];

    for (const rawTok of rawTokens) {
      if (this.CONVERSATIONAL_STOPWORDS.has(rawTok)) continue;
      // Strip trailing directional/case particles only when stem is >= 2 chars
      const stripped = rawTok.replace(
        /^(.{1,}?)(?:으로|로|에서|까지|이랑|랑|이나|나|은|는|이|가|을|를)$/,
        "$1",
      );
      if (this.CONVERSATIONAL_STOPWORDS.has(stripped)) continue;
      if (stripped.length >= 2) {
        placeTokens.push(stripped);
      }
    }
    return placeTokens;
  }

  static extractCleanPlaceQuery(rawInput: string): string {
    return this.tokenizePlaceQuery(rawInput).join(" ");
  }

  static doesPoiMatchTokens(
    poiName: string,
    poiAddr: string,
    tokens: readonly string[],
  ): boolean {
    if (tokens.length === 0) return false;
    const haystack = `${poiName} ${poiAddr}`.replace(/\s+/g, "");
    // Check that the primary place/brand token (typically the last or first token) matches the POI name/address
    return tokens.some((tok) => {
      const core = tok.replace(/역$/, "");
      return core.length >= 2 && haystack.includes(core);
    }) && tokens.every((tok) => {
      const core = tok.replace(/역$/, "").replace(/점$/, "");
      // Either in name/address, or a station/area modifier like "건대입구" where the store is in that district
      return core.length < 2 || haystack.includes(core) || tokens.length > 1;
    });
  }

  /**
   * Finds the nearest subway station to a given coordinate using TMAP POI search (`20,000 calls/day` free).
   */
  async findNearestSubwayStation(
    lat: number,
    lng: number,
  ): Promise<{ name: string; distanceMeters: number; lat: number; lng: number } | null> {
    if (!this.tmapApiKey) return null;
    try {
      const url = `https://apis.openapi.sk.com/tmap/pois?version=1&searchKeyword=${encodeURIComponent("지하철역")}&searchtypCd=R&centerLon=${lng}&centerLat=${lat}&radius=3&reqCoordType=WGS84GEO&resCoordType=WGS84GEO&count=6`;
      const res = await fetch(url, {
        headers: { appKey: this.tmapApiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as any;
      const pois: any[] = data?.searchPoiInfo?.pois?.poi ?? [];
      for (const p of pois) {
        const rawName = String(p.name ?? "").trim();
        if (
          p.lowerBizName === "지하철역" ||
          rawName.includes("호선]") ||
          (rawName.endsWith("역") && !rawName.includes("출구"))
        ) {
          const sLat = Number(p.noorLat ?? p.frontLat);
          const sLng = Number(p.noorLon ?? p.frontLon);
          const dist = haversineDistanceMeters(lat, lng, sLat, sLng);
          const cleanName = rawName.replace(
            /\[(?:수도권)?([^\]]+)\]/g,
            " ($1)",
          );
          return { name: cleanName, distanceMeters: dist, lat: sLat, lng: sLng };
        }
      }
    } catch {}
    return null;
  }

  /**
   * `searchtypCd="R"` (Radius/Distance) and `searchtypCd="A"` (Accuracy/Recommendation) + Brand Expansion
   * (`이마트` -> `이마트` + `이마트에브리데이`), filtering out parking/sub-entrances.
   */
  async searchDestinationCandidates(params: {
    query: string;
    originLat: number;
    originLng: number;
    sortMode?: PoiSortMode;
  }): Promise<{
    originAddressKo: string;
    sortMode: PoiSortMode;
    candidates: PlaceCandidate[];
    candidatesByDistance: PlaceCandidate[];
    candidatesByRecommended: PlaceCandidate[];
    confirmationPromptKo: string;
  }> {
    const sortMode: PoiSortMode = params.sortMode ?? "RECOMMENDED";
    const originAddressKo = await this.reverseGeocodeOriginKo(
      params.originLat,
      params.originLng,
    );
    const q = VisualPedestrianNavigator.extractCleanPlaceQuery(params.query);
    if (!q) {
      return {
        originAddressKo,
        sortMode,
        candidates: [],
        candidatesByDistance: [],
        candidatesByRecommended: [],
        confirmationPromptKo:
          "가고 싶은 역이나 장소 이름을 말씀해 주세요. 예를 들어 구의역 가자, 또는 이마트 찾아줘처럼 말씀하시면 돼요.",
      };
    }
    const expandedKeywords = expandKoreanPoiQuery(q);

    const rawPool: Array<{
      id: string;
      name: string;
      bizName?: string;
      areaRoadPrefixKo?: string;
      shortAddressKo: string;
      fullAddressKo: string;
      lat: number;
      lng: number;
      straightDistanceMeters: number;
      bearingDegrees: number;
      cardinalDirectionKo: string;
    }> = [];

    if (this.tmapApiKey) {
      const tasks: Array<Promise<void>> = [];
      for (const kw of expandedKeywords) {
        for (const searchType of ["R", "A"] as const) {
          tasks.push(
            (async () => {
              try {
                const url = `https://apis.openapi.sk.com/tmap/pois?version=1&searchKeyword=${encodeURIComponent(kw)}&searchtypCd=${searchType}&centerLon=${params.originLng}&centerLat=${params.originLat}&radius=0&reqCoordType=WGS84GEO&resCoordType=WGS84GEO&count=10`;
                const res = await fetch(url, {
                  headers: {
                    appKey: this.tmapApiKey!,
                    Accept: "application/json",
                  },
                  signal: AbortSignal.timeout(4000),
                });
                if (!res.ok) return;
                const data = (await res.json()) as any;
                const pois: any[] = data?.searchPoiInfo?.pois?.poi ?? [];
                const queryTokens = VisualPedestrianNavigator.tokenizePlaceQuery(q);
                for (const p of pois) {
                  const rawName = String(p.name ?? "").trim();
                  if (!rawName || EXCLUDED_SUB_POI_REGEX.test(rawName)) continue;
                  const addr = [
                    p.middleAddrName,
                    p.roadName,
                    p.firstBuildNo,
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                  // Filter out unrelated shops returned by radius search that don't match the place tokens
                  if (
                    !VisualPedestrianNavigator.doesPoiMatchTokens(
                      rawName,
                      addr,
                      queryTokens,
                    )
                  ) {
                    continue;
                  }
                  const name = rawName.replace(
                    /\[(?:수도권)?([^\]]+)\]/g,
                    " ($1)",
                  );
                  const lat = Number(p.noorLat ?? p.frontLat);
                  const lng = Number(p.noorLon ?? p.frontLon);
                  if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

                  const dist = haversineDistanceMeters(
                    params.originLat,
                    params.originLng,
                    lat,
                    lng,
                  );
                  const brg = computeBearingDegrees(
                    params.originLat,
                    params.originLng,
                    lat,
                    lng,
                  );

                  const areaRoadPrefixKo = [
                    p.middleAddrName,
                    p.roadName || p.detailAddrName,
                  ]
                    .filter(Boolean)
                    .join(" ")
                    .trim();

                  rawPool.push({
                    id: `tmap_${p.id ?? rawPool.length + 1}`,
                    name,
                    bizName: String(p.lowerBizName ?? ""),
                    areaRoadPrefixKo,
                    shortAddressKo: areaRoadPrefixKo
                      ? `${areaRoadPrefixKo} 근처 ${name}`
                      : name,
                    fullAddressKo: addr ? `${addr} ${name}` : name,
                    lat,
                    lng,
                    straightDistanceMeters: dist,
                    bearingDegrees: brg,
                    cardinalDirectionKo: bearingToCardinalKo(brg),
                  });
                }
              } catch {}
            })(),
          );
        }
      }
      await Promise.all(tasks);
    }

    // LUM-69 Fix: NEVER invent a fake hallucinated POI when TMAP returns 0 results for a conversational phrase!
    if (rawPool.length === 0) {
      return {
        originAddressKo,
        sortMode,
        candidates: [],
        candidatesByDistance: [],
        candidatesByRecommended: [],
        confirmationPromptKo: `'${q}'에 해당하는 정확한 장소를 찾지 못했어요. 가고 싶은 역 이름이나 매장 이름을 다시 말씀해 주실래요?`,
      };
    }

    const candidatesByRecommended = scoreAndRankPoiCandidates(
      q,
      rawPool,
      "RECOMMENDED",
    ).slice(0, 6);
    const candidatesByDistance = scoreAndRankPoiCandidates(
      q,
      rawPool,
      "DISTANCE",
    ).slice(0, 6);

    const activeList =
      sortMode === "DISTANCE" ? candidatesByDistance : candidatesByRecommended;
    const formatTimeForCandidate = (c: PlaceCandidate) =>
      c.straightDistanceMeters >= 350
        ? `대중교통 약 ${c.estimatedTransitMinutes}분`
        : `도보 약 ${c.estimatedWalkMinutes}분`;

    const topFirst = activeList[0];
    const topSecond = activeList[1];
    const confirmationPromptKo = topSecond
      ? `지금 계신 곳은 ${originAddressKo} 부근이에요. 첫 번째 추천은 ${formatTimeForCandidate(topFirst)} 걸리는 ${topFirst.spokenPlaceWithAddrKo}이고, 두 번째는 ${formatTimeForCandidate(topSecond)} 거리의 ${topSecond.spokenPlaceWithAddrKo}예요. 어디로 안내해 드릴까요?`
      : `지금 계신 ${originAddressKo} 부근에서 ${formatTimeForCandidate(topFirst)} 걸리는 ${topFirst.spokenPlaceWithAddrKo}을 찾았어요. 이곳으로 안내해 드릴까요?`;

    return {
      originAddressKo,
      sortMode,
      candidates: activeList,
      candidatesByDistance,
      candidatesByRecommended,
      confirmationPromptKo,
    };
  }

  /**
   * Builds a confirmed route using:
   * 1. TMAP Pedestrian Route API (`/tmap/routes/pedestrian?version=1`, `searchOption="0"`) for turn-by-turn walking
   * 2. TMAP Public Transit API (`/transit/routes`) when distance > 1.2km to provide bus/subway/transfer legs alongside walking!
   */
  async buildConfirmedPedestrianRoute(params: {
    originAddressKo: string;
    originLat: number;
    originLng: number;
    destination: PlaceCandidate;
    transportPreference?: RouteTransportPreference;
  }): Promise<{
    route: ConfirmedPedestrianRoute;
    openingGuidanceKo: string;
  }> {
    const pref: RouteTransportPreference =
      params.transportPreference ??
      (params.destination.straightDistanceMeters >= 900
        ? "SUBWAY_FIRST"
        : "WALK_ONLY");
    const turnSteps: PedestrianTurnStep[] = [];
    const transitLegs: TransitLegSummary[] = [];
    let subwayRouteSummaryKo: string | undefined;
    let totalDistanceMeters = params.destination.straightDistanceMeters;
    let routeSource: ConfirmedPedestrianRoute["routeSource"] = "OSM_FALLBACK";

    if (this.tmapApiKey) {
      // 1. Fetch TMAP Pedestrian Turn-by-Turn Route
      try {
        const pedRes = await fetch(
          "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1",
          {
            method: "POST",
            headers: {
              appKey: this.tmapApiKey,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              startX: params.originLng,
              startY: params.originLat,
              endX: params.destination.lng,
              endY: params.destination.lat,
              reqCoordType: "WGS84GEO",
              resCoordType: "WGS84GEO",
              startName: "출발지",
              endName: "목적지",
              searchOption: "0",
            }),
            signal: AbortSignal.timeout(5000),
          },
        );

        if (pedRes.ok) {
          const pedJson = (await pedRes.json()) as any;
          const features: any[] = pedJson?.features ?? [];
          if (features.length > 0) {
            routeSource = "TMAP_PEDESTRIAN";
            totalDistanceMeters =
              Number(features[0]?.properties?.totalDistance) ||
              totalDistanceMeters;
            const pointFeatures = features.filter(
              (f) => f?.geometry?.type === "Point",
            );

            for (let i = 0; i < pointFeatures.length; i++) {
              const pt = pointFeatures[i];
              const props = pt.properties ?? {};
              const coords = pt.geometry?.coordinates ?? [
                params.destination.lng,
                params.destination.lat,
              ];
              const desc = String(
                props.description || props.name || "보행로를 따라 이동",
              ).trim();
              const distMatch = desc.match(/(\d+)\s*m/);
              const dist = distMatch ? Number(distMatch[1]) : 25;
              const turnKo = tmapTurnTypeToKo(
                Number(props.turnType),
                desc,
              );

              turnSteps.push({
                stepIndex: i + 1,
                roadName: String(props.name || "보행로"),
                distanceMeters: dist,
                stepsCount: metersToSteps(dist),
                maneuverType: String(props.pointType || "TURN"),
                turnDirectionKo: turnKo,
                targetLat: Number(coords[1]),
                targetLng: Number(coords[0]),
                instructionKo: `${desc} (약 ${metersToSteps(dist)}걸음)`,
              });
            }
          }
        }
      } catch {}

      // 2. Build Subway Route Map Plan (`SUBWAY_FIRST` or when destination > 900m — Fixes LUM-68 & LUM-70)
      if (pref === "SUBWAY_FIRST" || params.destination.straightDistanceMeters > 900) {
        const originStn = await this.findNearestSubwayStation(
          params.originLat,
          params.originLng,
        );
        const destStn =
          params.destination.categoryLabelKo.includes("지하철") ||
          params.destination.name.includes("역")
            ? {
                name: params.destination.name,
                distanceMeters: 0,
                lat: params.destination.lat,
                lng: params.destination.lng,
              }
            : await this.findNearestSubwayStation(
                params.destination.lat,
                params.destination.lng,
              );

        if (originStn && destStn) {
          const subPlan = computeSeoulSubwayRouteKo(
            originStn.name,
            destStn.name,
          );
          if (subPlan) {
            routeSource = "TMAP_SUBWAY_AND_WALK";
            subwayRouteSummaryKo = subPlan.summaryKo;
            transitLegs.push(
              {
                mode: "WALK",
                startName: "현재 위치",
                endName: subPlan.startStationKo,
                distanceMeters: originStn.distanceMeters,
                sectionTimeSeconds: Math.round(originStn.distanceMeters / 1.1),
                summaryKo: `현재 위치에서 ${subPlan.startStationKo}까지 도보 ${originStn.distanceMeters}미터 이동`,
              },
              {
                mode: "SUBWAY",
                routeName: subPlan.primaryLineKo,
                startName: subPlan.startStationKo,
                endName: subPlan.endStationKo,
                distanceMeters: subPlan.totalStops * 1100,
                sectionTimeSeconds: subPlan.estimatedSubwayMinutes * 60,
                summaryKo: subPlan.summaryKo,
              },
            );
            if (destStn.distanceMeters > 30) {
              transitLegs.push({
                mode: "WALK",
                startName: subPlan.endStationKo,
                endName: params.destination.name,
                distanceMeters: destStn.distanceMeters,
                sectionTimeSeconds: Math.round(destStn.distanceMeters / 1.1),
                summaryKo: `${subPlan.endStationKo} 하차 후 ${params.destination.name}까지 도보 ${destStn.distanceMeters}미터 이동`,
              });
            }
          }
        }
      }

      // 3. If BUS_OR_TRANSIT requested (or no subway match), also try TMAP `/transit/routes`
      if (
        (pref === "BUS_OR_TRANSIT" || transitLegs.length === 0) &&
        params.destination.straightDistanceMeters > 700
      ) {
        try {
          const trRes = await fetch(
            "https://apis.openapi.sk.com/transit/routes",
            {
              method: "POST",
              headers: {
                appKey: this.tmapApiKey,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                startX: String(params.originLng),
                startY: String(params.originLat),
                endX: String(params.destination.lng),
                endY: String(params.destination.lat),
                count: 5,
                lang: 0,
                format: "json",
              }),
              signal: AbortSignal.timeout(5000),
            },
          );
          if (trRes.ok) {
            const trJson = (await trRes.json()) as any;
            const itins: any[] = trJson?.metaData?.plan?.itineraries ?? [];
            const chosenItin =
              pref === "SUBWAY_FIRST"
                ? itins.find((it) =>
                    it.legs?.some((l: any) => l.mode === "SUBWAY"),
                  ) ?? itins[0]
                : itins[0];
            const legs: any[] = chosenItin?.legs ?? [];
            if (legs.length > 0) {
              transitLegs.length = 0;
              routeSource = "TMAP_TRANSIT_AND_WALK";
              for (const leg of legs) {
                const mode = String(leg.mode ?? "WALK");
                const startName = String(leg.start?.name ?? "출발지");
                const endName = String(leg.end?.name ?? "도착지");
                const dist = Number(leg.distance ?? 0);
                const sec = Number(leg.sectionTime ?? 0);
                const routeName = leg.route ? String(leg.route) : undefined;
                const summaryKo =
                  mode === "WALK"
                    ? `${startName}에서 ${endName}까지 도보 ${dist}미터 이동`
                    : `${startName}에서 ${routeName?.replace(/^[^:]+:/, "")} 탑승 후 ${endName} 하차`;
                transitLegs.push({
                  mode,
                  routeName,
                  startName,
                  endName,
                  distanceMeters: dist,
                  sectionTimeSeconds: sec,
                  summaryKo,
                });
              }
            }
          }
        } catch {}
      }
    }

    if (turnSteps.length === 0) {
      const stepsCount = metersToSteps(totalDistanceMeters);
      turnSteps.push({
        stepIndex: 1,
        roadName: "보행로",
        distanceMeters: totalDistanceMeters,
        stepsCount,
        maneuverType: "depart",
        turnDirectionKo: "직진",
        targetLat: params.destination.lat,
        targetLng: params.destination.lng,
        instructionKo: `${params.destination.name} 방향(${params.destination.cardinalDirectionKo})으로 약 ${totalDistanceMeters}m(${stepsCount}걸음) 이동합니다.`,
      });
    }

    const totalStepsCount = metersToSteps(totalDistanceMeters);
    const estimatedMinutes = Math.max(1, Math.round(totalDistanceMeters / 65));

    // Build Macro Plan Overview & Milestones (Fixes LUM-53: Tell the user the overall route plan BEFORE micro actions!)
    const macroMilestones: string[] = [];
    let macroPlanOverviewKo = "";

    if (transitLegs.length > 0) {
      transitLegs.forEach((leg, idx) => {
        macroMilestones.push(`${idx + 1}구간: ${leg.summaryKo}`);
      });
      const transitStepsSpeech = transitLegs
        .map((leg) => {
          if (leg.mode === "WALK") {
            return `${leg.startName}에서 ${leg.endName}까지 걸어서 이동`;
          }
          const cleanRoute = (leg.routeName ?? "대중교통").replace(
            /^[^:]+:/,
            "",
          );
          return `${leg.startName}에서 ${cleanRoute} 탑승 후 ${leg.endName} 하차`;
        })
        .join("하신 다음, ");

      macroPlanOverviewKo = `전체 이동 계획을 먼저 말씀드릴게요. 지금 계신 ${params.originAddressKo}에서 ${params.destination.name}까지는 대중교통과 도보를 합쳐서 총 ${transitLegs.length}구간으로 이동해요. 순서대로 ${transitStepsSpeech}하시면 됩니다. 이 계획으로 안내를 시작할까요?`;
    } else {
      const roadNames = Array.from(
        new Set(
          turnSteps
            .map((s) => s.roadName)
            .filter((r) => r && r !== "보행로" && r.length > 1),
        ),
      ).slice(0, 3);
      const crosswalkCount = turnSteps.filter(
        (s) =>
          s.turnDirectionKo === "횡단보도" ||
          s.instructionKo.includes("횡단보도"),
      ).length;
      const roadSummary =
        roadNames.length > 0
          ? `${roadNames.join("와 ")}를 따라`
          : `${params.destination.cardinalDirectionKo} 방향 보행로를 따라`;
      const crosswalkNote =
        crosswalkCount > 0
          ? ` 중간에 횡단보도를 ${crosswalkCount}번 건너게 됩니다.`
          : "";

      macroMilestones.push(
        `1구간: 현재 건물에서 밖으로 나와 ${roadNames[0] ?? "첫 보행로"} 진입`,
        `2구간: ${roadSummary} 약 ${totalDistanceMeters}미터 도보 이동 (${ turnSteps.length }개 안내 지점)`,
        `3구간: ${params.destination.name} 도착`,
      );

      macroPlanOverviewKo = `전체 이동 계획을 먼저 말씀드릴게요. 지금 계신 ${params.originAddressKo}에서 ${params.destination.name}까지는 ${roadSummary} 총 ${totalDistanceMeters}미터, 걸어서 약 ${estimatedMinutes}분 걸리는 도보 경로예요.${crosswalkNote} 이 계획대로 출발할까요?`;
    }

    const firstStep = turnSteps[0];
    const cleanFirstInstr = firstStep.instructionKo
      .replace(/\([^)]*\)/g, "")
      .trim();

    const route: ConfirmedPedestrianRoute = {
      routeSource,
      transportPreference: pref,
      originAddressKo: params.originAddressKo,
      originLat: params.originLat,
      originLng: params.originLng,
      destination: params.destination,
      totalDistanceMeters,
      totalStepsCount,
      estimatedMinutes,
      turnSteps,
      transitLegs: transitLegs.length > 0 ? transitLegs : undefined,
      subwayRouteSummaryKo,
      macroPlanOverviewKo,
      macroMilestones,
      currentStepIndex: 0,
    };

    const openingGuidanceKo = `${macroPlanOverviewKo} 출발 준비가 되셨으면 첫 번째 구간인 ${cleanFirstInstr}부터 시작해 볼게요.`;

    return { route, openingGuidanceKo };
  }

  createSampleRouteToStation(
    destinationName = "신논현역 버스정류장",
  ): OutdoorRouteSession {
    return {
      destinationName,
      totalDistanceMeters: 160,
      walkedMeters: 0,
      currentCheckpointIndex: 0,
      checkpoints: [
        {
          id: "CP-1",
          distanceFromStartMeters: 35,
          landmarkName: "CU 편의점 유리문",
          turnClock: 3,
          tactileContinues: true,
        },
        {
          id: "CP-2",
          distanceFromStartMeters: 95,
          landmarkName: "온누리약국 모서리 사거리 횡단보도",
          turnClock: 12,
          tactileContinues: true,
          hasCrosswalk: true,
        },
        {
          id: "CP-3",
          distanceFromStartMeters: 155,
          landmarkName: "신논현역 버스정류장 표지판 폴대",
          turnClock: 2,
          tactileContinues: true,
        },
      ],
    };
  }

  advanceOutdoorWalk(
    session: OutdoorRouteSession,
    stepsWalked: number,
  ): {
    updatedSession: OutdoorRouteSession;
    spokenGuidance: string;
    reachedDestination: boolean;
  } {
    const walkedMeters = Math.min(
      session.totalDistanceMeters,
      session.walkedMeters + stepsWalked * 0.7,
    );

    const nextCp = session.checkpoints[session.currentCheckpointIndex];
    if (!nextCp || walkedMeters >= session.totalDistanceMeters) {
      return {
        updatedSession: {
          ...session,
          walkedMeters: session.totalDistanceMeters,
          currentCheckpointIndex: session.checkpoints.length,
        },
        spokenGuidance: `목적지인 ${session.destinationName}에 도착했습니다. 전방 시야로 정류장 표지판을 확인합니다.`,
        reachedDestination: true,
      };
    }

    const remainingToCp = Math.max(
      0,
      nextCp.distanceFromStartMeters - walkedMeters,
    );
    const remainingSteps = metersToSteps(remainingToCp);

    if (remainingToCp <= 3.5) {
      const turnText =
        nextCp.turnClock === 3 || nextCp.turnClock === 2
          ? `${nextCp.turnClock}시 방향으로 우회전하세요.`
          : nextCp.turnClock === 9 || nextCp.turnClock === 10
            ? `${nextCp.turnClock}시 방향으로 좌회전하세요.`
            : "정면 12시 방향으로 직진하세요.";
      const crosswalkNote = nextCp.hasCrosswalk
        ? " 전방에 횡단보도가 있으니 보행자 신호를 확인합니다."
        : "";
      const tactileNote = nextCp.tactileContinues
        ? " 바닥 점자블록이 이어집니다."
        : "";

      return {
        updatedSession: {
          ...session,
          walkedMeters,
          currentCheckpointIndex: session.currentCheckpointIndex + 1,
        },
        spokenGuidance: `${remainingSteps}걸음 앞 ${nextCp.landmarkName}에서 ${turnText}${tactileNote}${crosswalkNote}`,
        reachedDestination: false,
      };
    }

    return {
      updatedSession: { ...session, walkedMeters },
      spokenGuidance: `정면 점자블록을 따라 ${remainingSteps}걸음 더 직진하세요. 다음 기준점은 ${nextCp.landmarkName}입니다.`,
      reachedDestination: false,
    };
  }

  getIndoorTransferCorridorPlan(params: {
    stationName: string;
    fromLine: string;
    toLine: string;
  }): string[] {
    const rule = findSubwayTransferRule(params);
    if (!rule) {
      return [
        `${params.stationName} ${params.toLine} 환승 유도 표지판과 바닥 점자블록을 따라 이동하세요.`,
      ];
    }

    return rule.corridorCheckpoints.map((cp) => guideTransferCorridorKo(cp));
  }
}
