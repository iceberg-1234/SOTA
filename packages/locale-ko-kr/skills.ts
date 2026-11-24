import {
  coachPhysicalViewFindingKo,
  isValidObservedSlot,
  type SotaSkillPlugin,
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
 * Universal 2-Tier Micro-Skill Registry (built with `/sota-skill-architect`):
 * - Tier 1: 1-line `triggerDescriptionKo` for zero-lag scene switching across all 16 skills.
 * - Tier 2: Rich 4-part `expertPlaybook` (Visual Scan Order, Real-Life Value Formula, Confounder Guards, Physical Aiming Guide)
 *   injected ONLY for active Context-Gated skills to deliver authentic O&M and Independent Living Skills (ILS) value.
 */
export function createKoreanSkillPlugins(
  transitProvider = new KoreaTransitProvider(),
): readonly SotaSkillPlugin[] {
  return [
    {
      id: "WALKING_SAFETY",
      labelKo: "보행 안전 · 점자블록/저조도(UC-04,05,18)",
      triggerDescriptionKo:
        "Outdoor sidewalks, tactile paving (점자블록), obstacles (kickboards/motorcycles/bollards UC-05), or dim/night transitions (UC-18)",
      extractionRulesKo:
        "`[WALKING_SAFETY | hazard=킥보드, steps=3, avoidDir=왼쪽, shoreline=점자블록]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Image-LEFT vs Image-RIGHT strictly from pixels (e.g. fence/building on left vs street trees/curb/roadway on right — SOT-172)",
          "2. Roadway/curb edge (`가로수/연석/차도`) vs safe inner sidewalk (`건물/울타리 쪽 보도`)",
          "3. Subway station entrance pole-sign, stairs, or elevator when within 75m of boarding station (SOT-168, 170)",
        ],
        realLifeValueFormula:
          "NEVER say repetitive '4~5걸음 더 걸어가볼까요?' on open sidewalks! State [Remaining meters/minutes to station or turn] + [Safe inner building/fence shoreline] OR [Obstacle avoidance AWAY from roadway curb]",
        confounderAndSafetyGuards: [
          "CRITICAL ROADWAY SAFETY (SOT-173, 174): NEVER tell the user to dodge toward the roadway/curb/street-tree side (`차도 쪽 회피 절대 금지`)! Always guide toward the safe inner building/fence side or ask them to pause briefly",
          "NEVER classify indoor items, vending machines, water dispensers, or food tubs as WALKING_SAFETY",
        ],
        physicalAimingGuide:
          "Keep head level facing your walking direction; sweep cane slightly wider when tactile blocks break.",
      },
      relatedSkillIds: ["STEP_AND_GLASS_DOOR", "CROSSWALK_SIGNAL", "BUS_STOP"],
      priority: "P0_SAFETY",
      earcon: "HAZARD_ALERT",
    },
    {
      id: "STEP_AND_GLASS_DOOR",
      labelKo: "무표시 계단 · 단차 · 투명유리문 감지(UC-14)",
      triggerDescriptionKo:
        "Low-contrast grey stairs/curb drop-offs (내리막 계단 첫 단/단차) or frameless glass doors & door handles/auto-buttons (UC-14)",
      extractionRulesKo:
        "`[STEP_AND_GLASS_DOOR | type=내리막계단|투명유리문, steps=2, handleSide=오른쪽, action=당기기|밀기|자동문버튼]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Horizontal edge lines indicating downward step-offs or uncolored grey stairs",
          "2. Glass door reflections, frame edges, push/pull stickers (밀기/당기기), lever/bar handle, or automatic door press pad",
          "3. Handrail presence on left or right wall",
        ],
        realLifeValueFormula:
          "[Drop-off or closed/open door state + steps ahead] -> [Exact operation: Pull/Push handle side OR auto-door button height on pillar, or handrail side]",
        confounderAndSafetyGuards: [
          "Never tell the user to walk through a door unless it is visibly open; if closed, specify Push, Pull, Sliding, or Auto-Door Button location",
          "Prioritize downward stairs (fall hazard) over upward stairs",
        ],
        physicalAimingGuide:
          "Pause one step back, tap the bottom edge or threshold with your cane tip, and reach chest-high on the indicated side for the handle or auto button.",
      },
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
        "Crosswalk waiting line, pedestrian traffic light (보행자 신호등), countdown timer, or backlit intersection (UC-06,19)",
      extractionRulesKo:
        "`[CROSSWALK_SIGNAL | signal=GREEN|RED|BLINKING, remainSec=24]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Pedestrian signal state across the street (Red, solid Green, or blinking Green + countdown seconds)",
          "2. Crosswalk zebra-stripe alignment relative to user's body",
          "3. Right-turning vehicles approaching the crosswalk",
        ],
        realLifeValueFormula:
          "[Clear Go vs Wait verdict: if blinking or <10s left, advise waiting for the next cycle] + [Straight/angle alignment + right-turn car check]",
        confounderAndSafetyGuards: [
          "Never rely on color words alone; explicitly state '건너셔도 돼요(남은 24초)' vs '잠시 기다리세요(적색 또는 잔여 시간 부족)'",
          "Do NOT read distant side-road vehicle lights as the pedestrian signal",
        ],
        physicalAimingGuide:
          "Stand on the tactile bumps at the curb edge and face straight across the street so the far pedestrian light enters the upper-center frame.",
      },
      relatedSkillIds: ["WALKING_SAFETY", "BUS_STOP"],
      priority: "P0_SAFETY",
      earcon: "SIGNAL_GREEN",
      executePostProcess: async (obs) => {
        const sig = (obs.extractedSlots.signal || "").toUpperCase();
        const secRaw =
          obs.extractedSlots.remainSec ||
          /(\d+)\s*초/.exec(obs.draftSpokenKorean)?.[1];
        const sec = secRaw ? Number(secRaw) : undefined;
        if (sig === "BLINKING" || (sig === "GREEN" && sec !== undefined && sec >= 1 && sec <= 9)) {
          const secNote =
            sec !== undefined
              ? `남은 시간이 ${sec}초로 짧아 `
              : "초록불이 깜빡이고 있어 ";
          return `잠시 기다리세요! ${secNote}지금 건너기 시작하면 중간에 신호가 바뀌어 위험해요. 다음 초록불에 안전하게 건너세요.`;
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "BUS_STOP",
      labelKo: "버스 정류장 · 실시간 노선 매칭(UC-07,19)",
      triggerDescriptionKo:
        "Bus stop sign (5-digit ARS-ID), BIT arrival LED board (UC-19), or approaching/queued city buses (UC-07)",
      extractionRulesKo:
        "`[BUS_STOP | arsId=..., route=..., queueOrder=1|2, direction=..., unreadableReason=TOO_FAR|TILT_UP|GLARE]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Bus stop 5-digit ARS-ID and next-stop direction arrow to prevent boarding opposite direction",
          "2. Multiple buses queued at the curb (1st front bus number vs 2nd trailing bus number)",
          "3. Front boarding door open state and step distance along the curb",
        ],
        realLifeValueFormula:
          "[Stop direction verification] + [Exact queue order of target bus (1st vs 2nd bus)] + [Steps to the open front door]",
        confounderAndSafetyGuards: [
          "Never invent a bus number or ARS-ID if blurred by LED glare",
          "When two buses pull up together, clearly distinguish the 1st bus from the 2nd bus so the user does not miss their bus",
        ],
        physicalAimingGuide:
          "Turn slightly right toward approaching traffic to read the windshield/side route number, or step 2 paces closer to the bus stop pole.",
      },
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
                  order: Number(obs.extractedSlots.queueOrder || 1),
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
        "Called taxi or wheelchair call-taxi (장애인 콜택시) pulling up to verify license plate, model, and rear door handle (UC-15)",
      extractionRulesKo:
        "`[TAXI_MATCHER | taxiPlate=34바5678, taxiColor=흰색, taxiModel=쏘나타, doorDistM=2.1]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Front or rear license plate 4-digit number and Korean character",
          "2. Vehicle color, sedan/van type (장애인 콜택시 슬로프/승합 여부), and hazard lights",
          "3. Rear-right passenger door handle position (pull lever vs flush handle) and curb gap",
        ],
        realLifeValueFormula:
          "[Match confirmation vs Wrong-car warning] + [Color & vehicle type] + [Steps to rear-right door handle so user does not have to grope the car body]",
        confounderAndSafetyGuards: [
          "Always allow reading taxi license plates for blind rider safety",
          "Warn if a bicycle or motorcycle is passing between the sidewalk curb and the taxi door",
        ],
        physicalAimingGuide:
          "Stand safely behind the curb line facing the stopped vehicle's front bumper or side door.",
      },
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
        "Subway platform before boarding, screen-door car-door code (e.g. 3-2), or overhead direction sign (UC-08,23)",
      extractionRulesKo:
        "`[SUBWAY_PLATFORM | line=2호선, nextStation=교대, door=3-2, transferStation=교대역, transferLine=3호선, unreadableReason=TOO_FAR|TILT_UP]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Overhead/screen-door next-station arrow to confirm correct train direction (내선/외선, 상행/하행)",
          "2. Screen-door car-door number sticker (e.g. 3-2) at eye level",
          "3. Physical door state (closed glass vs open train gap + alighting passengers)",
        ],
        realLifeValueFormula:
          "[Line & direction match check] + [Current car-door code & fast-transfer walk option] + [Wait safely behind safety line until doors physically open and alighting passengers clear]",
        confounderAndSafetyGuards: [
          "NEVER claim the train has arrived or doors are open based on audio/guesswork unless the open gap into the train is visible",
          "Never output 'None 방면'",
        ],
        physicalAimingGuide:
          "Walk 3 steps toward the screen door along the tactile blocks and tilt your head slightly up toward the top of the glass door.",
      },
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
        "Inside a subway train cabin (train door window, vertical pole/handrail, passengers, in-cabin station LED/map)",
      extractionRulesKo:
        "`[SUBWAY_ON_BOARD | currentStation=...]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. In-cabin LED/LCD station display or platform sign visible through the door window",
          "2. Nearby vertical stanchion pole or door-side handrail",
          "3. Door closed vs opening at the target station",
        ],
        realLifeValueFormula:
          "[Current station & remaining stops to destination] + [Which side door opens at destination (오른쪽/왼쪽)] + [1-stop-before preparation alert ONLY when 1 stop remains]",
        confounderAndSafetyGuards: [
          "Standing right in front of the train door window holding a handrail is the safest standard practice for blind riders — NEVER tell them to look for empty seats or warn that the door window is a blocked wall",
          "NEVER tell the user to alight or walk to a transfer corridor when >=2 stops remain",
        ],
        physicalAimingGuide:
          "Stay comfortably by the door holding the handrail; no camera aiming needed until approaching your stop.",
      },
      relatedSkillIds: ["SUBWAY_PLATFORM", "TRANSFER_CORRIDOR"],
      priority: "P1_NAVIGATION",
      earcon: "SCANNING_TICK",
    },
    {
      id: "TRANSFER_CORRIDOR",
      labelKo: "지하철 환승 · 출구 통로 내비(UC-09,23)",
      triggerDescriptionKo:
        "Subway transfer signs, exit number signs (e.g. 1번 출구), fare gates (개찰구), stairs/elevator, or corridor barriers (UC-09,23)",
      extractionRulesKo:
        "`[TRANSFER_CORRIDOR | targetLine=..., exit=...]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Overhead/wall exit number signs (N번 출구) and color-coded transfer line arrows",
          "2. Fare gate card-tap pad (오른쪽 단말기 태그) and open pass-through gates",
          "3. Temporary barriers/cones blocking half of a staircase (우측통행 제한 차단봉) or elevator option",
        ],
        realLifeValueFormula:
          "[Target exit number or transfer line direction] + [Tactile junction turn + fare gate / handrail side, warning if one side of the stairs is cordoned off]",
        confounderAndSafetyGuards: [
          "Never use color-only light cues ('초록빛 조명'); anchor to left/right turns, tactile blocks, fare gates, and handrail sides",
          "Keep guiding continuously until the user reaches the exact surface exit number",
        ],
        physicalAimingGuide:
          "Pause at tactile dot junctions and look slightly up at the ceiling banner to confirm your exit number.",
      },
      relatedSkillIds: ["SUBWAY_PLATFORM", "RESTROOM_AND_SEAT", "WALKING_SAFETY"],
      priority: "P1_NAVIGATION",
      earcon: "TARGET_FOUND",
    },
    {
      id: "RESTROOM_AND_SEAT",
      labelKo: "공공화장실 성별/빈칸 · 카페 빈 좌석(UC-12,21)",
      triggerDescriptionKo:
        "Public restroom gender pictograms (남/녀 화장실), stall vacant/occupied latch, sink/soap (UC-21), or empty cafe seats & floor bags (UC-12)",
      extractionRulesKo:
        "`[RESTROOM_AND_SEAT | gender=남자화장실|여자화장실, direction=왼쪽|오른쪽, vacantStall=2, sink=오른쪽]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Restroom entrance gender pictogram/text (GENTS/LADIES, 남/녀, 장애인 화장실) when braille is absent",
          "2. Stall door ajar state or green/red occupancy latch + sink, soap dispenser, hand dryer/paper towel",
          "3. In cafes/restaurants: closest unoccupied table/chair and floor bags/cables along the aisle",
        ],
        realLifeValueFormula:
          "[Exact Men's vs Women's entrance side] -> [Which stall number is vacant + sink/soap side] OR [Obstacle-free path & step count to nearest empty seat]",
        confounderAndSafetyGuards: [
          "Never guess gender from ambiguous art icons unless verified; state clearly which door is Men's and which is Women's",
        ],
        physicalAimingGuide:
          "Scan horizontally across the two restroom doors at eye level, or pan slowly across the cafe aisle.",
      },
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
      labelKo: "무인 키오스크 · 공동현관 키패드 · 엘리베이터 코칭(UC-10)",
      triggerDescriptionKo:
        "Touchscreen kiosk, apartment entrance flat touch keypad (공동현관 키패드), or elevator button panel with user's hand (UC-10, LUM-47)",
      extractionRulesKo:
        "`[KIOSK_COACH | target=1층버튼|메뉴명, dxCm=3, dyCm=-2, floorLit=false]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. If VENDING MACHINE (자판기 — SOT-159~162): read actual drink names by shelf row ('맨 위칸 생수·이온음료, 둘째 칸 콜라...') so blind user knows what is inside",
          "2. For vending purchase ('물 찾아줘'): locate right-middle payment card reader, selection button directly beneath the target drink, and bottom pickup slot",
          "3. For kiosks/keypads/elevators: check 1F lit state first and measure fingertip-to-button cm offset (dxCm, dyCm)",
        ],
        realLifeValueFormula:
          "On Vending Machines: NEVER say '꺼내 드릴까요?' (locked behind glass!) — deliver [Shelf row drinks] + [Card reader tap -> Selection button below drink -> Bottom pickup slot]. On Kiosks: [cm offset from finger + card slot].",
        confounderAndSafetyGuards: [
          "NEVER offer to pull out an item from a locked vending machine without guiding payment & button press",
          "On apartment touch keypads, verify exact digit alignment before telling the user to press",
        ],
        physicalAimingGuide:
          "Stand an arm's length from the screen/vending machine and place one finger lightly on the outer bezel or right panel.",
      },
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
      labelKo: "평면 인덕션 잔열(H) · 정수기 온수 · 가전 판독(UC-11,20)",
      triggerDescriptionKo:
        "Flat induction stove burner/residual heat 'H' (UC-20), touch water dispenser hot/cold buttons (UC-11), or washer/microwave/AC LED display",
      extractionRulesKo:
        "`[APPLIANCE_SAFETY | appliance=인덕션|정수기|세탁기, zone=오른쪽아래, power=7단계, residualHeat=true|false]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Burn hazards FIRST: induction active burner ring, 'H'/'Hot' residual heat LED, or red hot-water touch icon (온수 잠금/출수)",
          "2. Active cycle name (표준세탁/해동/데우기) and remaining minutes on digital LED",
          "3. Physical reference anchor (corner of glass cooktop or water dispenser lever) for safe button pressing",
        ],
        realLifeValueFormula:
          "[Immediate P0 burn warning if residual heat 'H' or hot water is active] + [Active burner/course & remaining time] + [Safe cold-water or power button position]",
        confounderAndSafetyGuards: [
          "NEVER tell the user to touch a flat induction glass top to feel where the pot is",
        ],
        physicalAimingGuide:
          "Hold your head 40cm back from the appliance panel to capture the entire LED bar without hand occlusion.",
      },
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
      labelKo: "냉장고/식품 소비기한 · 약봉지/안약 · 고지서 요약(UC-01,02,13)",
      triggerDescriptionKo:
        "Refrigerator shelves, beverage bottles/cartons, side-dish tubs, medicine pouches/eyedrops (UC-01,02), or mail/bills/parcels (UC-13)",
      extractionRulesKo:
        "`[SMART_READER | docType=소비기한|약봉지|고지서, product=..., expiryDate=YYYY-MM-DD, dateType=EXPIRY|MANUFACTURED, unreadableReason=TOO_CLOSE_BLUR|OCCLUDED_BY_HAND|WRONG_SIDE]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Exact item identity: brand/flavor/volume, shampoo vs conditioner/body-wash/cleaner, oral med vs eyedrop, paper currency denomination (verify unfolded digits + portrait!), OR frozen PC/phone screen message (when VoiceOver/NVDA cannot read)",
          "2. Multi-Object Independence: when multiple containers appear in view, read ONLY characters directly legible on each individual label — never infer an adjacent/lower item's name",
          "3. Multi-Date Disambiguation: scan ALL printed date lines from top to bottom! When two dates appear stacked, a date paired with a `HH:mm` timestamp (e.g. `YYYY.MM.DD 11:25`), lot code, or earlier year is the Manufacturing Date (`제조일자`), whereas the LATER date below it (or marked `까지`/`소비기한`) is the true Expiration Date (`expiryDate`)",
        ],
        realLifeValueFormula:
          "NO shallow captioning ('주스 병이 보이네요')! Deliver: [Exact Product/Med Name & Dosage/Flavor] + [Opened/Remaining amount if container] + [Expiry D-Day OR exact part of bottle/box to rotate if date is hidden]",
        confounderAndSafetyGuards: [
          "CRITICAL ZERO-HALLUCINATION FOR DATES (LUM-150, 151): NEVER fabricate or guess an expiration date when the ink-jet stamped date digits are not physically visible in this exact frame! Side nutrition tables (mg/ml/%) are NOT expiration dates — if the date stamp is not visible, emit `expiryDate=NONE, unreadableReason=WRONG_SIDE` and coach rotating the top gable/cap neck",
          "Distinguish eyedrops (점안액) from superglue/external lotion, and distinguish `dateType=EXPIRY` (소비기한) from `dateType=MANUFACTURED` (제조일자)",
          "If mail is an ad flyer, say '광고 전단지예요' in one short sentence",
        ],
        physicalAimingGuide:
          "For PET bottles, slowly rotate the upper bottle neck under the cap; for milk cartons, tilt the top roof seam; for tubs, show the lid or bottom.",
      },
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
        // LUM-153 & LUM-154: Reject impossible Gregorian dates (e.g. non-leap `2026-02-29`!) or unverified date claims in body text
        const isValidRealIsoDate = (iso: string): boolean => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
          if (!m) return false;
          const y = Number(m[1]);
          const mo = Number(m[2]);
          const d = Number(m[3]);
          const dt = new Date(Date.UTC(y, mo - 1, d));
          return (
            dt.getUTCFullYear() === y &&
            dt.getUTCMonth() === mo - 1 &&
            dt.getUTCDate() === d
          );
        };
        const bodyDateMatch = /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(
          obs.draftSpokenKorean,
        );
        const bodyIso = bodyDateMatch
          ? `${bodyDateMatch[1]}-${bodyDateMatch[2].padStart(2, "0")}-${bodyDateMatch[3].padStart(2, "0")}`
          : null;
        if (
          (isValidObservedSlot(expiryDate) && !isValidRealIsoDate(expiryDate!)) ||
          (bodyIso && !isValidRealIsoDate(bodyIso))
        ) {
          const isIceCream = /투게더|아이스크림|빙과/.test(
            `${product ?? ""} ${obs.draftSpokenKorean}`,
          );
          const prodPrefix =
            product && product !== "제품" ? `${product} 제품이지만 ` : "";
          return isIceCream
            ? `${product || "아이스크림"} 제품이에요. 지금 비추신 면에는 날짜가 보이지 않아요. 아이스크림은 주로 뚜껑 테두리나 바닥 면에 제조일자가 찍혀 있으니 용기 아래쪽을 비춰 보실래요?`
            : `${prodPrefix}지금 각도에서는 소비기한 숫자가 선명하게 보이지 않아요. 용기 위쪽이나 옆면을 천천히 돌려 비춰 보실래요?`;
        }
        const dateType = (obs.extractedSlots.dateType || "EXPIRY").toUpperCase();
        if (dateType === "MANUFACTURED") {
          return `${product || "상품"}의 제조일자가 ${expiryDate}로 적혀 있어요. 소비기한은 그 아래 줄이나 용기 다른 면에 따로 적혀 있으니 살짝 돌려 비춰 보실래요?`;
        }
        const resolvedIso =
          isValidObservedSlot(expiryDate) && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate!)
            ? expiryDate!
            : !obs.draftSpokenKorean.includes("제조")
              ? bodyIso
              : null;
        if (resolvedIso) {
          const todayIso = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
          const res = smartReader.summarizeFoodExpiry({
            productName: product || "이 제품",
            expiryDateIso: resolvedIso,
            referenceTodayIso: todayIso,
          });
          if (res.isExpired || isValidObservedSlot(expiryDate)) {
            return res.spokenKorean;
          }
        }
        return obs.draftSpokenKorean;
      },
    },
    {
      id: "GROCERY_SCANNER",
      labelKo: "마트/편의점 유사 용기 맛 · 제로 · 1+1 행사 리더(UC-16)",
      triggerDescriptionKo:
        "Convenience store / mart cans, bottles, cup ramen, shelf price tags, or 1+1 / 2+1 promo badges (UC-16)",
      extractionRulesKo:
        "`[GROCERY_SCANNER | product=코카콜라, flavor=레몬향500ml, zeroSugar=true|false, price=2000, promo=1+1|2+1|일반, unreadableReason=...]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Distinguish look-alike cans/bottles/ramen: Original vs Zero-Sugar, Decaf vs Regular, Mild vs Spicy, Allergen warnings",
          "2. Match the item name directly against the shelf price tag below it (prevent reading the neighboring item's price tag)",
          "3. Check `1+1`, `2+1`, or discount badges; if user holds two items in left & right hands, compare them directly",
        ],
        realLifeValueFormula:
          "[Exact Brand + Flavor + Zero-Sugar/Decaf/Spicy] + [Verified Price] + [1+1 / 2+1 Promo so user knows to grab a free extra item]",
        confounderAndSafetyGuards: [
          "Verify that the shelf price label text matches the product before announcing price or 1+1 promo",
        ],
        physicalAimingGuide:
          "Hold the front label steady at chest height ~25cm away; to check shelf price/promo, include the shelf strip right beneath the item.",
      },
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
      labelKo: "식사 반찬 배치 · 수저/물컵 · 생선 가시/남은 양(UC-17)",
      triggerDescriptionKo:
        "Dining table, meal tray (식판), rice/soup/side dishes, water cup/utensil box, or remaining food check (UC-17)",
      extractionRulesKo:
        "`[DINING_ASSISTANT | frontLeft=흰쌀밥, frontRight=된장국, topCenter=고등어구이, boneHazard=true|false]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Meal layout relative to user's body (앞쪽 왼쪽/오른쪽 밥·국, 위쪽 왼쪽/가운데/오른쪽 반찬), highlighting white-on-white foods (두부, 백김치, 흰살생선)",
          "2. Hazards: fish bones/thorns (가시/뼈), sizzling hot stone pot (뜨거운 뚝배기), or full soup rim",
          "3. Restaurant table essentials: water cup/pitcher, spoon/chopstick case (테이블 위 또는 오른쪽 옆 서랍), napkins, OR remaining pieces late in the meal",
        ],
        realLifeValueFormula:
          "[Body-relative dish layout] + [Bone/hot-pot warning] + [Water cup/utensil location at start of meal OR exact remaining food location mid-meal]",
        confounderAndSafetyGuards: [
          "Never describe tablecloth patterns; focus strictly on edible items, utensils, and hot/bone hazards",
        ],
        physicalAimingGuide:
          "Tilt your head slightly downward (~30 degrees) from seated posture so the whole tray and table edge enter the frame.",
      },
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
      labelKo: "실내 동선 · 물건 위치 기억/찾기 · 복장 점검(UC-03)",
      triggerDescriptionKo:
        "Household personal items (에어팟, 안경, 열쇠, 지갑), outfit stain/color/inside-out check (UC-03), or indoor room furniture/doors",
      extractionRulesKo:
        "`[INDOOR_SPACE | rememberedItem=에어팟, itemLocation=소파 오른쪽 쿠션 옆, recallItem=에어팟]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Small personal items (earbuds, glasses, keys, wallet, remote, cane) anchored to permanent furniture landmarks",
          "2. Outfit check when requested: food/coffee stains on collar/front, color coordination, or inside-out/backwards seam tags",
          "3. Indoor trip hazards (upturned rug corners, floor power cords) and exit door handle direction",
        ],
        realLifeValueFormula:
          "[Item location relative to touchable furniture landmark + reach distance] OR [Clear stain-free confirmation vs exact stain spot] OR [Safe indoor turn away from desk/window toward door]",
        confounderAndSafetyGuards: [
          "When facing a desk, monitor, or room window indoors, tell the user to turn around rather than walking forward",
        ],
        physicalAimingGuide:
          "Scan slowly from one end of the table or sofa to the other while keeping your hands close to the surface so nothing gets knocked over.",
      },
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
        "Partner extending a hand for handshake/business card/cup, or meeting room projector/monitor slide (UC-22)",
      extractionRulesKo:
        "`[SOCIAL_MEETING | cueType=HANDING_OBJECT|PRESENTATION_SLIDE, title=미팅상대방|슬라이드제목, detail=오른손으로 명함을 건네고]`",
      expertPlaybook: {
        visualScanChecklist: [
          "1. Non-verbal social cues: partner extending hand for handshake, business card, document, or beverage cup + height/direction",
          "2. Presentation slide / monitor screen: slide headline + top 1-2 key numbers or conclusions",
          "3. Meeting room door number plaque when entering",
        ],
        realLifeValueFormula:
          "[Concise whisper-style cue: what is being handed over & chest/waist reach height] OR [Slide title + 1-sentence core takeaway without reading raw bullet walls]",
        confounderAndSafetyGuards: [
          "Keep social cues ultra-concise (1 short sentence) so the user can still hear their conversation partner speaking",
        ],
        physicalAimingGuide:
          "Face the speaker or projector screen naturally.",
      },
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
