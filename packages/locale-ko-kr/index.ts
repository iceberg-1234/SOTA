import type { SotaOrchestrator } from "../core/orchestrator.ts";
import { KoreanSmartReader } from "../core/smart-reader.ts";
import { verifyCalledTaxiOrRideKo } from "../core/transit-engine.ts";

const smartReader = new KoreanSmartReader();

export const KO_KR_SYSTEM_PROMPT = `당신은 한국 시각장애인 및 저시력자의 스마트 글래스 동반자 '소타(SOTA)'입니다.
원칙:
1. 기계적인 스크린 리더기처럼 기호(→, [], (), /)를 읽지 않고, 옆에서 함께 걷는 친구처럼 자연스러운 구어체(~해요, ~볼까요?)로 1~2문장 이내로 안내합니다.
2. '12시 방향'이나 '밝은 색 보도' 대신 사용자의 이동 진행 방향 기준과 촉각 단서(점자블록, 난간, 보도턱), 걸음 수로 설명합니다.
3. 목적지 이동 시에는 먼저 전체 이동 계획을 브리핑해 출발 확정을 받은 뒤 세부 동선을 안내합니다.`;

export interface KoreanBillSummaryInput {
  billType: string;
  amountWon: number;
  dueDate: string;
}

export function summarizeKoreanBill(input: KoreanBillSummaryInput): string {
  const manWon = Math.floor(input.amountWon / 10000);
  const cheonWon = Math.floor((input.amountWon % 10000) / 1000);
  const formattedAmount =
    manWon > 0 && cheonWon > 0
      ? `${manWon}만 ${cheonWon}천 원`
      : manWon > 0
        ? `${manWon}만 원`
        : `${input.amountWon}원`;
  return `${input.billType}입니다. 납부하실 금액은 ${formattedAmount}, 납부기한은 ${input.dueDate}까지입니다.`;
}

export interface DailySimulationStep {
  useCaseId: string;
  time: string;
  title: string;
  userVoiceOrContext: string;
  execute: (orchestrator: SotaOrchestrator) => string;
}

export const KOREAN_DAILY_SIMULATION_STEPS: readonly DailySimulationStep[] = [
  {
    useCaseId: "UC-01",
    time: "07:00",
    title: "기상 및 복약/안약 구분",
    userVoiceOrContext: "소타, 지금 손에 든 거 아침 안약 맞아? 식후 약은 어디 있어?",
    execute: (orch) =>
      orch.handleObjectFinder(
        "식후 아침 약 봉지",
        { centerX: 0.25, centerY: 0.6, distanceMeters: 0.45 },
        "오른손에 쥔 건 일회용 인공눈물입니다",
      ),
  },
  {
    useCaseId: "UC-02",
    time: "07:30",
    title: "아침 식사 및 냉장고 반찬통/유통기한 브리핑",
    userVoiceOrContext: "냉장고 문을 열고 위칸을 바라봄",
    execute: (orch) =>
      orch.handleSmartBriefing(
        "위칸 왼쪽부터 배추김치, 소고기장조림, 서울우유입니다. 우유 유통기한은 11월 18일까지로 3일 남았습니다.",
      ),
  },
  {
    useCaseId: "UC-03",
    time: "08:00",
    title: "외출 준비 (옷 얼룩 확인 및 분실 이어폰 탐색)",
    userVoiceOrContext: "소타, 내 셔츠 깨끗해? 그리고 에어팟 케이스 어디 있지?",
    execute: (orch) =>
      orch.handleObjectFinder(
        "에어팟 케이스",
        { centerX: 0.9, centerY: 0.7, distanceMeters: 0.7 },
        "네이비 셔츠에 얼룩 없습니다. 소파 오른쪽 쿠션 옆",
      ),
  },
  {
    useCaseId: "UC-04",
    time: "08:15",
    title: "보행 길 찾기 (시각 랜드마크 결합 도보 내비게이션)",
    userVoiceOrContext: "역삼역 정류장까지 도보 안내 중 골목 분기점 접근",
    execute: (orch) => {
      orch.handleVisualWayfindingTurn({
        distanceMeters: 1.5,
        landmarkName: "CU 편의점 유리문",
        turnClock: 3,
        tactileContinues: true,
      });
      return "2걸음 앞 CU 편의점 유리문 모서리에서 3시 방향으로 우회전하세요. 바닥 점자블록이 이어집니다.";
    },
  },
  {
    useCaseId: "UC-05",
    time: "08:25",
    title: "골목길 보행 중 점자블록 위 공유 킥보드 회피 경고",
    userVoiceOrContext: "점자블록을 따라 보행 중 전방 3m 킥보드 감지 (능동 안전 개입)",
    execute: (orch) => {
      orch.handleHazardReflex({
        hazardType: "ELECTRIC_SCOOTER",
        distanceMeters: 3,
        avoidDirection: "왼쪽",
        onTactilePaving: true,
      });
      return "전방 3미터 점자블록 위 공유 킥보드, 왼쪽으로 반 걸음 피하세요.";
    },
  },
  {
    useCaseId: "UC-06",
    time: "08:30",
    title: "음향신호기 없는 사거리 횡단보도 건너기",
    userVoiceOrContext: "횡단보도 대기 중 보행자 녹색 신호 점등 감지",
    execute: (orch) => {
      orch.handleCrosswalkSignal({
        state: "GREEN",
        remainingSeconds: 24,
        alignmentClock: 12,
      });
      return "녹색 신호로 바뀌었습니다. 잔여 24초, 정면 12시 방향으로 걸으세요.";
    },
  },
  {
    useCaseId: "UC-07",
    time: "08:35",
    title: "버스 정류장 방향 검증, 도착 시간 확인 및 진입 버스 탑승",
    userVoiceOrContext: "소타, 여기 강남역 가는 정류장 맞아? 472번 언제 와?",
    execute: (orch) =>
      orch.handleBusStopCheck({
        targetRouteNumber: "472",
        intendedDirectionKeyword: "강남역",
        observedArsId: "22-001",
        observedStopName: "신논현역",
        observedDirectionSign: "강남역·양재역",
        nextArrivalMinutes: 2,
        stopsAway: 1,
        approachingBuses: [
          { order: 1, routeNumber: "143" },
          {
            order: 2,
            routeNumber: "472",
            doorDistanceMeters: 4,
            isDoorOpen: true,
          },
        ],
      }),
  },
  {
    useCaseId: "UC-08",
    time: "08:50",
    title: "지하철 승강장 검증, 열차 도착 시간 및 빠른 환승 탑승 위치(3-2 -> 5-3) 이동 코칭",
    userVoiceOrContext:
      "소타, 여기 교대 가는 승강장 맞아? 지하철 언제 와? 여기서 타면 빠른 환승 돼?",
    execute: (orch) =>
      orch.handleSubwayPlatformCheck({
        lineName: "2호선",
        intendedDirectionStation: "교대",
        observedNextStationOnSign: "교대",
        observedScreenDoor: "3-2",
        fastTransferTargetDoor: "5-3",
        transferStationName: "교대역",
        transferTargetLine: "3호선",
        higherCarDirectionWhenFacingDoor: "RIGHT",
        nextTrainArrivalMinutes: 3,
      }),
  },
  {
    useCaseId: "UC-09",
    time: "09:05",
    title: "지하철 환승 통로 실내 내비게이션 (표지판 + 점자블록 + 계단/에스컬레이터)",
    userVoiceOrContext: "교대역 하차 후 3호선 환승 통로 갈림길 진입",
    execute: (orch) =>
      orch.handleTransferCorridorGuidance({
        targetLineName: "주황색 3호선",
        arrowDirection: "LEFT",
        remainingMeters: 60,
        hasTactileJunctionAhead: true,
        verticalTransitionAhead: {
          type: "STAIRS_DOWN",
          distanceMeters: 10,
          handrailSide: "RIGHT",
        },
      }),
  },
  {
    useCaseId: "UC-10",
    time: "12:30",
    title: "식당 무인 키오스크 손가락 위치(Hand-to-UI) 코칭",
    userVoiceOrContext: "소타, 키오스크에서 김치찌개 단품 버튼 어디 있어?",
    execute: (orch) =>
      orch.handleKioskHandCoach(
        {
          deltaXCm: 3,
          deltaYCm: -1,
          targetLabel: "김치찌개 단품(9,000원)",
        },
        "결제 카드 투입구는 화면 우측 하단 모서리에 있습니다.",
      ),
  },
  {
    useCaseId: "UC-11",
    time: "15:00",
    title: "오피스 평면 터치 정수기 온수 화상 방지 및 회의실 호수 확인",
    userVoiceOrContext: "탕비실 터치식 정수기 앞에 서서 버튼을 바라봄",
    execute: (orch) =>
      orch.handleSmartBriefing(
        "터치식 정수기입니다. 왼쪽 붉은색 버튼이 온수이니 주의하시고, 가운데 파란색 버튼이 냉수, 아래 레버가 출수 버튼입니다.",
      ),
  },
  {
    useCaseId: "UC-12",
    time: "18:30",
    title: "카페 음료 픽업 후 빈 좌석 및 바닥 장애물 안내",
    userVoiceOrContext: "픽업대에서 커피를 들고 홀 쪽으로 고개를 돌림",
    execute: (orch) =>
      orch.handleObjectFinder(
        "창가 2인석 빈자리",
        { centerX: 0.25, centerY: 0.5, distanceMeters: 3.5 },
        "정면 바닥에 손님 가방이 있으니 오른쪽으로 돌아가세요",
      ),
  },
  {
    useCaseId: "UC-13",
    time: "20:00",
    title: "귀가 후 아파트 관리비 고지서 핵심 요약 브리핑",
    userVoiceOrContext: "우편함에서 꺼낸 고지서를 눈앞에 듦",
    execute: (orch) =>
      orch.handleSmartBriefing(
        summarizeKoreanBill({
          billType: "11월분 아파트 관리비 고지서",
          amountWon: 142000,
          dueDate: "11월 28일",
        }),
      ),
  },
  {
    useCaseId: "UC-14",
    time: "20:15",
    title: "[대비감도·깊이지각 보완] 무표시 회색 내리막 계단 첫 단 및 투명 통유리문 감지",
    userVoiceOrContext: "상가 로비에서 회색 계단과 통유리문 접근",
    execute: (orch) => {
      orch.handleHazardReflex({
        hazardType: "STEP_DROP",
        distanceMeters: 2,
        avoidDirection: "오른쪽",
        onTactilePaving: false,
      });
      return "전방 2미터 단차, 오른쪽으로 반 걸음 피하세요.";
    },
  },
  {
    useCaseId: "UC-15",
    time: "20:30",
    title: "[해외 1위 사례·한국 특화] 호출 택시·장애인 콜택시 번호판·차종 및 뒷좌석 문 손잡이 안내",
    userVoiceOrContext: "소타, 지금 앞에 선 차가 내가 부른 택시 맞아?",
    execute: (orch) => {
      const res = verifyCalledTaxiOrRideKo({
        expectedPlateNumber: "34바 5678",
        observedPlateNumber: "서울 34바 5678",
        vehicleColorKo: "흰색",
        vehicleModelKo: "쏘나타",
        doorDistanceMeters: 2.1,
      });
      return orch.handleSmartBriefing(res.spokenGuidance);
    },
  },
  {
    useCaseId: "UC-16",
    time: "20:45",
    title: "[중심시야 결손·마트 쇼핑] 편의점/마트 유사 음료 용기(제로슈거·맛·1+1 행사·가격) 구분",
    userVoiceOrContext: "소타, 지금 손에 든 캔 음료 뭐고 행사 상품이야?",
    execute: (orch) =>
      orch.handleSmartBriefing(
        smartReader.summarizeGroceryProductKo({
          productName: "코카콜라",
          variantOrFlavor: "레몬향 500ml",
          isZeroSugar: true,
          priceWon: 2000,
          promotionBadge: "1+1",
        }),
      ),
  },
  {
    useCaseId: "UC-17",
    time: "21:00",
    title: "[대비감도·식사 보조] 흰 접시/식판 위 반찬 배치 및 생선 가시·남은 양 브리핑",
    userVoiceOrContext: "소타, 식탁 위 반찬 어디에 뭐가 있는지 알려줘",
    execute: (orch) =>
      orch.handleSmartBriefing(
        smartReader.describeDiningPlateLayoutKo([
          { positionKo: "앞쪽 왼쪽", foodName: "흰쌀밥" },
          { positionKo: "앞쪽 오른쪽", foodName: "된장국" },
          {
            positionKo: "위쪽 가운데",
            foodName: "고등어구이",
            hasBoneOrThorns: true,
          },
          {
            positionKo: "위쪽 오른쪽",
            foodName: "두부조림",
            remainingNote: "두 점 남음",
          },
        ]),
      ),
  },
  {
    useCaseId: "UC-18",
    time: "21:15",
    title: "[야맹증·암순응 지연 보완] 어두운 실내/지하 진입 시 바닥 평탄도 및 벽면 동선 가이드",
    userVoiceOrContext: "조도가 급격히 낮은 어두운 복도 진입",
    execute: (orch) =>
      orch.handleSmartBriefing(
        "조명이 어두운 복도 구간에 들어왔어요. 지금 걸어가시는 방향 그대로 다섯 걸음 동안 바닥이 평탄하고, 오른쪽 벽면을 따라 난간이 이어져 있어요.",
      ),
  },
  {
    useCaseId: "UC-19",
    time: "21:30",
    title: "[빛번짐/눈부심(Glare) 보완] 역광·고휘도 LED 전광판 및 안내 표지판 대신 판독",
    userVoiceOrContext: "강한 빛 번짐으로 눈이 부신 역광 전광판 바라봄",
    execute: (orch) =>
      orch.handleSmartBriefing(
        "빛 번짐이 강한 전광판이네요. 화면에는 구의역 2호선 1번 출구 방향이라고 적혀 있어요.",
      ),
  },
  {
    useCaseId: "UC-20",
    time: "21:45",
    title: "[열 화상 방지·가전 조작] 평면 인덕션 화구 켜짐/잔열(H) 경고 및 세탁기 남은 시간 판독",
    userVoiceOrContext: "주방 인덕션 상판 디스플레이를 바라봄",
    execute: (orch) =>
      orch.handleSmartBriefing(
        smartReader.summarizeAppliancePanelKo({
          applianceType: "인덕션",
          activeCourseOrZone: "오른쪽 아래",
          powerLevelOrTemp: "7단계 가열 중",
          hasResidualHeatWarning: true,
        }),
      ),
  },
  {
    useCaseId: "UC-21",
    time: "22:00",
    title: "[공공시설·위생] 상가 공공화장실 남/녀 픽토그램 구분 및 빈 칸·세면대 안내",
    userVoiceOrContext: "점자 없는 카페 화장실 입구 앞에 섬",
    execute: (orch) =>
      orch.handleSmartBriefing(
        smartReader.describeRestroomAndStallKo({
          entranceGenderKo: "남자 화장실",
          entranceDirectionKo: "지금 보시는 왼쪽",
          availableStallOrder: 2,
          sinkLocationKo: "입구 오른쪽",
        }),
      ),
  },
  {
    useCaseId: "UC-22",
    time: "22:15",
    title: "[사회적 상호작용·오피스] 대화 상대방의 명함 건네기 제스처 및 회의 슬라이드 요약",
    userVoiceOrContext: "미팅 중 상대방이 오른손으로 명함을 내묾",
    execute: (orch) =>
      orch.handleSmartBriefing(
        smartReader.coachSocialAndMeetingCueKo({
          cueType: "HANDING_OBJECT",
          personOrSlideTitle: "미팅 상대방",
          detailOrActionKo: "오른손으로 명함을 건네고",
        }),
      ),
  },
  {
    useCaseId: "UC-23",
    time: "22:30",
    title: "[미션 코파일럿] 전체 이동 계획(Macro Plan) 브리핑 및 출발 확정 후 실시간 동행 수행",
    userVoiceOrContext: "소타야, 구의역 가는 전체 계획 먼저 알려주고 출발하자",
    execute: (orch) =>
      orch.handleSmartBriefing(
        "전체 이동 계획을 먼저 말씀드릴게요. 지금 계신 곳에서 역삼역까지 걸어가신 다음, 2호선을 타고 구의역에서 내리는 총 3구간 경로예요. 이 계획대로 출발할까요?",
      ),
  },
];
