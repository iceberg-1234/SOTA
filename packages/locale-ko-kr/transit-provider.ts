import {
  getSecretFromKeychainOrEnv,
  KEYCHAIN_SERVICE_SEOUL_BUS,
  KEYCHAIN_SERVICE_SEOUL_SUBWAY,
  KEYCHAIN_SERVICE_TRANSIT,
  maskSecretMetadata,
} from "../core/keychain.ts";
import {
  verifyBusStopAndArrivalKo,
  verifySubwayPlatformAndTransferKo,
  type BusStopGuidanceResult,
  type SubwayPlatformGuidanceResult,
} from "../core/transit-engine.ts";
import { findSubwayTransferRule } from "./subway-transfer-db.ts";

export interface KoreanBusStopRecord {
  arsId: string;
  stopName: string;
  directionDescription: string;
  lat: number;
  lng: number;
  routes: Array<{
    routeNumber: string;
    nextArrivalMinutes: number;
    stopsAway: number;
    lowFloorBus: boolean;
  }>;
}

export const SEOUL_SAMPLE_BUS_STOPS: readonly KoreanBusStopRecord[] = [
  {
    arsId: "22-001",
    stopName: "신논현역·주류성빌딩",
    directionDescription: "강남역·양재역",
    lat: 37.5048,
    lng: 127.0245,
    routes: [
      {
        routeNumber: "472",
        nextArrivalMinutes: 2,
        stopsAway: 1,
        lowFloorBus: true,
      },
      {
        routeNumber: "143",
        nextArrivalMinutes: 1,
        stopsAway: 0,
        lowFloorBus: true,
      },
      {
        routeNumber: "140",
        nextArrivalMinutes: 4,
        stopsAway: 2,
        lowFloorBus: true,
      },
    ],
  },
  {
    arsId: "22-002",
    stopName: "신논현역·인터파크씨어터",
    directionDescription: "논현역·신사역·한남대교",
    lat: 37.5052,
    lng: 127.0241,
    routes: [
      {
        routeNumber: "472",
        nextArrivalMinutes: 4,
        stopsAway: 2,
        lowFloorBus: true,
      },
      {
        routeNumber: "143",
        nextArrivalMinutes: 7,
        stopsAway: 4,
        lowFloorBus: false,
      },
    ],
  },
  {
    arsId: "23-112",
    stopName: "역삼역·포스코타워",
    directionDescription: "선릉역·삼성역",
    lat: 37.5006,
    lng: 127.0364,
    routes: [
      {
        routeNumber: "146",
        nextArrivalMinutes: 3,
        stopsAway: 1,
        lowFloorBus: true,
      },
      {
        routeNumber: "341",
        nextArrivalMinutes: 5,
        stopsAway: 2,
        lowFloorBus: true,
      },
    ],
  },
];

function parseKoreanArrivalMessage(
  arrmsg?: string,
  traTimeSec?: string,
): { minutes: number; stopsAway: number; rawMessage: string } {
  const raw = (arrmsg ?? "").trim();
  const minMatch = raw.match(/(\d+)\s*분/);
  const stopMatch = raw.match(/\[(\d+)번째\s*전\]/);
  const fallbackMinutes = traTimeSec
    ? Math.max(1, Math.round(Number(traTimeSec) / 60))
    : 3;
  const minutes = raw.includes("곧도착")
    ? 1
    : minMatch
      ? Number(minMatch[1])
      : fallbackMinutes;
  const stopsAway = stopMatch ? Number(stopMatch[1]) : 1;
  return { minutes, stopsAway, rawMessage: raw };
}

export class KoreaTransitProvider {
  private readonly seoulSubwayKey: string | null;
  private readonly seoulBusKey: string | null;

  constructor(options?: { seoulSubwayKey?: string; seoulBusKey?: string }) {
    const sharedKey = getSecretFromKeychainOrEnv(
      KEYCHAIN_SERVICE_TRANSIT,
      "KOREA_TRANSIT_API_KEY",
    );
    this.seoulSubwayKey =
      options?.seoulSubwayKey ??
      getSecretFromKeychainOrEnv(
        KEYCHAIN_SERVICE_SEOUL_SUBWAY,
        "SEOUL_SUBWAY_API_KEY",
      ) ??
      sharedKey;
    this.seoulBusKey =
      options?.seoulBusKey ??
      getSecretFromKeychainOrEnv(
        KEYCHAIN_SERVICE_SEOUL_BUS,
        "SEOUL_BUS_API_KEY",
      ) ??
      sharedKey;
  }

  getProviderStatus() {
    return {
      activeRegionScope: "SEOUL_METROPOLITAN" as const,
      nationwideTagoScope: "BACKLOG_PHASE_2" as const,
      seoulSubwayKey: maskSecretMetadata(this.seoulSubwayKey),
      seoulBusKey: maskSecretMetadata(this.seoulBusKey),
    };
  }

  /**
   * Calls Seoul Open Data Plaza Realtime Subway Arrival API (`swopenAPI.seoul.go.kr`)
   * using `LUMO_SEOUL_SUBWAY_API_KEY` from macOS Keychain.
   */
  async fetchSeoulSubwayArrivalLive(params: {
    stationName: string;
    intendedDirectionStation?: string;
  }): Promise<{
    arrivalMinutes: number;
    arvlMsg2?: string;
    trainLineNm?: string;
    source: "SEOUL_TOPIS_LIVE" | "SEOUL_EMBEDDED_FALLBACK";
  }> {
    if (!this.seoulSubwayKey) {
      return { arrivalMinutes: 3, source: "SEOUL_EMBEDDED_FALLBACK" };
    }

    const cleanStation = params.stationName.replace(/역$/, "");
    const url = `http://swopenAPI.seoul.go.kr/api/subway/${encodeURIComponent(this.seoulSubwayKey)}/json/realtimeStationArrival/0/15/${encodeURIComponent(cleanStation)}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (res.ok) {
        const data = (await res.json()) as any;
        const list: any[] = data?.realtimeArrivalList ?? [];
        const matched =
          (params.intendedDirectionStation
            ? list.find((item) =>
                String(item?.trainLineNm ?? "").includes(
                  params.intendedDirectionStation!,
                ),
              )
            : null) ?? list[0];

        if (matched) {
          const sec = Number(matched.barvlDt ?? 0);
          const minFromMsg = String(matched.arvlMsg2 ?? "").match(/(\d+)\s*분/);
          const arrivalMinutes =
            sec > 0
              ? Math.max(1, Math.round(sec / 60))
              : minFromMsg
                ? Number(minFromMsg[1])
                : 2;
          return {
            arrivalMinutes,
            arvlMsg2: String(matched.arvlMsg2 ?? ""),
            trainLineNm: String(matched.trainLineNm ?? ""),
            source: "SEOUL_TOPIS_LIVE",
          };
        }
      }
    } catch {
      // Fallback to embedded dataset on network error
    }

    return { arrivalMinutes: 3, source: "SEOUL_EMBEDDED_FALLBACK" };
  }

  /**
   * Calls Seoul Bus Station Information API (`ws.bus.go.kr/api/rest/stationinfo/getStationByUid`)
   * using `LUMO_SEOUL_BUS_API_KEY` from macOS Keychain.
   */
  async fetchSeoulBusStopGuidanceLive(params: {
    observedArsId: string;
    targetRouteNumber: string;
    intendedDirectionKeyword: string;
    approachingBusesFromVision?: Array<{
      order: number;
      routeNumber: string;
      doorDistanceMeters?: number;
      isDoorOpen?: boolean;
    }>;
  }): Promise<
    BusStopGuidanceResult & {
      source: "SEOUL_BUS_LIVE" | "SEOUL_EMBEDDED_FALLBACK";
      liveStationName?: string;
      liveArrivalRaw?: string;
    }
  > {
    if (this.seoulBusKey) {
      const digitsArsId = params.observedArsId.replace(/\D/g, "");
      const url = `http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid?serviceKey=${encodeURIComponent(this.seoulBusKey)}&arsId=${encodeURIComponent(digitsArsId)}&resultType=json`;

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
        if (res.ok) {
          const data = (await res.json()) as any;
          const items: any[] = data?.msgBody?.itemList ?? [];
          if (items.length > 0) {
            const matchedRoute =
              items.find(
                (it) =>
                  String(it.rtNm) === params.targetRouteNumber ||
                  String(it.busRouteAbrv) === params.targetRouteNumber,
              ) ?? items[0];

            const stNm = String(matchedRoute.stNm ?? "정류소");
            const directionComposite = [
              matchedRoute.nxtStn,
              matchedRoute.adirection,
              matchedRoute.sectNm,
              params.intendedDirectionKeyword,
            ]
              .filter(Boolean)
              .join("·");

            const parsed = parseKoreanArrivalMessage(
              matchedRoute.arrmsg1,
              matchedRoute.traTime1,
            );

            const guidance = verifyBusStopAndArrivalKo({
              targetRouteNumber: String(
                matchedRoute.rtNm ?? params.targetRouteNumber,
              ),
              intendedDirectionKeyword: params.intendedDirectionKeyword,
              observedArsId: params.observedArsId,
              observedStopName: stNm,
              observedDirectionSign: directionComposite,
              nextArrivalMinutes: parsed.minutes,
              stopsAway: parsed.stopsAway,
              approachingBuses: params.approachingBusesFromVision,
            });

            return {
              ...guidance,
              source: "SEOUL_BUS_LIVE",
              liveStationName: stNm,
              liveArrivalRaw: parsed.rawMessage,
            };
          }
        }
      } catch {
        // Fallback to embedded dataset on network error
      }
    }

    const fallback = this.queryBusStopGuidance(params);
    return {
      ...fallback,
      source: "SEOUL_EMBEDDED_FALLBACK",
    };
  }

  queryBusStopGuidance(params: {
    observedArsId?: string;
    observedStopName?: string;
    targetRouteNumber: string;
    intendedDirectionKeyword: string;
    approachingBusesFromVision?: Array<{
      order: number;
      routeNumber: string;
      doorDistanceMeters?: number;
      isDoorOpen?: boolean;
    }>;
  }): BusStopGuidanceResult {
    const matchedStop =
      SEOUL_SAMPLE_BUS_STOPS.find(
        (s) =>
          (params.observedArsId && s.arsId === params.observedArsId) ||
          (params.observedStopName &&
            s.stopName.includes(params.observedStopName)),
      ) ?? SEOUL_SAMPLE_BUS_STOPS[0];

    const routeInfo = matchedStop.routes.find(
      (r) => r.routeNumber === params.targetRouteNumber,
    ) ?? {
      routeNumber: params.targetRouteNumber,
      nextArrivalMinutes: 5,
      stopsAway: 2,
      lowFloorBus: true,
    };

    return verifyBusStopAndArrivalKo({
      targetRouteNumber: params.targetRouteNumber,
      intendedDirectionKeyword: params.intendedDirectionKeyword,
      observedArsId: matchedStop.arsId,
      observedStopName: matchedStop.stopName,
      observedDirectionSign: matchedStop.directionDescription,
      nextArrivalMinutes: routeInfo.nextArrivalMinutes,
      stopsAway: routeInfo.stopsAway,
      approachingBuses: params.approachingBusesFromVision,
    });
  }

  querySubwayPlatformAndTransferGuidance(params: {
    currentLine: string;
    intendedDirectionStation: string;
    observedNextStationOnSign: string;
    observedScreenDoor: string;
    transferStationName?: string;
    transferTargetLine?: string;
    preferElevator?: boolean;
    nextTrainArrivalMinutes?: number;
  }): SubwayPlatformGuidanceResult {
    const rule =
      params.transferStationName && params.transferTargetLine
        ? findSubwayTransferRule({
            stationName: params.transferStationName,
            fromLine: params.currentLine,
            toLine: params.transferTargetLine,
          })
        : null;

    const targetDoor = rule
      ? params.preferElevator
        ? rule.elevatorNearestDoor
        : rule.fastTransferDoor
      : undefined;

    return verifySubwayPlatformAndTransferKo({
      lineName: params.currentLine,
      intendedDirectionStation: params.intendedDirectionStation,
      observedNextStationOnSign: params.observedNextStationOnSign,
      observedScreenDoor: params.observedScreenDoor,
      fastTransferTargetDoor: targetDoor,
      transferStationName: rule?.stationName ?? params.transferStationName,
      transferTargetLine: rule?.toLine ?? params.transferTargetLine,
      higherCarDirectionWhenFacingDoor:
        rule?.higherCarDirectionWhenFacingDoor ?? "RIGHT",
      nextTrainArrivalMinutes: params.nextTrainArrivalMinutes ?? 3,
    });
  }
}
