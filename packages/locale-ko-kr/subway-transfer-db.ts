import type { TransferCorridorSignObservation } from "../core/transit-engine.ts";

export interface SubwayLineMetadata {
  lineId: string;
  lineNameKo: string;
  signColorNameKo: string;
  hexColor: string;
  carsPerTrain: number;
  doorsPerCar: number;
}

export const KOREAN_SUBWAY_LINES: Record<string, SubwayLineMetadata> = {
  "1호선": {
    lineId: "LINE_1",
    lineNameKo: "1호선",
    signColorNameKo: "남색 1호선",
    hexColor: "#0052A4",
    carsPerTrain: 10,
    doorsPerCar: 4,
  },
  "2호선": {
    lineId: "LINE_2",
    lineNameKo: "2호선",
    signColorNameKo: "초록색 2호선",
    hexColor: "#00A84D",
    carsPerTrain: 10,
    doorsPerCar: 4,
  },
  "3호선": {
    lineId: "LINE_3",
    lineNameKo: "3호선",
    signColorNameKo: "주황색 3호선",
    hexColor: "#EF7C1C",
    carsPerTrain: 10,
    doorsPerCar: 4,
  },
  "4호선": {
    lineId: "LINE_4",
    lineNameKo: "4호선",
    signColorNameKo: "하늘색 4호선",
    hexColor: "#00A5DE",
    carsPerTrain: 10,
    doorsPerCar: 4,
  },
  "5호선": {
    lineId: "LINE_5",
    lineNameKo: "5호선",
    signColorNameKo: "보라색 5호선",
    hexColor: "#996CAC",
    carsPerTrain: 8,
    doorsPerCar: 4,
  },
  "7호선": {
    lineId: "LINE_7",
    lineNameKo: "7호선",
    signColorNameKo: "올리브색 7호선",
    hexColor: "#747F00",
    carsPerTrain: 8,
    doorsPerCar: 4,
  },
  "9호선": {
    lineId: "LINE_9",
    lineNameKo: "9호선",
    signColorNameKo: "황금색 9호선",
    hexColor: "#BDB092",
    carsPerTrain: 6,
    doorsPerCar: 4,
  },
  신분당선: {
    lineId: "SHINBUNDANG",
    lineNameKo: "신분당선",
    signColorNameKo: "빨간색 신분당선",
    hexColor: "#D4003B",
    carsPerTrain: 6,
    doorsPerCar: 4,
  },
};

export interface SubwayTransferHubRule {
  stationName: string;
  fromLine: string;
  toLine: string;
  directionNextStation: string;
  platformType: "ISLAND" | "SIDE";
  higherCarDirectionWhenFacingDoor: "LEFT" | "RIGHT";
  fastTransferDoor: string;
  elevatorNearestDoor: string;
  corridorCheckpoints: TransferCorridorSignObservation[];
}

export const KOREAN_SUBWAY_TRANSFER_HUBS: readonly SubwayTransferHubRule[] = [
  {
    stationName: "교대역",
    fromLine: "2호선",
    toLine: "3호선",
    directionNextStation: "교대",
    platformType: "SIDE",
    higherCarDirectionWhenFacingDoor: "RIGHT",
    fastTransferDoor: "5-3",
    elevatorNearestDoor: "6-1",
    corridorCheckpoints: [
      {
        targetLineName: "주황색 3호선",
        arrowDirection: "LEFT",
        remainingMeters: 60,
        hasTactileJunctionAhead: true,
        verticalTransitionAhead: {
          type: "STAIRS_DOWN",
          distanceMeters: 10,
          handrailSide: "RIGHT",
        },
      },
      {
        targetLineName: "주황색 3호선 (수서·오금 방면)",
        arrowDirection: "STRAIGHT",
        remainingMeters: 25,
        hasTactileJunctionAhead: true,
      },
    ],
  },
  {
    stationName: "강남역",
    fromLine: "2호선",
    toLine: "신분당선",
    directionNextStation: "역삼",
    platformType: "SIDE",
    higherCarDirectionWhenFacingDoor: "LEFT",
    fastTransferDoor: "8-3",
    elevatorNearestDoor: "9-1",
    corridorCheckpoints: [
      {
        targetLineName: "빨간색 신분당선",
        arrowDirection: "RIGHT",
        remainingMeters: 110,
        hasTactileJunctionAhead: true,
        verticalTransitionAhead: {
          type: "ESCALATOR",
          distanceMeters: 15,
          handrailSide: "RIGHT",
        },
      },
      {
        targetLineName: "빨간색 신분당선 환승 게이트",
        arrowDirection: "STRAIGHT",
        remainingMeters: 40,
        hasTactileJunctionAhead: true,
        verticalTransitionAhead: {
          type: "STAIRS_DOWN",
          distanceMeters: 12,
          handrailSide: "RIGHT",
        },
      },
    ],
  },
  {
    stationName: "사당역",
    fromLine: "2호선",
    toLine: "4호선",
    directionNextStation: "방배",
    platformType: "SIDE",
    higherCarDirectionWhenFacingDoor: "RIGHT",
    fastTransferDoor: "4-2",
    elevatorNearestDoor: "5-1",
    corridorCheckpoints: [
      {
        targetLineName: "하늘색 4호선",
        arrowDirection: "RIGHT",
        remainingMeters: 50,
        hasTactileJunctionAhead: true,
        verticalTransitionAhead: {
          type: "STAIRS_DOWN",
          distanceMeters: 8,
          handrailSide: "RIGHT",
        },
      },
    ],
  },
  {
    stationName: "고속터미널역",
    fromLine: "3호선",
    toLine: "9호선",
    directionNextStation: "잠원",
    platformType: "SIDE",
    higherCarDirectionWhenFacingDoor: "LEFT",
    fastTransferDoor: "7-2",
    elevatorNearestDoor: "7-4",
    corridorCheckpoints: [
      {
        targetLineName: "황금색 9호선",
        arrowDirection: "SLIGHT_RIGHT",
        remainingMeters: 140,
        hasTactileJunctionAhead: true,
        verticalTransitionAhead: {
          type: "ESCALATOR",
          distanceMeters: 18,
          handrailSide: "RIGHT",
        },
      },
      {
        targetLineName: "황금색 9호선 급행 승강장",
        arrowDirection: "LEFT",
        remainingMeters: 55,
        hasTactileJunctionAhead: true,
        verticalTransitionAhead: {
          type: "STAIRS_DOWN",
          distanceMeters: 10,
          handrailSide: "RIGHT",
        },
      },
    ],
  },
  {
    stationName: "신도림역",
    fromLine: "2호선",
    toLine: "1호선",
    directionNextStation: "문래",
    platformType: "ISLAND",
    higherCarDirectionWhenFacingDoor: "RIGHT",
    fastTransferDoor: "6-2",
    elevatorNearestDoor: "5-4",
    corridorCheckpoints: [
      {
        targetLineName: "남색 1호선",
        arrowDirection: "STRAIGHT",
        remainingMeters: 45,
        hasTactileJunctionAhead: true,
        verticalTransitionAhead: {
          type: "STAIRS_UP",
          distanceMeters: 7,
          handrailSide: "RIGHT",
        },
      },
    ],
  },
  {
    stationName: "여의도역",
    fromLine: "5호선",
    toLine: "9호선",
    directionNextStation: "여의나루",
    platformType: "SIDE",
    higherCarDirectionWhenFacingDoor: "LEFT",
    fastTransferDoor: "4-3",
    elevatorNearestDoor: "4-1",
    corridorCheckpoints: [
      {
        targetLineName: "황금색 9호선",
        arrowDirection: "LEFT",
        remainingMeters: 70,
        hasTactileJunctionAhead: true,
        verticalTransitionAhead: {
          type: "STAIRS_UP",
          distanceMeters: 9,
          handrailSide: "RIGHT",
        },
      },
    ],
  },
];

export function findSubwayTransferRule(params: {
  stationName: string;
  fromLine: string;
  toLine: string;
}): SubwayTransferHubRule | null {
  const normalizedStation = params.stationName.replace(/역$/, "") + "역";
  return (
    KOREAN_SUBWAY_TRANSFER_HUBS.find(
      (rule) =>
        rule.stationName === normalizedStation &&
        rule.fromLine === params.fromLine &&
        rule.toLine === params.toLine,
    ) ?? null
  );
}

/**
 * Major Seoul Metropolitan Subway Line Station Sequences for Subway Route Map Planning (Fixes LUM-68, LUM-70)
 */
export const SEOUL_SUBWAY_STATION_MAP: Record<string, readonly string[]> = {
  "2호선": [
    "시청", "을지로입구", "을지로3가", "을지로4가", "동대문역사문화공원", "신당", "상왕십리",
    "왕십리", "한양대", "뚝섬", "성수", "건대입구", "구의", "강변", "잠실나루", "잠실",
    "잠실새내", "종합운동장", "삼성", "선릉", "역삼", "강남", "교대", "서초", "방배", "사당",
    "낙성대", "서울대입구", "봉천", "신림", "신대방", "구로디지털단지", "대림", "신도림",
    "문래", "영등포구청", "당산", "합정", "홍대입구", "신촌", "이대", "아현", "충정로",
  ],
  "3호선": [
    "종로3가", "을지로3가", "충무로", "동대입구", "약수", "금호", "옥수", "압구정", "신사",
    "잠원", "고속터미널", "교대", "남부터미널", "양재", "매봉", "도곡", "대치", "학여울", "수서",
  ],
  "4호선": [
    "혜화", "동대문", "동대문역사문화공원", "충무로", "명동", "회현", "서울역", "숙대입구",
    "삼각지", "신용산", "이촌", "동작", "총신대입구", "사당",
  ],
  "5호선": [
    "광화문", "종로3가", "을지로4가", "동대문역사문화공원", "청구", "신금호", "행당",
    "왕십리", "마장", "답십리", "장한평", "군자", "아차산", "광나루", "천호", "강동",
    "여의도", "여의나루", "마포", "공덕", "충정로",
  ],
  "7호선": [
    "건대입구", "자양", "청담", "강남구청", "학동", "논현", "반포", "고속터미널", "내방",
    "이수", "남성", "숭실대입구", "대림",
  ],
  "9호선": [
    "김포공항", "당산", "국회의사당", "여의도", "샛강", "노량진", "흑석", "동작",
    "고속터미널", "신논현", "언주", "선정릉", "삼성중앙", "봉은사", "종합운동장", "석촌",
  ],
  수인분당선: [
    "청량리", "왕십리", "서울숲", "압구정로데오", "강남구청", "선정릉", "선릉", "한티", "도곡", "수서",
  ],
  신분당선: ["신사", "논현", "신논현", "강남", "양재", "양재시민의숲", "판교"],
};

function normalizeStationCore(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(
      /(?:수도권|서울|부산|대구|대전|광주)?(?:\d+호선|수인분당선|신분당선|경의중앙선|공항철도|경춘선|우이신설선|신림선|김포골드라인|서해선)/g,
      "",
    )
    .replace(/\d+번출구/g, "")
    .replace(/\s+/g, "")
    .replace(/역$/, "");
}

export interface SubwayStationCoordAndDoor {
  lat: number;
  lng: number;
  doorSideKo: "오른쪽" | "왼쪽";
}

/**
 * GPS coordinates and door opening side (오른쪽=상대식, 왼쪽=섬식) for key Seoul Subway stations
 * so SOTA can infer which station the train is currently passing using live GPS (Fixes LUM-83, LUM-84, LUM-85, LUM-105).
 */
export const SEOUL_SUBWAY_STATION_COORDS: Record<string, SubwayStationCoordAndDoor> = {
  상왕십리: { lat: 37.5643, lng: 127.0293, doorSideKo: "오른쪽" },
  왕십리: { lat: 37.5612, lng: 127.0370, doorSideKo: "오른쪽" },
  한양대: { lat: 37.5553, lng: 127.0436, doorSideKo: "오른쪽" },
  뚝섬: { lat: 37.5472, lng: 127.0474, doorSideKo: "오른쪽" },
  성수: { lat: 37.5446, lng: 127.0560, doorSideKo: "오른쪽" },
  건대입구: { lat: 37.5404, lng: 127.0692, doorSideKo: "오른쪽" },
  구의: { lat: 37.5371, lng: 127.0861, doorSideKo: "오른쪽" },
  강변: { lat: 37.5351, lng: 127.0947, doorSideKo: "오른쪽" },
  잠실나루: { lat: 37.5207, lng: 127.1038, doorSideKo: "왼쪽" },
  잠실: { lat: 37.5133, lng: 127.1001, doorSideKo: "오른쪽" },
  잠실새내: { lat: 37.5116, lng: 127.0862, doorSideKo: "오른쪽" },
  종합운동장: { lat: 37.5110, lng: 127.0736, doorSideKo: "오른쪽" },
  삼성: { lat: 37.5088, lng: 127.0632, doorSideKo: "왼쪽" },
  선릉: { lat: 37.5045, lng: 127.0490, doorSideKo: "오른쪽" },
  역삼: { lat: 37.5006, lng: 127.0364, doorSideKo: "오른쪽" },
  강남: { lat: 37.4979, lng: 127.0276, doorSideKo: "오른쪽" },
  교대: { lat: 37.4934, lng: 127.0141, doorSideKo: "오른쪽" },
  서초: { lat: 37.4919, lng: 127.0079, doorSideKo: "오른쪽" },
  방배: { lat: 37.4814, lng: 126.9976, doorSideKo: "오른쪽" },
  사당: { lat: 37.4765, lng: 126.9816, doorSideKo: "오른쪽" },
  신도림: { lat: 37.5088, lng: 126.8913, doorSideKo: "왼쪽" },
  여의도: { lat: 37.5216, lng: 126.9242, doorSideKo: "오른쪽" },
  행당: { lat: 37.5574, lng: 127.0295, doorSideKo: "오른쪽" },
  답십리: { lat: 37.5667, lng: 127.0527, doorSideKo: "오른쪽" },
  군자: { lat: 37.5571, lng: 127.0795, doorSideKo: "오른쪽" },
  아차산: { lat: 37.5519, lng: 127.0898, doorSideKo: "오른쪽" },
  광나루: { lat: 37.5453, lng: 127.1036, doorSideKo: "오른쪽" },
};

export interface LiveSubwayRideStatus {
  currentStationKo: string;
  destinationStationKo: string;
  remainingStops: number;
  destinationDoorSideKo: "오른쪽" | "왼쪽";
  targetExitTextKo: string;
  coachingKo: string;
}

/**
 * Computes real-time on-board subway progress (current station, remaining stops, door opening side,
 * 1-stop-before preparation alert, and exit number) from GPS or observed station name.
 */
export function computeLiveSubwayRideStatusKo(params: {
  currentLat: number;
  currentLng: number;
  observedStationRaw?: string;
  routeStations: readonly string[]; // e.g. ["왕십리", "한양대", "뚝섬", "성수", "건대입구", "구의"]
  destinationExitRaw?: string; // e.g. "구의역 1번출구"
}): LiveSubwayRideStatus | null {
  if (params.routeStations.length < 2) return null;
  const destCore = normalizeStationCore(
    params.routeStations[params.routeStations.length - 1],
  );
  const destInfo = SEOUL_SUBWAY_STATION_COORDS[destCore];
  const destDoorSideKo = destInfo?.doorSideKo ?? "오른쪽";
  const exitMatch = params.destinationExitRaw?.match(/(\d+)\s*번\s*출구/);
  const targetExitTextKo = exitMatch ? `${exitMatch[1]}번 출구` : "출구";

  let currentIdx = 0;
  if (params.observedStationRaw) {
    const obsCore = normalizeStationCore(params.observedStationRaw);
    const foundIdx = params.routeStations.findIndex(
      (s) => normalizeStationCore(s) === obsCore,
    );
    if (foundIdx !== -1) currentIdx = foundIdx;
  } else {
    // Infer nearest station along the route from live GPS coordinates
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let i = 0; i < params.routeStations.length; i++) {
      const stCore = normalizeStationCore(params.routeStations[i]);
      const coord = SEOUL_SUBWAY_STATION_COORDS[stCore];
      if (!coord) continue;
      const dLat = params.currentLat - coord.lat;
      const dLng = params.currentLng - coord.lng;
      const dSq = dLat * dLat + dLng * dLng;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        currentIdx = i;
      }
    }
  }

  const curCore = normalizeStationCore(params.routeStations[currentIdx]);
  const remainingStops = Math.max(
    0,
    params.routeStations.length - 1 - currentIdx,
  );

  let coachingKo = "";
  if (remainingStops >= 2) {
    coachingKo = `현재 ${curCore}역 부근을 지나고 있어요. 내리실 ${destCore}역까지 ${remainingStops}정거장 남았으니 아직 내리지 마시고 출입문 옆 손잡이를 잡고 편하게 서 계세요. ${destCore}역 내리실 문은 ${destDoorSideKo}입니다.`;
  } else if (remainingStops === 1) {
    coachingKo = `현재 ${curCore}역이에요. 바로 다음 역이 내리실 ${destCore}역입니다! ${destCore}역에서는 ${destDoorSideKo} 문이 열리니 지금부터 출입문 앞에서 내릴 준비를 해주세요.`;
  } else {
    coachingKo = `드디어 목적지인 ${destCore}역에 도착했어요. ${destDoorSideKo} 출입문이 완전히 열리고 앞사람들이 내린 뒤 안전하게 내려서 ${targetExitTextKo} 방향 표지판과 점자블록을 따라 이동해 주세요.`;
  }

  return {
    currentStationKo: `${curCore}역`,
    destinationStationKo: `${destCore}역`,
    remainingStops,
    destinationDoorSideKo: destDoorSideKo,
    targetExitTextKo,
    coachingKo,
  };
}

export interface SubwayRoutePlanResult {
  startStationKo: string;
  endStationKo: string;
  primaryLineKo: string;
  transferStationKo?: string;
  transferLineKo?: string;
  totalStops: number;
  estimatedSubwayMinutes: number;
  intermediateStationsKo: string[];
  /** Full station sequence including startStation through endStation */
  allRouteStationsKo: string[];
  destinationDoorSideKo: "오른쪽" | "왼쪽";
  summaryKo: string;
}

/**
 * Computes a station-by-station Seoul Subway Route Map between two stations (direct or 1-transfer).
 */
export function computeSeoulSubwayRouteKo(
  startStationRaw: string,
  endStationRaw: string,
): SubwayRoutePlanResult | null {
  const sCore = normalizeStationCore(startStationRaw);
  const eCore = normalizeStationCore(endStationRaw);
  if (!sCore || !eCore || sCore === eCore) return null;

  // 1. Check same-line direct route
  for (const [lineName, stations] of Object.entries(SEOUL_SUBWAY_STATION_MAP)) {
    const sIdx = stations.indexOf(sCore);
    const eIdx = stations.indexOf(eCore);
    if (sIdx !== -1 && eIdx !== -1) {
      let path: string[] = [];
      if (lineName === "2호선") {
        // Circular line: pick shorter direction around the loop
        const n = stations.length;
        const forwardSteps = (eIdx - sIdx + n) % n;
        const backwardSteps = (sIdx - eIdx + n) % n;
        if (forwardSteps <= backwardSteps) {
          for (let i = 1; i <= forwardSteps; i++) {
            path.push(stations[(sIdx + i) % n]);
          }
        } else {
          for (let i = 1; i <= backwardSteps; i++) {
            path.push(stations[(sIdx - i + n) % n]);
          }
        }
      } else {
        if (sIdx < eIdx) {
          path = stations.slice(sIdx + 1, eIdx + 1);
        } else {
          path = stations.slice(eIdx, sIdx).reverse();
        }
      }
      const stops = path.length;
      const mins = Math.max(2, stops * 2);
      const nextStn = path[0] ?? eCore;
      const viaSample =
        path.length > 2
          ? `${path.slice(0, -1).slice(0, 3).join(", ")} 등을 지나 `
          : "";
      const destDoorSideKo =
        SEOUL_SUBWAY_STATION_COORDS[eCore]?.doorSideKo ?? "오른쪽";
      return {
        startStationKo: `${sCore}역`,
        endStationKo: `${eCore}역`,
        primaryLineKo: lineName,
        totalStops: stops,
        estimatedSubwayMinutes: mins,
        intermediateStationsKo: path,
        allRouteStationsKo: [sCore, ...path],
        destinationDoorSideKo: destDoorSideKo,
        summaryKo: `${sCore}역에서 ${lineName} ${nextStn} 방면 열차를 타고 ${viaSample}${stops}정거장(약 ${mins}분) 이동해 ${eCore}역(${destDoorSideKo} 문 열림)에서 하차`,
      };
    }
  }

  // 2. Check 1-transfer route across lines
  for (const [lineA, stnsA] of Object.entries(SEOUL_SUBWAY_STATION_MAP)) {
    const sIdx = stnsA.indexOf(sCore);
    if (sIdx === -1) continue;
    for (const [lineB, stnsB] of Object.entries(SEOUL_SUBWAY_STATION_MAP)) {
      if (lineA === lineB) continue;
      const eIdx = stnsB.indexOf(eCore);
      if (eIdx === -1) continue;

      const transferStn = stnsA.find((st) => stnsB.includes(st));
      if (transferStn) {
        const leg1 = computeSeoulSubwayRouteKo(sCore, transferStn);
        const leg2 = computeSeoulSubwayRouteKo(transferStn, eCore);
        if (leg1 && leg2) {
          const totalStops = leg1.totalStops + leg2.totalStops;
          const totalMins = leg1.estimatedSubwayMinutes + leg2.estimatedSubwayMinutes + 4;
          const destDoorSideKo =
            SEOUL_SUBWAY_STATION_COORDS[eCore]?.doorSideKo ?? "오른쪽";
          return {
            startStationKo: `${sCore}역`,
            endStationKo: `${eCore}역`,
            primaryLineKo: lineA,
            transferStationKo: `${transferStn}역`,
            transferLineKo: lineB,
            totalStops,
            estimatedSubwayMinutes: totalMins,
            intermediateStationsKo: [
              ...leg1.intermediateStationsKo,
              ...leg2.intermediateStationsKo,
            ],
            allRouteStationsKo: [
              sCore,
              ...leg1.intermediateStationsKo,
              ...leg2.intermediateStationsKo,
            ],
            destinationDoorSideKo: destDoorSideKo,
            summaryKo: `${sCore}역에서 ${lineA} 탑승 후 ${transferStn}역에서 ${lineB}으로 환승하여 총 ${totalStops}정거장(약 ${totalMins}분) 이동해 ${eCore}역(${destDoorSideKo} 문 열림)에서 하차`,
          };
        }
      }
    }
  }

  return null;
}
