import {
  getSecretFromKeychainOrEnv,
  KEYCHAIN_SERVICE_LINEAR,
} from "./keychain.ts";
import type {
  InferenceFeedbackRecord,
  InferenceFeedbackStore,
} from "./feedback-store.ts";

export interface LumoTicketSpec {
  key: string;
  title: string;
  phase: "PHASE_1_SEOUL_POC" | "PHASE_2_BACKLOG";
  priority: 1 | 2 | 3 | 4; // Linear: 1=Urgent, 2=High, 3=Medium, 4=Low
  status: "Done" | "In Progress" | "Todo" | "Backlog";
  labels: string[];
  description: string;
}

export const LUMO_LINEAR_TICKETS: readonly LumoTicketSpec[] = [
  {
    key: "LUMO-101",
    title: "[Phase 1] One Pager 및 한국 시각장애인 하루 일과 시뮬레이션(UC-01~13) 설계",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["architecture", "ux", "ko-kr"],
    description:
      "시각장애인의 기상/복약, 보행 길 찾기, 횡단보도, 버스 정류장 방향 검증, 지하철 승강장 및 빠른 환승 스크린도어(3-2->5-3) 이동, 환승 통로 내비게이션, 키오스크 손가락 코칭, 고지서 요약 등 13개 핵심 시나리오 정의.",
  },
  {
    key: "LUMO-102",
    title: "[Phase 1] macOS Keychain 기반 보안 키 로더 및 Gemini 3.5 Flash-Lite 비전 에이전트 연동",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["security", "vision-ai"],
    description:
      "LUMO_GEMINI_API_KEY macOS Keychain 연동 및 초저지연 멀티모달 브리핑 파이프라인/오프라인 폴백 구축.",
  },
  {
    key: "LUMO-103",
    title: "[Phase 1] 서울/수도권 지하철 빠른 환승(스크린도어 문 개수·걸음 수 계산) 및 환승 통로 가이드 엔진",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["transit-seoul", "core"],
    description:
      "서울 주요 환승역(교대, 강남, 사당, 고속터미널, 신도림, 여의도 등) 스크린도어 번호(N-M) 기반 문 이동 개수 및 걸음 수 계산기, 반대편 승강장 오진입 경고, 지하 환승 통로 표지판+점자블록 가이드.",
  },
  {
    key: "LUMO-104",
    title: "[Phase 1] 서울시/수도권 대중교통 실시간 도착 공공데이터 API 실키 연동 (지하철 TOPIS / 서울 버스 API)",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["transit-seoul", "api-integration"],
    description:
      "발급된 서울시 실시간 지하철 도착 API(swopenAPI.seoul.go.kr, LUMO_SEOUL_SUBWAY_API_KEY), 서울시 버스 정류소 도착 API(ws.bus.go.kr, LUMO_SEOUL_BUS_API_KEY), SKT TMAP 보행자 API(LUMO_TMAP_API_KEY)를 macOS Keychain에 등록하고 실시간 파서 연동 및 검증 완료.",
  },
  {
    key: "LUMO-105",
    title: "[Phase 1] Google AI Glass / Android Companion Pilot APK 카메라·골전도 이어폰 실기기 필드 테스트",
    phase: "PHASE_1_SEOUL_POC",
    priority: 2,
    status: "In Progress",
    labels: ["android-glass", "pilot"],
    description:
      "AccessibilityService 없이 표준 권한(Camera, Mic, Location, Bluetooth)으로 동작하는 Foreground Companion Service APK 빌드 및 템플 탭 Barge-in / PCM 공간 효과음 현장 검증.",
  },
  {
    key: "LUMO-106",
    title: "[Phase 1] 실시간 1인칭 시야 AI 자동 상황 판단(Auto-Mode) 및 ON/OFF 브리핑 토글 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["vision-ai", "android-glass", "ux"],
    description:
      "요구사항: 수동 모드 선택 없이 카메라 시야만으로 AI가 상황을 자동 분류하고 ON/OFF 토글로 실시간 답변 제어.\n구현사항: gemini-3.5-flash-lite 기반 8개 상황 자동 분류기([WALKING_SAFETY], [CROSSWALK_SIGNAL], [BUS_STOP], [SUBWAY_PLATFORM], [TRANSFER_CORRIDOR], [KIOSK_COACH], [SMART_READER], [INDOOR_SPACE]) 및 Android Camera2 실시간 프리뷰 + 비중첩 TTS 루프 + ON/OFF 토글 APK(v0.2.0-poc) 반영 완료.",
  },
  {
    key: "LUMO-107",
    title: "[Phase 1] 확장 가능한 실시간 멀티모달 AI Agent Harness 아키텍처 설계 (판단/라우팅 레이어 vs 실행/스킬 레이어)",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["architecture", "agent-harness"],
    description:
      "요구사항: 상황을 판단하는 영역(Layer 1)과 세부 규칙/API를 실행하는 영역(Layer 2)을 분리하고, Use Case를 무한히 확장할 수 있는 AI Agent Harness 구축.\n구현사항: 2-Layer Stateful Skill Harness(packages/core/agent-harness.ts, packages/locale-ko-kr/skills.ts, NativeLumoAiClient.kt) 구현 완료.\n- Layer 1 (Context Router & Dynamic Prompt Assembler): 직전 상태(Sticky Mode) + 상시 P0 보행안전(WALKING_SAFETY) + 인접 연관 스킬만 상세 규칙을 동적 조립하여 1회(Single-Pass) LLM 호출로 지연 시간 최소화.\n- Layer 2 (Pluggable Skill Execution Layer): `[MODE_ID | key=value]` 구조화 슬롯 파싱 후 LumoSkillPlugin별 후처리기(서울시 실시간 지하철 TOPIS/버스 API 및 3-2->5-3 걸음 수 계산기 등) 자동 실행.",
  },
  {
    key: "LUMO-108",
    title: "[Phase 1] 필드 테스트용 미니멀 UI 개편 및 추론별 영상·상황모드·추천/비추천·상세 피드백 로거 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["ux", "feedback-loop", "android-glass"],
    description:
      "요구사항: 불필요한 소개/말끊기 버튼을 모두 제거하고 [실시간 카메라 뷰 + AI 답변 ON/OFF 토글]만 남긴 직관적 UI로 개편. 매 추론마다 시각, 소요시간, 실시간 캡처 영상(JPEG), AI 추론 상황 모드([DETECTED_MODE]), 답변 텍스트를 기록하고 추천(👍)/비추천(👎) 아이콘 및 상세 피드백 메모를 작성해 기기 연결 시 동기화/수집되도록 구현.\n구현사항: Android Native UI(MainActivity.kt, FeedbackLogStore.kt) 및 웹 UI(public/index.html), 서버 동기화 API(/api/feedback/logs, /api/feedback/update, /api/feedback/sync)와 USB 연결 시 기기 피드백 수집 스크립트(npm run feedback:pull) 구현 완료.",
  },
  {
    key: "LUMO-109",
    title: "[Phase 1] 미처리 필드 피드백 자동 수집·Linear 개선 티켓 생성 및 처리 Skill(/feedback-triage) 구축",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["feedback-loop", "linear-automation", "skill"],
    description:
      "요구사항: 기기 피드백을 가져와서 이미 처리된 피드백(linearIssueId 존재)은 건너뛰고, 미처리 피드백만 Linear 개발 개선 티켓으로 자동 등록 및 코드 개선까지 수행하는 Skill 구축.\n구현사항: triageUnprocessedFeedbackToLinear(), npm run feedback:triage(apps/android-glass-poc/triage-feedback.ts), 그리고 .devin/skills/feedback-triage/SKILL.md 구현 및 SkillSpector 보안 스캔 검증 완료.",
  },
  {
    key: "LUMO-110",
    title: "[Phase 1] 시각장애인/저시력자 실제 시야 인지 연구 및 해외 사례 기반 신규 Use Case 10선(UC-14~23) PRD v2.0 작성",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["prd", "research", "ux"],
    description:
      "요구사항: 시각장애인 및 저시력자가 실제로 세상을 어떻게 보는지(6대 시각 왜곡: 대비감도 상실, 중심시야 결손, 터널시야, 깊이지각 상실, 빛번짐/눈부심, 야맹증/암순응 지연)와 해외 스마트글래스(Meta Ray-Ban, Envision, Be My Eyes) 실사용 사례를 리서치하여 Use Case 10개(UC-14~23)를 추가한 PRD.md 작성 및 리뷰.",
  },
  {
    key: "LUMO-111",
    title: "[Phase 1] SKT TMAP 통합 POI 검색(추천순/거리순·브랜드 확장) 및 보행자·대중교통 복합 경로 연동",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["tmap-api", "wayfinding", "transit"],
    description:
      "요구사항: '이마트' 검색 시 멀리 있는 대형마트만 나오는 문제를 해결하기 위해 이마트에브리데이/이마트24 등 연관 브랜드 확장 및 TMAP POI(추천순/거리순) 랭킹, TMAP Reverse Geocoding 출발지 확인, TMAP 보행자 턴바이턴 경로 및 TMAP 대중교통 복합 환승 경로 API를 실제 연동.\n구현사항: packages/locale-ko-kr/pedestrian-nav.ts 및 WayfindingNavigator.kt, MainActivity.kt에 TMAP 4대 API(Reverse Geocoding, POI R/A 통합검색, 보행자 경로, 대중교통 경로) 및 [⭐ 추천순 | 📏 거리순] 탭 UI 반영 완료.",
  },
  {
    key: "LUMO-112",
    title: "[Phase 1] 스크린 리더기식 기계적 기호 낭독 제거 및 양방향 멀티턴 대화형 AI 에이전트(Gemini Live / Pickle 스타일) 전환",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["conversational-ux", "tts-stt", "agent-harness"],
    description:
      "요구사항: 기존 스크린 리더기처럼 화살표(→), 대괄호([]), 슬래시(/), 긴 주소/숫자를 그대로 읽어 정신없고 이해하기 어려운 문제를 해결하고, Pickle·Vooy·Gemini Live처럼 유저와 양방향으로 자연스럽게 대화하며 응답하는 에이전트로 개선.\n구현사항: 1) toNaturalSpokenKorean()으로 모든 기호·화살표·괄호·단계 태그 원천 제거 및 1~2문장 구어체(~해요, ~할까요?) 페르소나 적용, 2) 멀티턴 대화 히스토리(conversationHistory) 유지, 3) Android 인라인 SpeechRecognizer 탑재 및 루모가 질문('어디로 안내해 드릴까요?')을 마치면 자동으로 마이크가 열려 음성('1번으로 가자', '에브리데이로 가자')만으로 목적지 확정 및 실시간 질의응답이 이어지는 핸즈프리 대화 루프 구현.",
  },
  {
    key: "LUMO-113",
    title: "[Phase 1] 3단계 User Journey 개편 (1단계 미션/목적지 대화 -> 2단계 전체 여정 계획 브리핑 및 출발 확정 -> 3단계 실시간 동행 수행)",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["user-journey", "ux", "wayfinding"],
    description:
      "요구사항(LUM-53 반영): 전체적으로 어디로 어떻게 갈지 거시적 계획(Macro Plan)을 말해주지 않고 처음부터 마이크로한 보행 안내(책상/창문/현관문 묘사)만 나와 혼란스러운 문제를 해결. 미션을 먼저 구체적으로 설정·합의하는 대화를 나누고 확정이 된 시점부터 미션을 수행하도록 User Journey 재설계.\n구현사항: 1) 목적지 검색/대화 중에는 카메라 마이크로 안내 자동 일시정지, 2) 목적지 선택 시 TMAP 보행+대중교통 데이터를 결합한 [전체 이동 계획 브리핑(macroPlanOverviewKo) 및 구간별 마일스톤(macroMilestones)]을 먼저 설명하고 '이 계획대로 출발할까요?' 질문, 3) 유저가 음성('응 출발하자')이나 버튼으로 확정한 순간부터 실시간 카메라 동행(AI 동행: ON)이 시작되도록 WayfindingNavigator.kt, MainActivity.kt, pedestrian-nav.ts 개편 완료.",
  },
  {
    key: "LUMO-114",
    title: "[UC-14] [대비감도·깊이지각 보완] 무표시 계단 첫 단·내리막 단차(Drop-off)·투명 통유리문 감지 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["uc-14", "low-vision", "safety"],
    description:
      "요구사항: 대비감도와 깊이지각이 낮아 회색 바닥과 회색 내리막 계단 첫 단, 보도 연석 단차, 프레임 없는 투명 유리문을 구분하지 못해 발생하는 낙상·충돌 사고 방지.\n구현사항: WALKING_SAFETY 스킬 및 StepAndGlassDoor 감지 규칙을 통해 내리막 계단 시작점, 난간 방향, 투명 유리문 및 당기는/미는 손잡이 위치를 사전 경고.",
  },
  {
    key: "LUMO-115",
    title: "[UC-15] [해외 1위 사례·한국 특화] 호출 택시·장애인 콜택시(장콜) 차량 색상·차종·번호판 및 승차문 확인 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["uc-15", "mobility", "vision-ai"],
    description:
      "요구사항: 해외 범용 AI 글래스가 프라이버시 필터로 거부하는 차량 번호판 인식을 시각장애인 택시/장콜 탑승 보조용으로 지원하고 차량 색상·차종·뒷좌석 문 손잡이 위치 안내.\n구현사항: verifyCalledTaxiOrRideKo() 및 BUS_STOP/TAXI 스킬 규칙에 호출 택시 번호판 대조 및 승차문 손잡이 걸음 수 안내 구현.",
  },
  {
    key: "LUMO-116",
    title: "[UC-16] [중심시야 결손·마트 쇼핑] 편의점/마트 유사 용기 구분(맛·제로슈거·1+1 행사) 및 가격표 확인 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 2,
    status: "Done",
    labels: ["uc-16", "shopping", "smart-reader"],
    description:
      "요구사항: 만져서는 구분할 수 없는 동일 모양 캔/페트병/컵라면의 세부 맛, 제로슈거 여부, 진열대 가격표, 1+1/2+1 행사 라벨 판독.\n구현사항: KoreanSmartReader.summarizeGroceryProductKo() 및 SMART_READER 쇼핑 규칙 구현.",
  },
  {
    key: "LUMO-117",
    title: "[UC-17] [대비감도·식사 보조] 식사 시 접시/식판 위 반찬 배치 및 뼈/가시·남은 음식 위치 브리핑 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 2,
    status: "Done",
    labels: ["uc-17", "dining", "low-vision"],
    description:
      "요구사항: 흰 접시 위 흰 밥/두부/생선살 등 대비가 낮은 음식과 식판 반찬 배치를 안내하고 식사 후반부 남은 반찬 위치와 가시/뼈 주의 안내.\n구현사항: KoreanSmartReader.describeDiningPlateLayoutKo() 및 INDOOR_SPACE 식사 보조 규칙 구현.",
  },
  {
    key: "LUMO-118",
    title: "[UC-18] [야맹증·암순응 지연 보완] 야간·지하 진입·어두운 실내 조도 급변 시 보행 동선 가이드 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["uc-18", "night-blindness", "safety"],
    description:
      "요구사항: 망막색소변성증(RP)·녹내장 등 야맹증 및 명암 적응 지연 사용자가 어두운 실내/지하/야간 진입 시 겪는 일시적 전맹 패닉 방지.\n구현사항: MainActivity.kt 카메라 프레임 저조도 구간(avgLum 12~55) 실시간 감지 및 바닥 평탄도·벽면/난간 기준 상세 보행 브리핑 주입.",
  },
  {
    key: "LUMO-119",
    title: "[UC-19] [빛번짐/눈부심(Glare) 보완] 역광·강한 햇빛·고휘도 LED 전광판/표지판 대신 판독 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 2,
    status: "Done",
    labels: ["uc-19", "glare", "low-vision"],
    description:
      "요구사항: 백내장·각막혼탁·무홍채증 저시력자가 역광이나 강한 LED 빛번짐(White-out) 때문에 읽지 못하는 전광판/버스 번호/신호등을 카메라로 판독.\n구현사항: MainActivity.kt 고휘도/역광 프레임(glareRatio) 감지 및 고대비 표지판/LED 문자 우선 판독 규칙 구현.",
  },
  {
    key: "LUMO-20",
    title: "[UC-20] [열 화상 방지·가전 조작] 평면 인덕션 화구 켜짐/잔열(H) 상태 및 세탁기/전자레인지 LED 표시창 판독 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["uc-20", "appliance-safety", "kiosk-coach"],
    description:
      "요구사항: 평면 유리 인덕션의 켜진 화구 단계와 잔열(H) 화상 위험 경고, 세탁기/전자레인지 LED 현재 코스 및 남은 시간 판독.\n구현사항: KoreanSmartReader.summarizeAppliancePanelKo() 및 KIOSK_COACH 가전 안전 규칙 구현.",
  },
  {
    key: "LUMO-121",
    title: "[UC-21] [공공시설·위생] 공공화장실 남/녀 픽토그램·빈 칸(사용중 표시)·세면대/핸드드라이어 탐색 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 2,
    status: "Done",
    labels: ["uc-21", "restroom", "indoor-nav"],
    description:
      "요구사항: 점자가 없는 상가/카페 화장실의 남녀 픽토그램 구분 및 내부 빈 칸(초록/빨강 사용중 표시), 세면대/비누 위치 안내.\n구현사항: KoreanSmartReader.describeRestroomAndStallKo() 및 TRANSFER_CORRIDOR/INDOOR_SPACE 화장실 안내 규칙 구현.",
  },
  {
    key: "LUMO-122",
    title: "[UC-22] [사회적 상호작용·오피스] 대화 상대방의 비언어 단서(악수·명함/물건 건네기) 및 회의 슬라이드 요약 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 2,
    status: "Done",
    labels: ["uc-22", "social-cue", "office"],
    description:
      "요구사항: 중심시야 결손으로 놓치기 쉬운 상대방의 물건/명함 건네기 제스처 코칭 및 회의실 프로젝터 발표 화면 핵심 요약.\n구현사항: KoreanSmartReader.coachSocialAndMeetingCueKo() 및 INDOOR_SPACE/SMART_READER 규칙 구현.",
  },
  {
    key: "LUMO-123",
    title: "[UC-23] [미션 코파일럿] 출발~도착 단일 미션 컨텍스트 유지·교통카드 체크·전체 이동 계획 브리핑·능동 시선 코칭 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["uc-23", "mission-copilot", "user-journey"],
    description:
      "요구사항: 무차별 간판 낭독(청각 공해)을 차단하고 목적지 미션 중심 필터링, 출발 전 교통카드 체크, 전체 이동 계획 브리핑 후 출발 확정, 표지판 미식별 시 능동적 다가서기/시선 코칭 제공.\n구현사항: 3단계 User Journey 및 StatefulSkillHarness 미션 코파일럿 통합 완료.",
  },
  {
    key: "LUMO-124",
    title: "[Phase 1] 23개 일상 Use Case + TMAP E2E 길찾기 + 필드 피드백 회귀 검증용 자동화 QA 시뮬레이션 스위트(npm run qa) 구축",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["qa", "simulation", "testing"],
    description:
      "요구사항: 실제 Use Case(UC-01~23) 및 필드 테스트 회귀 케이스(LUM-17~66)를 6대 접근성·대화형 품질 게이트(기호/%EC% 누수 방지, None 오탐 방지, 시각 의존 색상 지시 방지, 창문/책상 정면 충돌 방지, 전체 이동 계획 선행 브리핑, 도메인 정확도)로 일괄 검증하는 QA 시뮬레이터 구축.\n구현사항: apps/scenario-simulator/qa-suite.ts (npm run qa) 구현 및 29개 전체 QA 시나리오 통과 검증 완료.",
  },
  {
    key: "LUMO-125",
    title: "[Phase 1] 목적지 검색 후보 브리핑 시 대중교통 예상 소요시간 안내 및 '구+도로명 부근 장소명'(예: 광진구 아차산로 부근 구의역) 짧은 주소 결합 개선",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["ux", "wayfinding", "transit"],
    description:
      "요구사항: 목적지 검색 후 후보를 물어볼 때 도보 시간(예: 걸어서 73분)만 나와 비현실적인 문제를 해결하여 대중교통 기준 예상 소요시간(예: 대중교통 약 18분)을 안내하고, 단순히 장소명만 말하는 대신 '광진구 아차산로 근처 쿠팡/구의역'처럼 짧은 주소(구+도로명)를 함께 말해 사용자가 어느 지점인지 명확히 구분할 수 있도록 개선.\n구현사항: PlaceCandidate 및 PoiCandidate에 estimatedTransitMinutes와 spokenPlaceWithAddrKo('광진구 아차산로 근처 장소명')를 추가하고 confirmationPromptKo 및 후보 선택 버튼 UI에 전면 반영 완료.",
  },
  {
    key: "LUMO-126",
    title: "[UC-01/02/13/16] 실시간 카메라 기반 식품 소비기한 D-Day 자동 계산기 및 마트 유사 용기(제로슈거·1+1 행사·가격)·약봉지/고지서 후처리 엔진 구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["uc-01", "uc-02", "uc-16", "smart-reader"],
    description:
      "요구사항: 시뮬레이터에 있던 약봉지/유통기한/마트 1+1 구분 기능을 실제 라이브 카메라 추론 시 추출된 expiryDate 슬롯과 오늘 날짜를 비교해 남은 일수/경과 일수를 결정론적으로 계산하고 제로슈거/행사 여부를 브리핑하도록 실구현.\n구현사항: SMART_READER executePostProcess 및 NativeLumoAiClient.kt에 실시간 소비기한 D-Day 계산기 및 마트 상품/약봉지 구조화 후처리 구현 완료.",
  },
  {
    key: "LUMO-127",
    title: "[UC-03] 온디바이스 생활 물건 위치 시각 메모리(Visual Memory) 자동 인덱싱·음성 회상 및 외출 복장/얼룩 점검 실구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["uc-03", "visual-memory", "indoor"],
    description:
      "요구사항: 카메라에 에어팟, 안경, 열쇠, 지갑, 리모컨 등 생활 물건이 포착되면 위치와 시각을 온디바이스 메모리에 저장하고, 사용자가 '내 에어팟 어디 있어?'라고 물으면 마지막 목격 위치를 즉시 안내하며, 복장 얼룩/색상 점검을 수행.\n구현사항: NativeLumoAiClient.kt 및 skills.ts에 savedVisualMemoryMap 인덱싱/회상 후처리기 구현 완료.",
  },
  {
    key: "LUMO-128",
    title: "[UC-15] 호출 택시·장애인 콜택시 목표 차량 번호 등록 및 실시간 번호판·차종·승차문 손잡이 매칭 실구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["uc-15", "taxi", "mobility"],
    description:
      "요구사항: 사용자가 호출한 택시 번호(예: 34바 5678)를 말하거나 입력하면 카메라로 진입 차량 번호판·색상·차종을 읽어 일치 여부를 판정하고 뒷좌석 오른쪽 문 손잡이 위치를 안내.\n구현사항: NativeLumoAiClient.expectedTaxiPlate 및 BUS_STOP/TAXI_MATCHER 후처리 로직 구현 완료.",
  },
  {
    key: "LUMO-129",
    title: "[UC-17/20/21/22] 식사 반찬/가시 브리핑, 평면 인덕션 잔열(H) P0 화상 경보, 공공화장실 빈칸/성별 탐색, 미팅 명함/슬라이드 코칭 전용 핸들러 실구현",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["uc-17", "uc-20", "uc-21", "uc-22"],
    description:
      "요구사항: 식사 보조(UC-17), 인덕션 잔열 H 감지 시 P0 위험 경고음(UC-20), 화장실 남녀 픽토그램 및 빈칸 탐색(UC-21), 상대방 명함/악수 제스처 및 발표 슬라이드 요약(UC-22)을 전용 슬롯 후처리기로 실구현.\n구현사항: KIOSK_COACH 잔열 P0 승격 및 식사/화장실/오피스 전용 프롬프트·후처리 구현 완료.",
  },
  {
    key: "LUMO-130",
    title: "[Phase 1] 경로 안내 편중 해소를 위한 6대 일상 카테고리 탭 & 원터치 Use Case 테스트 칩 기반 올인원 검증 스튜디오 UI 개편",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["ui-ux", "multi-uc", "verification-app"],
    description:
      "요구사항: 기존 검증 앱 UI가 경로 안내에만 치우쳐 다른 Use Case(마트 쇼핑, 식사 보조, 약봉지/유통기한, 인덕션/가전, 물건 찾기, 택시 탑승, 화장실/회의실 등)를 테스트하기 불편했던 문제를 해결.\n구현사항: MainActivity.kt 및 companion-web index.html 상단에 [🌟 자동감지 | 🧭 보행·길찾기 | 🚇 대중교통·택시 | 🛒 마트·식사·문서 | 🏠 생활·가전·키오스크 | 🚻 공공시설·오피스] 6대 카테고리 탭과 카테고리별 원터치 시나리오 실행 칩(Quick Action Chips)을 배치하여 모든 23개 Use Case를 즉시 실행·검증·피드백 기록할 수 있도록 개편 완료.",
  },
  {
    key: "LUMO-131",
    title: "[Phase 1] Use Case 확장에 따른 추론 성능 저하 방지를 위한 Context Gate(최대 4개 스킬 마스킹) 및 16개 독립 Micro-Skill 1:1 분리 리팩토링",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["architecture", "micro-skills", "context-gate"],
    description:
      "요구사항: PRD.md의 23개 Use Case가 일부 공유 스킬(INDOOR_SPACE, SMART_READER 등)에 뭉쳐 있어 발생하는 규칙 희석(Instruction Drift)을 방지하고, 향후 Use Case가 50~100개로 늘어나도 다른 Use Case의 추론 성능이 떨어지지 않도록 아키텍처 고도화.\n구현사항: 1) STEP_AND_GLASS_DOOR(UC-14), TAXI_MATCHER(UC-15), GROCERY_SCANNER(UC-16), DINING_ASSISTANT(UC-17), APPLIANCE_SAFETY(UC-11/20), RESTROOM_AND_SEAT(UC-12/21), SOCIAL_MEETING(UC-22), KIOSK_COACH(UC-10 dxCm/dyCm 계산 포함) 등 16개 독립 Micro-Skill로 1:1 분리 및 전용 Layer 2 후처리기 탑재, 2) 매 추론 시 현재 Context Gate를 통과한 최대 4개의 Micro-Skill만 프롬프트에 동적 주입하도록 StatefulSkillHarness 및 NativeLumoAiClient.kt 개편 완료.",
  },
  {
    key: "LUMO-132",
    title: "[Phase 1] 오픈소스 멀티모달 아키텍처(Omi, LiveKit Agents, MCP) 분석 기반 범용 Skill 설계 메타 스킬(/lumo-skill-architect) 구축",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["skill-architect", "open-source", "architecture"],
    description:
      "요구사항: BasedHardware/omi(Surface+LatencyClass+TypedSchema), livekit/agent-skills(Task Handoff & Scenario Grading), OpenInterpreter/MCP(Zero-Hardcoding & UnreadableReason) 아키텍처를 분석적으로 반영하여, 새로운 Use Case를 언제나 누구든지 사용할 수 있는 범용 Skill로 변환·검증하는 메타 스킬(.devin/skills/lumo-skill-architect/SKILL.md) 구축 및 SkillSpector 스캔(0/100 LOW) 완료.",
  },
  {
    key: "LUMO-133",
    title: "[Phase 1] Zero-Hardcoding 범용 Skill 엔진 고도화 (15초 Temporal Slot Cache + UnreadableReason 물리 조준 코칭 + Confounder 방어)",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["agent-harness", "zero-hardcoding", "temporal-cache"],
    description:
      "요구사항: 모든 Skill에서 특정 역/문번호('5-3')/정류장('22-001') 등 하드코딩된 폴백을 전면 제거하고, 1) 최근 15초 시계열 슬롯 누적기(TemporalSlotCache), 2) 인식 실패 원인별 물리 조준 코칭(TOO_FAR, TOO_CLOSE_BLUR, OCCLUDED_BY_HAND, WRONG_SIDE, TILT_UP), 3) 혼동 요소 방어(제조일자 vs 소비기한 등), 4) 실시간 시각 안전 묘사와 Layer 2 결과 병합 구현 완료.",
  },
  {
    key: "LUMO-134",
    title: "[Phase 1] English-Core Prompt & Schema + Target-Locale(ko-KR) Output 전환 및 16개 전체 Skill 재생성·검증·APK 업데이트",
    phase: "PHASE_1_SEOUL_POC",
    priority: 1,
    status: "Done",
    labels: ["english-core", "i18n", "android-apk"],
    description:
      "요구사항: 추론 정확도(Instruction Following)와 토큰 효율성, 글로벌 오픈소스 유지보수성을 높이기 위해 내부 시스템 프롬프트·스키마·슬롯 규칙을 영어(English-Core)로 전환하고 최종 발화만 로케일(ko-KR)로 출력하도록 16개 전체 Skill을 재생성 및 QA 검증 후 Android APK 업데이트 완료.",
  },
  {
    key: "LUMO-201",
    title: "[Backlog] 국토교통부 TAGO 전국 시내버스·광역지하철 실시간 도착 API 확장 연동",
    phase: "PHASE_2_BACKLOG",
    priority: 3,
    status: "Backlog",
    labels: ["transit-nationwide", "backlog"],
    description:
      "서울/수도권 PoC 검증 완료 후, 부산·대구·대전·광주 등 전국 지자체 시내버스 BIT 및 광역도시철도 실시간 도착 정보(공공데이터포털 TAGO API) 어댑터 확장.",
  },
  {
    key: "LUMO-202",
    title: "[Backlog] 장애인 콜택시 / 카카오T Deep Link 호출 보조 및 보호자 WebRTC 1인칭 시야 공유",
    phase: "PHASE_2_BACKLOG",
    priority: 4,
    status: "Backlog",
    labels: ["mobility-action", "backlog"],
    description:
      "외부 모빌리티 앱 Deep Link 연동 및 긴급 상황 시 보호자에게 현재 GPS 위치와 스마트 글래스 1인칭 카메라 스트림을 공유하는 원격 동행 기능.",
  },
];

export interface LinearSyncedIssue {
  identifier: string;
  title: string;
  stateName: string;
  url: string;
  action: "created" | "existing";
}

async function linearGraphqlRequest<T = any>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000),
  });
  const payload = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!res.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message ?? `Linear HTTP ${res.status}`);
  }
  return payload.data as T;
}

export async function checkLinearConnection(): Promise<{
  configured: boolean;
  viewerName?: string;
  teamKey?: string;
  diagnostic: string;
}> {
  const apiKey = getSecretFromKeychainOrEnv(
    KEYCHAIN_SERVICE_LINEAR,
    "LINEAR_API_KEY",
  );
  if (!apiKey) {
    return {
      configured: false,
      diagnostic:
        "Linear MCP(.devin/mcp_config.json)가 설정되었습니다. macOS Keychain에 `LUMO_LINEAR_API_KEY`를 등록하면 티켓이 자동 동기화됩니다.",
    };
  }

  try {
    const data = await linearGraphqlRequest<{
      viewer: { id: string; name: string };
      teams: { nodes: Array<{ id: string; key: string; name: string }> };
    }>(apiKey, "{ viewer { id name } teams { nodes { id key name } } }");
    const team = data.teams.nodes[0];
    return {
      configured: true,
      viewerName: data.viewer.name,
      teamKey: team?.key,
      diagnostic: `Linear 연결됨 (${data.viewer.name} / 팀: ${team?.name ?? "N/A"} [${team?.key ?? ""}])`,
    };
  } catch (err) {
    return {
      configured: false,
      diagnostic: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Idempotently syncs `LUMO_LINEAR_TICKETS` into the Lumo (`LUM`) team in Linear.
 * Matches by title so running it multiple times never creates duplicate tickets.
 */
export async function syncTicketsToLinear(): Promise<{
  synced: LinearSyncedIssue[];
  teamKey: string;
}> {
  const apiKey = getSecretFromKeychainOrEnv(
    KEYCHAIN_SERVICE_LINEAR,
    "LINEAR_API_KEY",
  );
  if (!apiKey) {
    throw new Error("LUMO_LINEAR_API_KEY not found in macOS Keychain");
  }

  const meta = await linearGraphqlRequest<{
    teams: {
      nodes: Array<{
        id: string;
        key: string;
        name: string;
        states: { nodes: Array<{ id: string; name: string }> };
      }>;
    };
    issues: {
      nodes: Array<{
        id: string;
        identifier: string;
        title: string;
        url: string;
        state: { name: string };
      }>;
    };
  }>(
    apiKey,
    `{
      teams {
        nodes {
          id
          key
          name
          states { nodes { id name } }
        }
      }
      issues(first: 100) {
        nodes {
          id
          identifier
          title
          url
          state { name }
        }
      }
    }`,
  );

  const team =
    meta.teams.nodes.find((t) => t.key === "LUM" || t.name === "Lumo") ??
    meta.teams.nodes[0];
  if (!team) {
    throw new Error("No Linear team found in workspace");
  }

  const stateIdByName = new Map<string, string>();
  for (const st of team.states.nodes) {
    stateIdByName.set(st.name.toLowerCase(), st.id);
  }

  const existingByTitle = new Map(
    meta.issues.nodes.map((iss) => [iss.title.trim(), iss]),
  );

  const results: LinearSyncedIssue[] = [];

  for (const spec of LUMO_LINEAR_TICKETS) {
    const existing = existingByTitle.get(spec.title.trim());
    const stateId = stateIdByName.get(spec.status.toLowerCase());
    if (existing) {
      const fullDescription = `${spec.description}\n\n- **Phase**: \`${spec.phase}\`\n- **Internal Spec ID**: \`${spec.key}\`\n- **Labels**: ${spec.labels.map((l) => `\`${l}\``).join(", ")}`;
      await linearGraphqlRequest(
        apiKey,
        `mutation UpdateLumoIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
          }
        }`,
        {
          id: existing.id,
          input: {
            description: fullDescription,
            ...(stateId ? { stateId } : {}),
          },
        },
      );
      results.push({
        identifier: existing.identifier,
        title: existing.title,
        stateName: spec.status,
        url: existing.url,
        action: "existing",
      });
      continue;
    }
    const created = await linearGraphqlRequest<{
      issueCreate: {
        success: boolean;
        issue: {
          identifier: string;
          title: string;
          url: string;
          state: { name: string };
        };
      };
    }>(
      apiKey,
      `mutation CreateLumoIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            identifier
            title
            url
            state { name }
          }
        }
      }`,
      {
        input: {
          teamId: team.id,
          title: spec.title,
          description: `${spec.description}\n\n- **Phase**: \`${spec.phase}\`\n- **Internal Spec ID**: \`${spec.key}\`\n- **Labels**: ${spec.labels.map((l) => `\`${l}\``).join(", ")}`,
          priority: spec.priority,
          ...(stateId ? { stateId } : {}),
        },
      },
    );

    const issue = created.issueCreate.issue;
    results.push({
      identifier: issue.identifier,
      title: issue.title,
      stateName: issue.state.name,
      url: issue.url,
      action: "created",
    });
  }

  return { synced: results, teamKey: team.key };
}

export interface FeedbackTriageItemResult {
  feedbackId: string;
  detectedMode: string;
  feedbackText: string;
  linearIssueId: string;
  linearIssueUrl: string;
}

/**
 * Finds all unprocessed actionable feedback items in `InferenceFeedbackStore` (`!linearIssueId`),
 * creates a Linear improvement issue for each (or deduplicates against existing Linear issues containing `[Feedback ID: <id>]`),
 * and marks the feedback record as processed so it is never created twice.
 */
export async function triageUnprocessedFeedbackToLinear(
  store: InferenceFeedbackStore,
): Promise<{
  skippedAlreadyProcessedCount: number;
  createdTickets: FeedbackTriageItemResult[];
}> {
  const allRecords = store.listRecords(500);
  const skippedAlreadyProcessedCount = allRecords.filter((r) =>
    Boolean(r.linearIssueId),
  ).length;
  const unprocessed = store.getUnprocessedActionableFeedback();

  if (unprocessed.length === 0) {
    return { skippedAlreadyProcessedCount, createdTickets: [] };
  }

  const apiKey = getSecretFromKeychainOrEnv(
    KEYCHAIN_SERVICE_LINEAR,
    "LINEAR_API_KEY",
  );
  if (!apiKey) {
    throw new Error("LUMO_LINEAR_API_KEY not found in macOS Keychain");
  }

  const meta = await linearGraphqlRequest<{
    teams: {
      nodes: Array<{
        id: string;
        key: string;
        name: string;
        states: { nodes: Array<{ id: string; name: string }> };
      }>;
    };
    issues: {
      nodes: Array<{
        id: string;
        identifier: string;
        title: string;
        description?: string;
        url: string;
      }>;
    };
  }>(
    apiKey,
    `{
      teams {
        nodes {
          id
          key
          name
          states { nodes { id name } }
        }
      }
      issues(first: 100) {
        nodes {
          id
          identifier
          title
          description
          url
        }
      }
    }`,
  );

  const team =
    meta.teams.nodes.find((t) => t.key === "LUM" || t.name === "Lumo") ??
    meta.teams.nodes[0];
  if (!team) {
    throw new Error("No Linear team found in workspace");
  }

  const todoStateId = team.states.nodes.find(
    (s) => s.name.toLowerCase() === "todo",
  )?.id;

  const createdTickets: FeedbackTriageItemResult[] = [];

  for (const item of unprocessed) {
    const marker = `[Feedback ID: ${item.id}]`;
    const alreadyInLinear = meta.issues.nodes.find(
      (iss) =>
        iss.description?.includes(marker) || iss.title.includes(item.id),
    );

    if (alreadyInLinear) {
      store.markFeedbackProcessed({
        id: item.id,
        linearIssueId: alreadyInLinear.identifier,
        linearIssueUrl: alreadyInLinear.url,
      });
      continue;
    }

    const summarySnippet = (
      item.feedbackText.trim() ||
      `비추천(${item.vote}) 추론 개선: ${item.spokenKorean}`
    ).slice(0, 65);
    const title = `[Feedback 개선] [${item.detectedMode}] ${summarySnippet}`;

    const descriptionLines = [
      `### 사용자 필드 테스트 피드백 기반 AI 스킬/규칙 개선 티켓`,
      `- **Feedback ID**: ${marker}`,
      `- **추론 시각**: \`${item.timestampIso}\` (소요시간: \`${item.latencyMs}ms\`, 기기: \`${item.deviceSource}\`)`,
      `- **AI 추론 상황 모드**: \`[${item.detectedMode}]\` (${item.detectedModeLabelKo})`,
      `- **AI 당시 음성 답변**: "${item.spokenKorean}"`,
      `- **사용자 평가**: \`${item.vote === "DOWN" ? "👎 비추천 (DOWN)" : item.vote === "UP" ? "👍 추천 (UP)" : "메모"}\``,
      `- **사용자 상세 피드백**: "${item.feedbackText || "(상세 메모 없음 — 비추천 처리됨)"}"`,
      `- **캡처 이미지 포함 여부**: ${item.imageBase64 ? "있음 (`feedback-logs/inference-feedback.json` 내 Base64 보관)" : "없음"}`,
    ];

    const created = await linearGraphqlRequest<{
      issueCreate: {
        success: boolean;
        issue: {
          identifier: string;
          url: string;
        };
      };
    }>(
      apiKey,
      `mutation CreateFeedbackIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            identifier
            url
          }
        }
      }`,
      {
        input: {
          teamId: team.id,
          title,
          description: descriptionLines.join("\n"),
          priority: item.vote === "DOWN" ? 2 : 3,
          ...(todoStateId ? { stateId: todoStateId } : {}),
        },
      },
    );

    const issue = created.issueCreate.issue;
    store.markFeedbackProcessed({
      id: item.id,
      linearIssueId: issue.identifier,
      linearIssueUrl: issue.url,
    });

    createdTickets.push({
      feedbackId: item.id,
      detectedMode: item.detectedMode,
      feedbackText: item.feedbackText,
      linearIssueId: issue.identifier,
      linearIssueUrl: issue.url,
    });
  }

  return { skippedAlreadyProcessedCount, createdTickets };
}
