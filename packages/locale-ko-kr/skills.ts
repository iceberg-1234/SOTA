import {
  isValidObservedSlot,
  type LumoSkillPlugin,
} from "../core/agent-harness.ts";
import { KoreanSmartReader } from "../core/smart-reader.ts";
import { coachFingertipToButtonKo } from "../core/spatial-language.ts";
import {
  verifyBusStopAndArrivalKo,
  verifyCalledTaxiOrRideKo,
  verifySubwayPlatformAndTransferKo,
} from "../core/transit-engine.ts";
import { KoreaTransitProvider } from "./transit-provider.ts";

const smartReader = new KoreanSmartReader();
const runtimeVisualMemory = new Map<string, string>([
  ["에어팟", "소파 오른쪽 쿠션 옆"],
  ["안경", "침대 머리맡 협탁 위"],
  ["열쇠", "현관 신발장 트레이 위"],
]);

/**
 * 1:1 Micro-Skill Plugin Registry covering all 23 Korean Visually Impaired Use Cases (UC-01 ~ UC-23).
 * Combined with StatefulSkillHarness's Context Gate (max 4 active micro-skills per prompt),
 * scaling the number of Use Cases causes ZERO prompt bloat or cross-scenario interference.
 */
export function createKoreanSkillPlugins(
  transitProvider = new KoreaTransitProvider(),
): readonly LumoSkillPlugin[] {
  return [
    {
      id: "WALKING_SAFETY",
      labelKo: "보행 안전 · 점자블록/저조도(UC-04,05,18)",
      triggerDescriptionKo:
        "보행로, 점자블록, 공유 킥보드/볼라드(UC-05), 어두운 실내/야간 저조도 구간(UC-18)이 보일 때",
      extractionRulesKo:
        "헤더: `[WALKING_SAFETY | hazard=킥보드, steps=3]` — 진행 방향 기준 걸음 수와 좌우 회피 방향, 저조도 바닥 평탄도를 구어체로 안내하세요.",
      relatedSkillIds: ["STEP_AND_GLASS_DOOR", "CROSSWALK_SIGNAL", "BUS_STOP"],
      priority: "P0_SAFETY",
      earcon: "HAZARD_ALERT",
    },
    {
      id: "STEP_AND_GLASS_DOOR",
      labelKo: "무표시 계단 · 단차 · 투명유리문 감지(UC-14)",
      triggerDescriptionKo:
        "대비감도가 낮은 회색 내리막 계단 첫 단, 보도 연석 단차, 프레임 없는 투명 통유리문과 손잡이가 보일 때",
      extractionRulesKo:
        "헤더: `[STEP_AND_GLASS_DOOR | type=내리막계단또는투명유리문, steps=2, handleSide=오른쪽, action=당기기]` — 평지나 열린 공간으로 착각하기 쉬운 단차/유리문과 손잡이/난간 위치를 즉시 경고하세요.",
      relatedSkillIds: ["WALKING_SAFETY", "INDOOR_SPACE"],
      priority: "P0_SAFETY",
      earcon: "HAZARD_ALERT",
      executePostProcess: async (obs) => {
        const t = obs.extractedSlots.type;
        const steps = obs.extractedSlots.steps || "2";
        const side = obs.extractedSlots.handleSide || "오른쪽";
        const act = obs.extractedSlots.action || "열기";
        if (t?.includes("유리문")) {
          return `주의하세요! 지금 걸어가시는 정면 ${steps}걸음 앞에 투명 통유리문이 있어요. ${side}에 ${act} 손잡이가 있으니 잡고 여세요.`;
        }
        if (t?.includes("계단") || t?.includes("단차")) {
          return `주의하세요! 정면 ${steps}걸음 앞에 ${t}이 시작돼요. ${side} 난간이나 지팡이로 높이를 먼저 확인하세요.`;
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "CROSSWALK_SIGNAL",
      labelKo: "횡단보도 · 역광 신호등 인식(UC-06,19)",
      triggerDescriptionKo:
        "횡단보도 대기선이나 보행자 신호등(적색/녹색/잔여초 및 역광 눈부심 구간 UC-19)이 보일 때",
      extractionRulesKo:
        "헤더: `[CROSSWALK_SIGNAL | signal=GREEN, remainSec=24]` — 역광 속에서도 신호등 색깔과 잔여 초, 정면 진행 방향을 즉시 안내하세요.",
      relatedSkillIds: ["WALKING_SAFETY", "BUS_STOP"],
      priority: "P0_SAFETY",
      earcon: "SIGNAL_GREEN",
    },
    {
      id: "BUS_STOP",
      labelKo: "버스 정류장 · 실시간 노선 매칭(UC-07,19)",
      triggerDescriptionKo:
        "버스 정류장 표지판(5자리 ARS 번호), 역광 BIT 전광판(UC-19), 진입 시내버스가 보일 때",
      extractionRulesKo:
        "헤더: `[BUS_STOP | arsId=22-001, route=140, direction=양재역]` — 정류소 번호나 진입 버스 번호와 앞문까지 걸음 수를 안내하세요.",
      relatedSkillIds: ["WALKING_SAFETY", "TAXI_MATCHER", "CROSSWALK_SIGNAL"],
      priority: "P1_NAVIGATION",
      earcon: "TRANSIT_ARRIVING",
      executePostProcess: async (obs) => {
        const arsId = obs.extractedSlots.arsId;
        const route = obs.extractedSlots.route;
        const direction =
          obs.extractedSlots.direction ||
          obs.activeMission?.goalText ||
          "방면";

        if (isValidObservedSlot(arsId) || isValidObservedSlot(route)) {
          const live = await transitProvider.fetchSeoulBusArrival({
            arsId: isValidObservedSlot(arsId) ? arsId! : "22-001",
            targetRouteNumber: isValidObservedSlot(route) ? route! : "140",
          });
          if (live.arrivals.length > 0) {
            const first = live.arrivals[0];
            const verified = verifyBusStopAndArrivalKo({
              intendedDirectionSummary: direction,
              observedStopName: live.stopName,
              observedDirectionSummary: direction,
              targetRouteNumber: first.routeNumber,
              arrivalMinutes: first.arrivalMinutes,
              remainingStops: first.remainingStops,
              approachingBuses: [
                {
                  order: 1,
                  routeNumber: first.routeNumber,
                  doorOpened: first.arrivalMinutes <= 1,
                  doorDistanceMeters: 3.5,
                },
              ],
            });
            return `${verified.spokenGuidance} ${obs.draftSpokenKorean}`;
          }
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "TAXI_MATCHER",
      labelKo: "호출 택시 · 장애인콜택시 번호판 매칭(UC-15)",
      triggerDescriptionKo:
        "호출한 택시나 장애인 콜택시(장콜)가 진입하거나 정차해 번호판·색상·차종과 승차문을 확인할 때",
      extractionRulesKo:
        "헤더: `[TAXI_MATCHER | taxiPlate=34바5678, taxiColor=흰색, taxiModel=쏘나타, doorDistM=2.1]` — 차량 색상, 차종, 번호판 전체 숫자와 뒷좌석 오른쪽 문 손잡이 위치를 정확히 읽어주세요.",
      relatedSkillIds: ["WALKING_SAFETY", "BUS_STOP"],
      priority: "P1_NAVIGATION",
      earcon: "TRANSIT_ARRIVING",
      executePostProcess: async (obs) => {
        const taxiPlate = obs.extractedSlots.taxiPlate;
        if (isValidObservedSlot(taxiPlate)) {
          return verifyCalledTaxiOrRideKo({
            expectedPlateNumber: obs.extractedSlots.expectedPlate,
            observedPlateNumber: taxiPlate!,
            vehicleColorKo: obs.extractedSlots.taxiColor || "택시",
            vehicleModelKo: obs.extractedSlots.taxiModel || "승용차",
            doorDistanceMeters: Number(obs.extractedSlots.doorDistM || 2.1),
          }).spokenGuidance;
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "SUBWAY_PLATFORM",
      labelKo: "지하철 승강장 · 빠른 환승(UC-08,23)",
      triggerDescriptionKo:
        "지하철 승강장, 스크린도어 호차-문번호(예: 3-2), 상단 역명판/방면 표지판이 보일 때",
      extractionRulesKo:
        "헤더: `[SUBWAY_PLATFORM | line=2호선, nextStation=교대, door=3-2, transferLine=3호선]` — 스크린도어 번호와 다음 역 방면이 실제로 읽힐 때만 적고, 안 보이면 서너 걸음 다가서서 위쪽 역명판을 비춰 달라고 말하세요.",
      relatedSkillIds: ["SUBWAY_ON_BOARD", "TRANSFER_CORRIDOR", "WALKING_SAFETY"],
      priority: "P1_NAVIGATION",
      earcon: "TRANSIT_ARRIVING",
      executePostProcess: async (obs) => {
        const door = obs.extractedSlots.door;
        const nextStation = obs.extractedSlots.nextStation;
        const line = obs.extractedSlots.line;

        if (isValidObservedSlot(door) && isValidObservedSlot(nextStation)) {
          const live = await transitProvider.fetchSeoulSubwayArrival({
            stationName: nextStation!,
            lineName: isValidObservedSlot(line) ? line! : "2호선",
            directionText: `${nextStation} 방면`,
          });

          return verifySubwayPlatformAndTransferKo({
            lineName: isValidObservedSlot(line) ? line! : "지하철",
            intendedDirectionStation: nextStation!,
            observedNextStationOnSign: nextStation!,
            observedScreenDoorCode: door!,
            arrivalMinutes: live.arrivalMinutes,
            transferOption: {
              transferStationName: `${nextStation!.replace(/역$/, "")}역`,
              targetLineName: isValidObservedSlot(obs.extractedSlots.transferLine)
                ? obs.extractedSlots.transferLine!
                : "환승 노선",
              bestScreenDoorCode: "5-3",
              facilityType: "빠른 환승 계단",
              higherCarNumberDirectionWhenFacingTrack: "RIGHT",
            },
          }).spokenGuidance;
        }

        if (/None|알수없음|알 수 없음/i.test(obs.draftSpokenKorean)) {
          return "지하철 승강장이지만 현재 위치에서는 행선지 표지판이나 스크린도어 번호 글자가 선명하게 보이지 않습니다. 진행 방향 정면 스크린도어 쪽으로 3~4걸음 다가선 뒤 유리문 상단 표지판을 바라봐 주세요.";
        }

        return obs.draftSpokenKorean;
      },
    },
    {
      id: "SUBWAY_ON_BOARD",
      labelKo: "지하철 탑승 중 · 정거장/하차문 안내(UC-08,23)",
      triggerDescriptionKo:
        "지하철 객차 내부(출입문 유리창, 손잡이, 노선도, 객차 내 전광판)가 보일 때",
      extractionRulesKo:
        "헤더: `[SUBWAY_ON_BOARD | currentStation=건대입구]` — 객차 안에서는 출입문 옆 손잡이를 잡고 서 있게 안내하고, 현재 역·목적지까지 남은 정거장 수·내릴 문 방향(오른쪽/왼쪽)을 알려주세요.",
      relatedSkillIds: ["SUBWAY_PLATFORM", "TRANSFER_CORRIDOR"],
      priority: "P1_NAVIGATION",
      earcon: "SCANNING_TICK",
    },
    {
      id: "TRANSFER_CORRIDOR",
      labelKo: "지하철 환승 · 출구 통로 내비(UC-09,23)",
      triggerDescriptionKo:
        "지하철 환승 유도 표지판, 출구 번호 표지판(예: 1번 출구), 개찰구, 점자블록 갈림길이 보일 때",
      extractionRulesKo:
        "헤더: `[TRANSFER_CORRIDOR | targetLine=5호선, exit=1번출구]` — 환승 유도선이나 목표 출구 번호 방향과 점자블록/계단 위치를 연속으로 안내하세요.",
      relatedSkillIds: ["SUBWAY_PLATFORM", "RESTROOM_AND_SEAT", "WALKING_SAFETY"],
      priority: "P1_NAVIGATION",
      earcon: "TARGET_FOUND",
    },
    {
      id: "RESTROOM_AND_SEAT",
      labelKo: "공공화장실 성별/빈칸 · 카페 빈 좌석(UC-12,21)",
      triggerDescriptionKo:
        "공공화장실 남/녀 픽토그램 및 빈 칸(초록/빨강 표시)·세면대(UC-21), 또는 카페/식당의 빈 좌석과 바닥 가방 장애물(UC-12)이 보일 때",
      extractionRulesKo:
        "헤더: `[RESTROOM_AND_SEAT | gender=남자화장실, direction=왼쪽, vacantStall=2, sink=오른쪽]` — 화장실 성별 입구와 빈 칸 번호·세면대 위치, 또는 카페 빈 좌석까지 걸음 수와 바닥 장애물을 안내하세요.",
      relatedSkillIds: ["TRANSFER_CORRIDOR", "INDOOR_SPACE"],
      priority: "P1_NAVIGATION",
      earcon: "TARGET_FOUND",
      executePostProcess: async (obs) => {
        const gender = obs.extractedSlots.gender as any;
        if (isValidObservedSlot(gender)) {
          return smartReader.describeRestroomAndStallKo({
            entranceGenderKo: gender,
            entranceDirectionKo: obs.extractedSlots.direction || "정면",
            availableStallOrder: obs.extractedSlots.vacantStall
              ? Number(obs.extractedSlots.vacantStall)
              : undefined,
            sinkLocationKo: obs.extractedSlots.sink,
          });
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "KIOSK_COACH",
      labelKo: "무인 키오스크 · 엘리베이터 1층 손끝 코칭(UC-10)",
      triggerDescriptionKo:
        "무인 키오스크 화면이나 엘리베이터 층수 버튼 패널(LUM-47)과 사용자의 손가락이 보일 때",
      extractionRulesKo:
        "헤더: `[KIOSK_COACH | target=1층버튼또는아메리카노, dxCm=3, dyCm=-2, floorLit=false]` — 엘리베이터는 1층 버튼 점등 여부를 먼저 확인하고, 현재 손가락에서 목표 버튼까지 가로(dxCm)/세로(dyCm) 몇 cm 이동할지 추출하세요.",
      relatedSkillIds: ["INDOOR_SPACE", "APPLIANCE_SAFETY"],
      priority: "P1_NAVIGATION",
      earcon: "TARGET_FOUND",
      executePostProcess: async (obs) => {
        const target = obs.extractedSlots.target;
        const dx = Number(obs.extractedSlots.dxCm);
        const dy = Number(obs.extractedSlots.dyCm);
        if (
          isValidObservedSlot(target) &&
          !Number.isNaN(dx) &&
          !Number.isNaN(dy)
        ) {
          return coachFingertipToButtonKo({
            targetLabel: target!,
            deltaXcm: dx,
            deltaYcm: dy,
          });
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "APPLIANCE_SAFETY",
      labelKo: "평면 인덕션 잔열(H) · 정수기 · 가전 판독(UC-11,20)",
      triggerDescriptionKo:
        "주방 평면 인덕션 화구 켜짐/잔열 H 표시(UC-20), 평면 터치 정수기 온수/냉수 버튼(UC-11), 세탁기/전자레인지 LED 창이 보일 때",
      extractionRulesKo:
        "헤더: `[APPLIANCE_SAFETY | appliance=인덕션, zone=오른쪽아래, power=7단계, residualHeat=true]` — 인덕션 화구 가열 단계와 잔열(H) 화상 위험, 정수기 온수 위치, 가전 남은 시간을 정확히 판독하세요.",
      relatedSkillIds: ["KIOSK_COACH", "INDOOR_SPACE"],
      priority: "P0_SAFETY",
      earcon: "HAZARD_ALERT",
      executePostProcess: async (obs) => {
        if (
          obs.extractedSlots.appliance === "인덕션" ||
          obs.extractedSlots.residualHeat === "true"
        ) {
          return smartReader.summarizeAppliancePanelKo({
            applianceType: "인덕션",
            activeCourseOrZone: obs.extractedSlots.zone || "화구",
            powerLevelOrTemp: obs.extractedSlots.power || "가열 중",
            hasResidualHeatWarning: obs.extractedSlots.residualHeat === "true",
          });
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "SMART_READER",
      labelKo: "약봉지/안약 · 소비기한 D-Day · 고지서 요약(UC-01,02,13)",
      triggerDescriptionKo:
        "약봉지/안약(UC-01), 냉장고 식품 소비기한(UC-02), 관리비 고지서/택배 송장(UC-13)이 가까이 보일 때",
      extractionRulesKo:
        "헤더: `[SMART_READER | docType=소비기한, product=우유, expiryDate=2026-11-18]` — 약봉지는 복용 시점/효능을, 식품은 소비기한 날짜(YYYY-MM-DD)를, 고지서/택배는 핵심 3요소만 요약하세요.",
      relatedSkillIds: ["GROCERY_SCANNER", "INDOOR_SPACE"],
      priority: "P2_COMPANION",
      earcon: "SCANNING_TICK",
      executePostProcess: async (obs) => {
        const expiryDate = obs.extractedSlots.expiryDate;
        const product = obs.extractedSlots.product;
        if (
          isValidObservedSlot(expiryDate) &&
          /^\d{4}-\d{2}-\d{2}$/.test(expiryDate!) &&
          isValidObservedSlot(product)
        ) {
          const todayIso = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
          return smartReader.summarizeFoodExpiry({
            productName: product!,
            expiryDateIso: expiryDate!,
            referenceTodayIso: todayIso,
          }).spokenKorean;
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "GROCERY_SCANNER",
      labelKo: "마트/편의점 유사 용기 맛 · 제로 · 1+1 행사 리더(UC-16)",
      triggerDescriptionKo:
        "편의점이나 마트에서 캔/페트병/라면/통조림 상품이나 진열대 가격표·1+1 행사 라벨을 볼 때",
      extractionRulesKo:
        "헤더: `[GROCERY_SCANNER | product=코카콜라, flavor=레몬향500ml, zeroSugar=true, price=2000, promo=1+1]` — 정확한 상품명, 맛, 제로슈거 여부, 가격, 1+1/2+1 행사 여부를 추출하세요.",
      relatedSkillIds: ["SMART_READER", "KIOSK_COACH"],
      priority: "P2_COMPANION",
      earcon: "TARGET_FOUND",
      executePostProcess: async (obs) => {
        const product = obs.extractedSlots.product;
        if (isValidObservedSlot(product)) {
          return smartReader.summarizeGroceryProductKo({
            productName: product!,
            variantOrFlavor: obs.extractedSlots.flavor || "",
            isZeroSugar: obs.extractedSlots.zeroSugar === "true",
            priceWon: Number(obs.extractedSlots.price || 2000),
            promotionBadge: (obs.extractedSlots.promo as any) || "일반",
          });
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "DINING_ASSISTANT",
      labelKo: "식사 접시/식판 반찬 배치 · 생선 가시 · 남은 양(UC-17)",
      triggerDescriptionKo:
        "식탁 위 밥그릇, 국, 식판, 접시 위 반찬이나 음식이 보일 때",
      extractionRulesKo:
        "헤더: `[DINING_ASSISTANT | frontLeft=흰쌀밥, frontRight=된장국, topCenter=고등어구이, boneHazard=true]` — 앞쪽 왼쪽/오른쪽, 위쪽 칸 기준 음식 배치와 생선 가시/뼈 주의, 식사 후반 남은 반찬 위치를 안내하세요.",
      relatedSkillIds: ["INDOOR_SPACE", "SMART_READER"],
      priority: "P2_COMPANION",
      earcon: "TARGET_FOUND",
      executePostProcess: async (obs) => {
        const fl = obs.extractedSlots.frontLeft;
        const tc = obs.extractedSlots.topCenter;
        if (isValidObservedSlot(fl) || isValidObservedSlot(tc)) {
          const items: any[] = [];
          if (isValidObservedSlot(fl)) {
            items.push({ positionKo: "앞쪽 왼쪽", foodName: fl! });
          }
          if (isValidObservedSlot(obs.extractedSlots.frontRight)) {
            items.push({
              positionKo: "앞쪽 오른쪽",
              foodName: obs.extractedSlots.frontRight!,
            });
          }
          if (isValidObservedSlot(tc)) {
            items.push({
              positionKo: "위쪽 가운데",
              foodName: tc!,
              hasBoneOrThorns: obs.extractedSlots.boneHazard === "true",
            });
          }
          return smartReader.describeDiningPlateLayoutKo(items);
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "INDOOR_SPACE",
      labelKo: "실내 동선 · 집안 물건 위치 기억/찾기 · 복장 점검(UC-03)",
      triggerDescriptionKo:
        "집안 생활 물건(에어팟, 안경, 열쇠, 지갑) 위치 기억/찾기 및 외출 복장 얼룩 점검(UC-03), 또는 실내 출입문 탐색 시",
      extractionRulesKo:
        "헤더: `[INDOOR_SPACE | rememberedItem=에어팟, itemLocation=소파 오른쪽 쿠션 옆, recallItem=에어팟]` — 생활 물건이 보이면 위치를 기록하고, 정면에 창문/책상이 막혀 있으면 뒤로 돌아 방문을 찾게 안내하세요.",
      relatedSkillIds: ["SMART_READER", "APPLIANCE_SAFETY", "WALKING_SAFETY"],
      priority: "P2_COMPANION",
      earcon: "TARGET_FOUND",
      executePostProcess: async (obs) => {
        const remItem = obs.extractedSlots.rememberedItem;
        const remLoc = obs.extractedSlots.itemLocation;
        if (isValidObservedSlot(remItem) && isValidObservedSlot(remLoc)) {
          runtimeVisualMemory.set(remItem!, remLoc!);
        }
        const recallItem = obs.extractedSlots.recallItem;
        if (
          isValidObservedSlot(recallItem) &&
          runtimeVisualMemory.has(recallItem!)
        ) {
          return `기억해 둔 위치가 있어요! ${recallItem}은 최근에 ${runtimeVisualMemory.get(recallItem!)}에서 보였어요.`;
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "SOCIAL_MEETING",
      labelKo: "상대방 명함/악수 제스처 · 회의 슬라이드 요약(UC-22)",
      triggerDescriptionKo:
        "대화 상대방이 명함/악수/물건을 건네며 손을 내밀거나 회의실 프로젝터/모니터 발표 슬라이드가 보일 때",
      extractionRulesKo:
        "헤더: `[SOCIAL_MEETING | cueType=HANDING_OBJECT또는PRESENTATION_SLIDE, title=미팅상대방또는슬라이드제목, detail=오른손으로 명함을 건네고]` — 상대방의 손짓 위치나 발표 슬라이드 핵심을 1~2문장으로 코칭하세요.",
      relatedSkillIds: ["INDOOR_SPACE", "SMART_READER"],
      priority: "P2_COMPANION",
      earcon: "TARGET_FOUND",
      executePostProcess: async (obs) => {
        const cueType = obs.extractedSlots.cueType as any;
        const title = obs.extractedSlots.title;
        const detail = obs.extractedSlots.detail;
        if (
          isValidObservedSlot(cueType) &&
          isValidObservedSlot(title) &&
          isValidObservedSlot(detail)
        ) {
          return smartReader.coachSocialAndMeetingCueKo({
            cueType,
            personOrSlideTitle: title!,
            detailOrActionKo: detail!,
          });
        }
        return obs.draftSpokenKorean;
      },
    },
  ];
}
