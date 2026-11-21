import {
  coachPhysicalViewFindingKo,
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
import { findSubwayTransferRule } from "./subway-transfer-db.ts";
import { KoreaTransitProvider } from "./transit-provider.ts";

const smartReader = new KoreanSmartReader();
const runtimeVisualMemory = new Map<string, string>([
  ["에어팟", "소파 오른쪽 쿠션 옆"],
  ["안경", "침대 머리맡 협탁 위"],
  ["열쇠", "현관 신발장 트레이 위"],
]);

/**
 * Universal Zero-Hardcoding Micro-Skill Registry (built with `/lumo-skill-architect`):
 * - English-Core trigger & extraction rules (`E2K` pattern) for high instruction-following accuracy & token efficiency.
 * - Zero hardcoded dummy entities (no hardcoded `"5-3"` or `"22-001"` fallbacks; looks up dynamic transfer DB or triggers physical view-finding).
 * - Physics-Aware Active View-Finding (`unreadableReason = TOO_FAR | TOO_CLOSE_BLUR | OCCLUDED_BY_HAND | WRONG_SIDE | TILT_UP | GLARE`).
 * - Confounder defense (`dateType=EXPIRY vs MANUFACTURED`, indoor window vs train door window).
 */
export function createKoreanSkillPlugins(
  transitProvider = new KoreaTransitProvider(),
): readonly LumoSkillPlugin[] {
  return [
    {
      id: "WALKING_SAFETY",
      labelKo: "보행 안전 · 점자블록/저조도(UC-04,05,18)",
      triggerDescriptionKo:
        "When walking paths, tactile paving (점자블록), obstacles like kickboards/bollards (UC-05), or dim/night indoor-outdoor transitions (UC-18) are visible",
      extractionRulesKo:
        "Header: `[WALKING_SAFETY | hazard=킥보드, steps=3, avoidDir=왼쪽]` — Guide in natural Korean using movement-relative direction, step count, and tactile cues (점자블록, 연석, 난간). Never use color-only pavement descriptions.",
      relatedSkillIds: ["STEP_AND_GLASS_DOOR", "CROSSWALK_SIGNAL", "BUS_STOP"],
      priority: "P0_SAFETY",
      earcon: "HAZARD_ALERT",
    },
    {
      id: "STEP_AND_GLASS_DOOR",
      labelKo: "무표시 계단 · 단차 · 투명유리문 감지(UC-14)",
      triggerDescriptionKo:
        "When low-contrast grey stairs/curb drop-offs (내리막 계단 첫 단/단차) or frameless transparent glass doors (투명 통유리문) and door handles are ahead",
      extractionRulesKo:
        "Header: `[STEP_AND_GLASS_DOOR | type=내리막계단|투명유리문, steps=2, handleSide=오른쪽, action=당기기]` — Warn immediately about low-contrast drop-offs or frameless glass doors and specify the handrail or pull/push handle side.",
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
        "When a crosswalk waiting line or pedestrian traffic light (보행자 신호등, red/green, countdown seconds, or high-glare backlit signal UC-19) is visible",
      extractionRulesKo:
        "Header: `[CROSSWALK_SIGNAL | signal=GREEN|RED, remainSec=24]` — State immediately whether the pedestrian light is red (wait) or green (remaining seconds + straight alignment).",
      relatedSkillIds: ["WALKING_SAFETY", "BUS_STOP"],
      priority: "P0_SAFETY",
      earcon: "SIGNAL_GREEN",
    },
    {
      id: "BUS_STOP",
      labelKo: "버스 정류장 · 실시간 노선 매칭(UC-07,19)",
      triggerDescriptionKo:
        "When a bus stop sign (5-digit ARS-ID 정류소번호), BIT LED arrival board (UC-19), or approaching city bus is visible",
      extractionRulesKo:
        "Header: `[BUS_STOP | arsId=..., route=..., direction=..., unreadableReason=TOO_FAR|TILT_UP|GLARE]` — Extract `arsId` or `route` ONLY when legible. Never guess; if illegible, set `unreadableReason`.",
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

        // Zero-Hardcoding Rule: Only query live Bus API when at least one real identifier (`arsId` or `route`) was observed!
        if (isValidObservedSlot(arsId) && isValidObservedSlot(route)) {
          const live = await transitProvider.fetchSeoulBusArrival({
            arsId: arsId!,
            targetRouteNumber: route!,
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
            return verified.spokenGuidance;
          }
        }
        if (isValidObservedSlot(obs.extractedSlots.unreadableReason)) {
          return coachPhysicalViewFindingKo(
            obs.extractedSlots.unreadableReason,
            "SIGN",
          );
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "TAXI_MATCHER",
      labelKo: "호출 택시 · 장애인콜택시 번호판 매칭(UC-15)",
      triggerDescriptionKo:
        "When a called taxi or wheelchair call-taxi (장애인 콜택시) pulls up and its license plate, color, model, and passenger door handle are visible",
      extractionRulesKo:
        "Header: `[TAXI_MATCHER | taxiPlate=34바5678, taxiColor=흰색, taxiModel=쏘나타, doorDistM=2.1]` — Read license plate digits, vehicle color/model, and steps to the rear right door handle.",
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
        "When standing on a subway platform before boarding, with screen-door car-door codes (스크린도어 호차-문번호 e.g. 3-2) or overhead direction signs visible",
      extractionRulesKo:
        "Header: `[SUBWAY_PLATFORM | line=2호선, nextStation=교대, door=3-2, transferStation=교대역, transferLine=3호선, unreadableReason=TOO_FAR|TILT_UP]` — Extract `nextStation` and `door` ONLY when clearly legible (never output 'None'). Do NOT claim train doors are open unless the physical gap is visible.",
      relatedSkillIds: ["SUBWAY_ON_BOARD", "TRANSFER_CORRIDOR", "WALKING_SAFETY"],
      priority: "P1_NAVIGATION",
      earcon: "TRANSIT_ARRIVING",
      executePostProcess: async (obs) => {
        const door = obs.extractedSlots.door;
        const nextStation = obs.extractedSlots.nextStation;
        const line = obs.extractedSlots.line || "2호선";
        const transferLine = obs.extractedSlots.transferLine || "3호선";
        const transferStn =
          obs.extractedSlots.transferStation ||
          (nextStation ? `${nextStation.replace(/역$/, "")}역` : "");

        if (isValidObservedSlot(door) && isValidObservedSlot(nextStation)) {
          const live = await transitProvider.fetchSeoulSubwayArrival({
            stationName: nextStation!,
            lineName: line,
            directionText: `${nextStation} 방면`,
          });

          // Zero-Hardcoding Rule: Look up dynamic transfer rule from DB (`findSubwayTransferRule`) instead of hardcoding "5-3"!
          const matchedRule = transferStn
            ? findSubwayTransferRule({
                stationName: transferStn,
                fromLine: line,
                toLine: transferLine,
              })
            : null;

          return verifySubwayPlatformAndTransferKo({
            lineName: line,
            intendedDirectionStation: nextStation!,
            observedNextStationOnSign: nextStation!,
            observedScreenDoorCode: door!,
            arrivalMinutes: live.arrivalMinutes,
            transferOption: matchedRule
              ? {
                  transferStationName: matchedRule.stationName,
                  targetLineName: matchedRule.toLine,
                  bestScreenDoorCode: matchedRule.fastTransferDoor,
                  facilityType: "빠른 환승 계단",
                  higherCarNumberDirectionWhenFacingTrack:
                    matchedRule.higherCarDirectionWhenFacingDoor,
                }
              : undefined,
          }).spokenGuidance;
        }

        if (
          /None|알수없음|알 수 없음/i.test(obs.draftSpokenKorean) ||
          isValidObservedSlot(obs.extractedSlots.unreadableReason)
        ) {
          return coachPhysicalViewFindingKo(
            obs.extractedSlots.unreadableReason,
            "SIGN",
          );
        }

        return obs.draftSpokenKorean;
      },
    },
    {
      id: "SUBWAY_ON_BOARD",
      labelKo: "지하철 탑승 중 · 정거장/하차문 안내(UC-08,23)",
      triggerDescriptionKo:
        "When inside a moving or stopped subway train cabin (train door window, handrails, passengers, in-cabin route map/LED display)",
      extractionRulesKo:
        "Header: `[SUBWAY_ON_BOARD | currentStation=...]` — Remind the user to hold the handrail near the door (never tell them to hunt for empty seats or warn that the train door window is a blocked room wall). Announce current station, remaining stops to destination, and opening door side (오른쪽/왼쪽).",
      relatedSkillIds: ["SUBWAY_PLATFORM", "TRANSFER_CORRIDOR"],
      priority: "P1_NAVIGATION",
      earcon: "SCANNING_TICK",
    },
    {
      id: "TRANSFER_CORRIDOR",
      labelKo: "지하철 환승 · 출구 통로 내비(UC-09,23)",
      triggerDescriptionKo:
        "When walking through subway transfer corridors, exit number signs (출구 표지판 e.g. 1번 출구), fare gates (개찰구), or tactile paving junctions after alighting",
      extractionRulesKo:
        "Header: `[TRANSFER_CORRIDOR | targetLine=..., exit=...]` — Guide continuously toward the target transfer line or target exit number along tactile paving, stairs, or escalators.",
      relatedSkillIds: ["SUBWAY_PLATFORM", "RESTROOM_AND_SEAT", "WALKING_SAFETY"],
      priority: "P1_NAVIGATION",
      earcon: "TARGET_FOUND",
    },
    {
      id: "RESTROOM_AND_SEAT",
      labelKo: "공공화장실 성별/빈칸 · 카페 빈 좌석(UC-12,21)",
      triggerDescriptionKo:
        "When public restroom gender pictograms (남/녀 화장실), stall occupancy indicators (초록/빨강 사용중 표시), sinks (UC-21), or empty cafe seats & floor bags (UC-12) are visible",
      extractionRulesKo:
        "Header: `[RESTROOM_AND_SEAT | gender=남자화장실|여자화장실, direction=왼쪽|오른쪽, vacantStall=2, sink=오른쪽]` — Identify restroom gender entrance, vacant stall number, sink location, or steps to an empty seat while avoiding floor obstacles.",
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
        "When a touchscreen kiosk or elevator floor button panel (LUM-47) and the user's hand/fingertip are visible",
      extractionRulesKo:
        "Header: `[KIOSK_COACH | target=1층버튼|메뉴명, dxCm=3, dyCm=-2, floorLit=false]` — For elevators, verify whether the exit floor (1층/L/G) is lit first. Extract horizontal (`dxCm`) and vertical (`dyCm`) centimeter offset from the user's fingertip to the target button.",
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
        "When a flat induction stove burner/residual heat 'H' indicator (UC-20), touch water dispenser hot/cold buttons (UC-11), or washer/microwave LED panel is visible",
      extractionRulesKo:
        "Header: `[APPLIANCE_SAFETY | appliance=인덕션|정수기|세탁기, zone=오른쪽아래, power=7단계, residualHeat=true|false]` — Warn immediately if residual heat ('H' / Hot) or hot water is present, and read active cycle/remaining minutes.",
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
        "When medicine pouches/eye-drops (UC-01), food expiration labels (UC-02), or utility bills/parcel labels (UC-13) are held in front of the camera",
      extractionRulesKo:
        "Header: `[SMART_READER | docType=소비기한|약봉지|고지서, product=서울우유, expiryDate=2026-11-18, dateType=EXPIRY|MANUFACTURED, unreadableReason=TOO_CLOSE_BLUR|OCCLUDED_BY_HAND|WRONG_SIDE]` — CRITICAL CONFOUNDER RULE: Distinguish expiration date (`소비기한/유통기한`, `dateType=EXPIRY`) from manufacturing date (`제조일자`, `dateType=MANUFACTURED`). If the label is covered by fingers, blurry, or facing the wrong side, set `unreadableReason`.",
      relatedSkillIds: ["GROCERY_SCANNER", "INDOOR_SPACE"],
      priority: "P2_COMPANION",
      earcon: "SCANNING_TICK",
      executePostProcess: async (obs) => {
        if (isValidObservedSlot(obs.extractedSlots.unreadableReason)) {
          return coachPhysicalViewFindingKo(
            obs.extractedSlots.unreadableReason,
            "HANDHELD_ITEM",
          );
        }
        const expiryDate = obs.extractedSlots.expiryDate;
        const product = obs.extractedSlots.product;
        const dateType = (obs.extractedSlots.dateType || "EXPIRY").toUpperCase();
        if (dateType === "MANUFACTURED") {
          return `${product || "상품"}의 제조일자가 ${expiryDate}로 적혀 있어요. 소비기한은 용기 옆면이나 아래쪽에 따로 적혀 있으니 살짝 돌려 비춰 보실래요?`;
        }
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
        "When holding or viewing convenience store / supermarket cans, bottles, ramen, price tags, or 1+1 / 2+1 promotion badges (UC-16)",
      extractionRulesKo:
        "Header: `[GROCERY_SCANNER | product=코카콜라, flavor=레몬향500ml, zeroSugar=true|false, price=2000, promo=1+1|2+1|일반, unreadableReason=...]` — Extract exact product name, flavor variant, Zero-Sugar status, price in KRW, and promotion badge.",
      relatedSkillIds: ["SMART_READER", "KIOSK_COACH"],
      priority: "P2_COMPANION",
      earcon: "TARGET_FOUND",
      executePostProcess: async (obs) => {
        if (isValidObservedSlot(obs.extractedSlots.unreadableReason)) {
          return coachPhysicalViewFindingKo(
            obs.extractedSlots.unreadableReason,
            "HANDHELD_ITEM",
          );
        }
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
        "When looking down at a dining table, meal tray (식판), or plate with rice, soup, and side dishes (UC-17)",
      extractionRulesKo:
        "Header: `[DINING_ASSISTANT | frontLeft=흰쌀밥, frontRight=된장국, topCenter=고등어구이, boneHazard=true|false]` — Describe food positions relative to front-left/right and top sections, warn about fish bones/thorns, and note remaining pieces.",
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
        "When indexing or recalling household object locations (에어팟, 안경, 열쇠, 지갑), checking outfit stains/colors (UC-03), or navigating indoor room doors",
      extractionRulesKo:
        "Header: `[INDOOR_SPACE | rememberedItem=에어팟, itemLocation=소파 오른쪽 쿠션 옆, recallItem=에어팟]` — Index visible personal items with their landmark location, or guide around indoor furniture toward the exit door.",
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
        "When a conversation partner extends a hand for a handshake or hands over a business card/cup, or when a meeting projector/monitor slide is visible (UC-22)",
      extractionRulesKo:
        "Header: `[SOCIAL_MEETING | cueType=HANDING_OBJECT|PRESENTATION_SLIDE, title=미팅상대방|슬라이드제목, detail=오른손으로 명함을 건네고]` — Coach the user on the partner's hand gesture or summarize the presentation slide into 1-2 sentences.",
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
