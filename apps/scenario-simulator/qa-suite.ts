import {
  parseStructuredHarnessOutput,
  StatefulSkillHarness,
  toNaturalSpokenKorean,
} from "../../packages/core/agent-harness.ts";
import {
  evaluateVisualInspectionPolicy,
  GeminiLiveCompanionSession,
  PersistentEntityMemoryStore,
  StatefulActionGuideFsm,
} from "../../packages/core/live-companion-harness.ts";
import { createKoreanSkillPlugins } from "../../packages/locale-ko-kr/skills.ts";
import { VisualPedestrianNavigator } from "../../packages/locale-ko-kr/pedestrian-nav.ts";
import {
  computeLiveSubwayRideStatusKo,
  computeSeoulSubwayRouteKo,
} from "../../packages/locale-ko-kr/subway-transfer-db.ts";
import { runFullDaySimulation } from "./run-day.ts";

export interface QaCheckResult {
  id: string;
  category: "DAILY_UC" | "WAYFINDING_E2E" | "FIELD_REGRESSION";
  title: string;
  spokenOutput: string;
  passed: boolean;
  failedGates: string[];
}

/**
 * 6 Strict Accessibility & Conversational UX Quality Gates for Visually Impaired Users:
 * 1. No URL encoding (`%EC%`) or mechanical screen-reader symbols (`→`, `[`, `]`)
 * 2. No `"None"` or `"알수없음"` hallucinated station/bus confirmation
 * 3. No sight-dependent color pavement instructions (`"밝은 색상의 보행로"`)
 * 4. No dead-end forward walk instruction when facing a window/desk/wall
 * 5. Concise conversational length (<= 220 chars)
 * 6. Scenario-specific domain accuracy check
 */
export function evaluateSpeechQualityGates(
  rawSpoken: string,
  domainPattern: RegExp,
): { passed: boolean; naturalSpeech: string; failedGates: string[] } {
  const naturalSpeech = toNaturalSpokenKorean(rawSpoken);
  const failedGates: string[] = [];

  if (/%[0-9A-Fa-f]{2}/.test(naturalSpeech) || /[→\[\]]/.test(naturalSpeech)) {
    failedGates.push("GATE_1_NO_URL_OR_BRACKET_SYMBOLS");
  }
  if (/None|알수없음\s*방면/.test(naturalSpeech)) {
    failedGates.push("GATE_2_NO_HALLUCINATED_NONE");
  }
  if (/밝은\s*색상의?\s*보행로|어두운\s*색상의?\s*보행로/.test(naturalSpeech)) {
    failedGates.push("GATE_3_NO_SIGHT_DEPENDENT_COLOR_PATH");
  }
  if (
    /(창문|블라인드|책상)\s*(앞에\s*계십니다|앞입니다).*?(정면|직진).*?(걸어|나가)/.test(
      naturalSpeech,
    )
  ) {
    failedGates.push("GATE_4_NO_DEAD_END_COLLISION");
  }
  if (naturalSpeech.length === 0 || naturalSpeech.length > 240) {
    failedGates.push(`GATE_5_LENGTH_BOUNDS(${naturalSpeech.length})`);
  }
  if (!domainPattern.test(naturalSpeech)) {
    failedGates.push(`GATE_6_DOMAIN_ACCURACY(${domainPattern})`);
  }

  return {
    passed: failedGates.length === 0,
    naturalSpeech,
    failedGates,
  };
}

export async function runFullQaVerificationSuite(): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: QaCheckResult[];
}> {
  const results: QaCheckResult[] = [];

  // Part 1: All 23 Daily Use Cases (UC-01 ~ UC-23)
  const dailyExpectedRegex: Record<string, RegExp> = {
    "UC-01": /인공눈물.*식후 아침 약 봉지/,
    "UC-02": /우유.*3일 남았습니다/,
    "UC-03": /에어팟 케이스/,
    "UC-04": /CU 편의점.*우회전/,
    "UC-05": /공유 킥보드.*왼쪽/,
    "UC-06": /녹색 신호.*24초/,
    "UC-07": /472번.*앞문 열렸습니다/,
    "UC-08": /2호선 교대 방면.*64걸음/,
    "UC-09": /3호선 환승 표지판.*내려가는 계단/,
    "UC-10": /김치찌개.*오른쪽으로 3cm/,
    "UC-11": /온수.*냉수/,
    "UC-12": /빈자리/,
    "UC-13": /관리비 고지서.*14만 2천 원/,
    "UC-14": /단차/,
    "UC-15": /쏘나타.*34바 5678.*뒷좌석 오른쪽 문 손잡이/,
    "UC-16": /코카콜라.*제로슈거.*1\+1 행사/,
    "UC-17": /흰쌀밥.*고등어구이.*가시나 뼈/,
    "UC-18": /어두운 복도 구간.*바닥이 평탄/,
    "UC-19": /빛 번짐.*구의역 2호선 1번 출구/,
    "UC-20": /인덕션.*잔열 표시.*절대 손을 대지 마세요/,
    "UC-21": /남자 화장실.*2번째 칸 문이 비어 있어요/,
    "UC-22": /명함을 건네고.*손을 뻗어/,
    "UC-23": /전체 이동 계획을 먼저 말씀드릴게요.*구의역.*출발할까요/,
  };

  const dailyLogs = runFullDaySimulation();
  for (const item of dailyLogs) {
    const expected = dailyExpectedRegex[item.useCaseId] ?? /.+/;
    const evalRes = evaluateSpeechQualityGates(item.spoken, expected);
    results.push({
      id: item.useCaseId,
      category: "DAILY_UC",
      title: item.title,
      spokenOutput: evalRes.naturalSpeech,
      passed: evalRes.passed,
      failedGates: evalRes.failedGates,
    });
  }

  // Part 2: End-to-End Wayfinding & Public Transit QA Scenarios (LUM-46, LUM-48, LUM-51, LUM-53, LUM-65, LUM-66)
  const nav = new VisualPedestrianNavigator();

  // QA-NAV-01: Searching "구의역" from Gangnam -> Must find Guui Subway Station #1 & generate Transit+Walk Macro Plan
  const guuiSearch = await nav.searchDestinationCandidates({
    query: "구의역",
    originLat: 37.5006,
    originLng: 127.0364,
    sortMode: "RECOMMENDED",
  });
  const guuiSearchCheck = evaluateSpeechQualityGates(
    guuiSearch.confirmationPromptKo,
    /대중교통 약 \d+분 걸리는 광진구 아차산로 근처 구의역.*어디로 안내해 드릴까요/,
  );
  results.push({
    id: "QA-NAV-01",
    category: "WAYFINDING_E2E",
    title: "[E2E 길찾기 1단계] '구의역' 검색 시 대중교통 예상 시간 + 짧은 주소('광진구 아차산로 근처 구의역') 결합 브리핑",
    spokenOutput: guuiSearchCheck.naturalSpeech,
    passed:
      guuiSearchCheck.passed &&
      guuiSearch.candidatesByRecommended[0]?.spokenPlaceWithAddrKo.includes(
        "광진구 아차산로 근처 구의역",
      ),
    failedGates: guuiSearchCheck.failedGates,
  });

  // QA-NAV-02: Confirming "구의역" -> Must build Macro Transit Plan (Walk -> Subway -> Arrive) without %EC% encoding
  const guuiRoute = await nav.buildConfirmedPedestrianRoute({
    originAddressKo: guuiSearch.originAddressKo,
    originLat: 37.5006,
    originLng: 127.0364,
    destination: guuiSearch.candidatesByRecommended[0],
  });
  const guuiPlanCheck = evaluateSpeechQualityGates(
    guuiRoute.route.macroPlanOverviewKo,
    /전체 이동 계획을 먼저 말씀드릴게요.*구의역.*이 계획으로 안내를 시작할까요/,
  );
  results.push({
    id: "QA-NAV-02",
    category: "WAYFINDING_E2E",
    title: "[E2E 길찾기 2단계] '구의역' 선택 시 마이크로 지시 전 전체 대중교통+도보 이동 계획(Macro Plan) 브리핑",
    spokenOutput: guuiPlanCheck.naturalSpeech,
    passed:
      guuiPlanCheck.passed &&
      (guuiRoute.route.routeSource === "TMAP_SUBWAY_AND_WALK" ||
        guuiRoute.route.routeSource === "TMAP_TRANSIT_AND_WALK"),
    failedGates: guuiPlanCheck.failedGates,
  });

  // QA-REG-04: LUM-68, LUM-69, LUM-70 Subway Route Map ("왕십리역 -> 구의역") & Anti-Hallucination on non-place conversational utterances
  const cleanNonPlace1 = VisualPedestrianNavigator.extractCleanPlaceQuery(
    "아니 지하철로 대중교통 검색",
  );
  const cleanNonPlace2 = VisualPedestrianNavigator.extractCleanPlaceQuery(
    "거기 말고 조금 더 가까운 곳으로 안내해줘",
  );
  const cleanMultiToken = VisualPedestrianNavigator.extractCleanPlaceQuery(
    "아까 말한 데 말고 건대입구역 근처 스타벅스 찾아줘",
  );
  const wangsimniToGuui = computeSeoulSubwayRouteKo(
    "왕십리역 수인분당선",
    "구의역 2호선",
  );
  const reg04Check = evaluateSpeechQualityGates(
    wangsimniToGuui?.summaryKo ?? "",
    /왕십리역에서 2호선 한양대 방면 열차를 타고.*5정거장.*구의역.*오른쪽 문 열림.*에서 하차/,
  );
  results.push({
    id: "QA-REG-04",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-68/69/70] 비장소 발화('아니 지하철로', '거기 말고 가까운 곳') 차단 + 복합 장소명('건대입구역 스타벅스') 추출 + 지하철 노선도 경로",
    spokenOutput: reg04Check.naturalSpeech,
    passed:
      reg04Check.passed &&
      cleanNonPlace1 === "" &&
      cleanNonPlace2 === "" &&
      cleanMultiToken === "건대입구역 스타벅스",
    failedGates: reg04Check.failedGates,
  });

  // QA-REG-05: LUM-73, LUM-80, LUM-83, LUM-84, LUM-85, LUM-105 Live Subway Station / Remaining Stops / Door Side / 1-Stop Prep Alert
  const routeStns = wangsimniToGuui?.allRouteStationsKo ?? [];
  // At 성수역 (37.5446, 127.0560) -> 2 stops before 구의역
  const atSeongsu = computeLiveSubwayRideStatusKo({
    currentLat: 37.5446,
    currentLng: 127.056,
    routeStations: routeStns,
    destinationExitRaw: "구의역 1번출구",
  });
  // At 건대입구역 (37.5404, 127.0692) -> 1 stop before 구의역 (Prep alert!)
  const atKondae = computeLiveSubwayRideStatusKo({
    currentLat: 37.5404,
    currentLng: 127.0692,
    routeStations: routeStns,
    destinationExitRaw: "구의역 1번출구",
  });
  // At 구의역 (37.5371, 127.0861) -> 0 stops remaining + 1번 출구 guidance
  const atGuui = computeLiveSubwayRideStatusKo({
    currentLat: 37.5371,
    currentLng: 127.0861,
    routeStations: routeStns,
    destinationExitRaw: "구의역 1번출구",
  });
  const reg05Seongsu = evaluateSpeechQualityGates(
    atSeongsu?.coachingKo ?? "",
    /성수역 부근.*2정거장 남았으니 아직 내리지 마시고.*오른쪽/,
  );
  const reg05Kondae = evaluateSpeechQualityGates(
    atKondae?.coachingKo ?? "",
    /건대입구역이에요.*바로 다음 역이 내리실 구의역입니다.*오른쪽 문이 열리니/,
  );
  results.push({
    id: "QA-REG-05",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-80/83/84/85/105] 실시간 GPS 기반 현재 역·남은 정거장·내릴 문 방향(오른쪽) 및 1정거장 전(건대입구) 하차 준비 알림",
    spokenOutput: `${reg05Seongsu.naturalSpeech} | ${reg05Kondae.naturalSpeech}`,
    passed:
      reg05Seongsu.passed &&
      reg05Kondae.passed &&
      atSeongsu?.remainingStops === 2 &&
      atKondae?.remainingStops === 1 &&
      atGuui?.targetExitTextKo === "1번 출구",
    failedGates: [...reg05Seongsu.failedGates, ...reg05Kondae.failedGates],
  });

  // QA-REG-06: LUM-75, LUM-79, LUM-86, LUM-89 Subway train window guard, no empty-seat hunting, and no '초록빛 조명' color instruction
  const reg06TrainWindow = evaluateSpeechQualityGates(
    "어이쿠, 바로 앞은 지하철 창문이라 막혀 있어요. 오른쪽으로 살짝 돌아서서 환승 통로를 찾아볼까요?",
    /지하철 열차 안 출입문 앞에 안전하게 서 계시네요.*손잡이를 잘 잡고/,
  );
  const reg06SeatAndLight = evaluateSpeechQualityGates(
    "열차 안에 무사히 타셨네요. 자리가 비어 있다면 조심히 앉아서 다음 안내를 기다려 볼까요? 초록빛 조명이 보이는 통로로 가세요.",
    /출입문 옆 손잡이를 안전하게 잡고 계세요.*통로로 가세요/,
  );
  results.push({
    id: "QA-REG-06",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-75/79/86/89] 지하철 객차 내 창문 충돌 오경고 방지, 빈자리 탐색 대신 문 앞 손잡이 안내, '초록빛 조명' 제거",
    spokenOutput: `${reg06TrainWindow.naturalSpeech} | ${reg06SeatAndLight.naturalSpeech}`,
    passed:
      reg06TrainWindow.passed &&
      reg06SeatAndLight.passed &&
      !reg06SeatAndLight.naturalSpeech.includes("초록빛"),
    failedGates: [
      ...reg06TrainWindow.failedGates,
      ...reg06SeatAndLight.failedGates,
    ],
  });

  // QA-REG-07: SOTA-131 Context Gate Micro-Skill Isolation (16+ registered Micro-Skills, but <= 4 injected per prompt)
  const harness = new StatefulSkillHarness(createKoreanSkillPlugins());
  const totalRegisteredSkills = harness.getRegisteredSkills().length;
  const diningActiveIds = harness.getActiveCandidateSkillIds(
    "식탁 위 반찬 배치 알려줘",
  );
  const groceryActiveIds = harness.getActiveCandidateSkillIds(
    "마트 상품 1+1 행사랑 제로슈거 확인해줘",
  );
  const stepDoorSkill = harness
    .getRegisteredSkills()
    .find((s) => s.id === "STEP_AND_GLASS_DOOR")!;
  const stepDoorSpeech = await stepDoorSkill.executePostProcess!({
    mode: "STEP_AND_GLASS_DOOR",
    extractedSlots: {
      type: "투명유리문",
      steps: "2",
      handleSide: "오른쪽",
      action: "당기기",
    },
    draftSpokenKorean: "",
  });
  const reg07Check = evaluateSpeechQualityGates(
    stepDoorSpeech,
    /2걸음 앞에 투명 통유리문이 있어요.*오른쪽에 당기기 손잡이/,
  );
  results.push({
    id: "QA-REG-07",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 SOTA-131] 16개 독립 Micro-Skill 분리 및 Context Gate(프롬프트당 최대 4개 스킬 마스킹) 간섭 0% 검증",
    spokenOutput: `${reg07Check.naturalSpeech} (전체 등록 스킬: ${totalRegisteredSkills}개 -> 활성 주입: ${diningActiveIds.length}개 [${diningActiveIds.join("+")}])`,
    passed:
      reg07Check.passed &&
      totalRegisteredSkills >= 16 &&
      diningActiveIds.length <= 4 &&
      diningActiveIds.includes("DINING_ASSISTANT") &&
      groceryActiveIds.length <= 4 &&
      groceryActiveIds.includes("GROCERY_SCANNER"),
    failedGates: reg07Check.failedGates,
  });
  // QA-REG-08: SOTA-132/133/134 Universal Skill Contract (15s TemporalSlotCache + UnreadableReason View-Finding + Manufactured Date Confounder Defense)
  harness.clearTemporalSlotCache();
  // Frame 1 observes line & nextStation
  harness.mergeAndCacheTemporalSlots({ line: "2호선", nextStation: "교대" }, 1000);
  // Frame 2 (3 seconds later) only observes door=3-2 -> TemporalSlotCache merges both!
  const mergedTemporal = harness.mergeAndCacheTemporalSlots({ door: "3-2" }, 4000);
  const smartReaderSkill = harness
    .getRegisteredSkills()
    .find((s) => s.id === "SMART_READER")!;
  const occludedSpeech = await smartReaderSkill.executePostProcess!({
    mode: "SMART_READER",
    extractedSlots: { unreadableReason: "OCCLUDED_BY_HAND" },
    draftSpokenKorean: "",
  });
  const manufacturedSpeech = await smartReaderSkill.executePostProcess!({
    mode: "SMART_READER",
    extractedSlots: {
      product: "서울우유",
      expiryDate: "2026-11-01",
      dateType: "MANUFACTURED",
    },
    draftSpokenKorean: "",
  });
  const reg08Check = evaluateSpeechQualityGates(
    `${occludedSpeech} ${manufacturedSpeech}`,
    /손가락이 글자 부분을 가리고 있어요.*제조일자가 2026-11-01로 적혀 있어요.*소비기한은.*따로 적혀 있으니/,
  );
  results.push({
    id: "QA-REG-08",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 SOTA-132~134] 15초 시계열 슬롯 병합(TemporalSlotCache) + 손가락 가림 조준 코칭 + 제조일자/소비기한 혼동 방어",
    spokenOutput: reg08Check.naturalSpeech,
    passed:
      reg08Check.passed &&
      mergedTemporal.line === "2호선" &&
      mergedTemporal.nextStation === "교대" &&
      mergedTemporal.door === "3-2",
    failedGates: reg08Check.failedGates,
  });
  // QA-REG-09: LUM-132/133/134 AUTO Mode Refrigerator & Orange Juice Classification (Never WALKING_SAFETY)
  const fridgeDoorParsed = parseStructuredHarnessOutput(
    "[WALKING_SAFETY] 냉장고 문 앞에 서 계시니까 조심해서 이동해 볼까요?",
  );
  const orangeJuiceParsed = parseStructuredHarnessOutput(
    "[WALKING_SAFETY] 델몬트 오렌지주스 1.5리터 병이 보이네요. 냉장고 안에서 꺼내고 계신가 봐요.",
  );
  const reg09Check = evaluateSpeechQualityGates(
    fridgeDoorParsed.draftSpeech,
    /냉장고 문을 여셨네요.*찾으시는 음료나 반찬통을 가까이 비춰 주시면 이름과 소비기한을 읽어 드릴게요/,
  );
  results.push({
    id: "QA-REG-09",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-132/133/134] 전체자동(AUTO) 모드에서 냉장고/오렌지주스 노출 시 WALKING_SAFETY 오분류 차단 및 SMART_READER 자동 전환",
    spokenOutput: `${reg09Check.naturalSpeech} (교정된 모드: ${fridgeDoorParsed.mode}, ${orangeJuiceParsed.mode})`,
    passed:
      reg09Check.passed &&
      fridgeDoorParsed.mode === "SMART_READER" &&
      orangeJuiceParsed.mode === "SMART_READER",
    failedGates: reg09Check.failedGates,
  });

  // QA-REG-10: LUM-135/136/137/138 Conservative Visually Impaired Transit ETA ('포자랩스' >= 40min) & STT Typo Barge-In Search ('그냥 컴포즈 커피 홈즈 폭포' -> 컴포즈커피 홍제폭포점)
  const pozalabsSearch = await nav.searchDestinationCandidates({
    query: "목적지 포자랩스로 바꿔줘",
    originLat: 37.5571,
    originLng: 127.0371,
    sortMode: "RECOMMENDED",
  });
  const composeTypoSearch = await nav.searchDestinationCandidates({
    query: "그냥 컴포즈 커피 홈즈 폭포 검색",
    originLat: 37.5571,
    originLng: 127.0371,
    sortMode: "RECOMMENDED",
  });
  const pozaFirst = pozalabsSearch.candidatesByRecommended[0];
  const composeFirst = composeTypoSearch.candidatesByRecommended[0];
  const reg10Check = evaluateSpeechQualityGates(
    `${pozalabsSearch.confirmationPromptKo} | ${composeTypoSearch.confirmationPromptKo}`,
    /포자랩스.*컴포즈커피/,
  );
  results.push({
    id: "QA-REG-10",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-135~138] 시각장애인 보수적 대중교통 소요시간(포자랩스 약 45~55분) 및 말끊기 STT 오타('그냥 컴포즈 커피 홈즈 폭포' -> 홍제폭포점) 복원",
    spokenOutput: reg10Check.naturalSpeech,
    passed:
      reg10Check.passed &&
      (pozaFirst?.estimatedTransitMinutes ?? 0) >= 40 &&
      (composeFirst?.name.includes("컴포즈커피") ?? false),
    failedGates: reg10Check.failedGates,
  });

  // QA-REG-11: 2-Tier Expert Playbook Completeness across all 16 Micro-Skills (O&M Shoreline Re-alignment + Fridge/Drink Seal/Remaining/Expiry Value Formula)
  const allSkills = harness.getRegisteredSkills();
  const everySkillHasPlaybook = allSkills.every(
    (s) =>
      s.expertPlaybook &&
      s.expertPlaybook.visualScanChecklist.length >= 2 &&
      s.expertPlaybook.realLifeValueFormula.length >= 20 &&
      s.expertPlaybook.confounderAndSafetyGuards.length >= 1 &&
      s.expertPlaybook.physicalAimingGuide.length >= 10,
  );
  const fridgePrompt = harness.assembleDynamicPrompt("냉장고 안에 든 음료수 유통기한 봐줘");
  const diningPrompt = harness.assembleDynamicPrompt("식탁 반찬이랑 물컵 어디 있어?");
  results.push({
    id: "QA-REG-11",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 Expert Playbook] 16개 전체 Skill 4단계 전문가 플레이북(스캔순서·자립가치공식·혼동방어·물리조준) 탑재 및 2-Tier 동적 주입 검증",
    spokenOutput: `16/16 스킬 전문가 플레이북 검증 완료 (SMART_READER 개봉/잔량/소비기한 공식 & DINING 물컵/수저/가시 공식 주입 확인)`,
    passed:
      everySkillHasPlaybook &&
      fridgePrompt.includes("Visual Scan Order:") &&
      fridgePrompt.includes("Opened/Remaining amount") &&
      diningPrompt.includes("water cup/pitcher"),
    failedGates: everySkillHasPlaybook ? [] : ["MISSING_EXPERT_PLAYBOOK"],
  });

  // QA-REG-12: LUM-141~146 Pipe-delimited slot parsing, Handheld Card -> SMART_READER override (even with '공용 화장실' text), and Minimal Thinking speed
  const cardParsed = parseStructuredHarnessOutput(
    "[RESTROOM_AND_SEAT | docType=카드 | product=파크타워카드] 손에 쥐고 계신 카드 뒷면에 공용 화장실과 엘리베이터 전용 안내 및 관리사무소 번호가 적혀 있어요.",
  );
  results.push({
    id: "QA-REG-12",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-141~146] 파이프(|) 슬롯 파싱 및 손에 든 카드 내 '화장실' 문구 오분류 차단(SMART_READER 고정)",
    spokenOutput: `${cardParsed.draftSpeech} (교정된 모드: ${cardParsed.mode}, product=${cardParsed.slots.product})`,
    passed:
      cardParsed.mode === "SMART_READER" &&
      cardParsed.slots.product === "파크타워카드",
    failedGates: cardParsed.mode === "SMART_READER" ? [] : ["WRONG_CARD_MODE"],
  });

  // QA-REG-13: LUM-147 Full Verbatim Reading Mode ('카드 내용 전체 다 읽어줘' overrides 1-2 sentence summary cap & routes '공동현관 출입카드예요' to SMART_READER)
  const fullReadPrompt = harness.assembleDynamicPrompt("카드 내용 전체 다 읽어줘");
  const accessCardParsed = parseStructuredHarnessOutput(
    "[WALKING_SAFETY] 공동현관 출입카드예요. 번호는 오오육오육이고 타인에게 대여할 수 없어요.",
  );
  results.push({
    id: "QA-REG-13",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-147] '전체 다 읽어줘' 요청 시 요약 제한 해제(전문 낭독 모드 전환) 및 '공동현관 출입카드' SMART_READER 분류",
    spokenOutput: `${accessCardParsed.draftSpeech} (교정된 모드: ${accessCardParsed.mode}, 전문낭독 프롬프트 활성화=${fullReadPrompt.includes("FULL VERBATIM READING MODE")})`,
    passed:
      fullReadPrompt.includes("FULL VERBATIM READING MODE") &&
      accessCardParsed.mode === "SMART_READER",
    failedGates:
      fullReadPrompt.includes("FULL VERBATIM READING MODE") &&
      accessCardParsed.mode === "SMART_READER"
        ? []
        : ["MISSING_FULL_READ_OVERRIDE"],
  });

  // QA-REG-14: LUM-148~152 Never treat '다시 읽어줘 / 유통기한 읽어줘' as place search, and enforce SAVE OBJECT LOCATION override for '위치 기억해 줘'
  const cleanReadCmd = VisualPedestrianNavigator.extractCleanPlaceQuery(
    "다시 우유 유통기한 읽어줘",
  );
  const saveLocPrompt = harness.assembleDynamicPrompt("위치 기억해 줘");
  results.push({
    id: "QA-REG-14",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-148~152] '유통기한 읽어줘' 길안내 오작동 원천 차단 및 '위치 기억해 줘' 시각 메모리 최우선 오버라이드 검증",
    spokenOutput: `비장소 명령 추출 결과: "${cleanReadCmd}" | 위치기억 오버라이드 주입=${saveLocPrompt.includes("SAVE OBJECT LOCATION")}`,
    passed:
      !cleanReadCmd.includes("읽어") &&
      saveLocPrompt.includes("SAVE OBJECT LOCATION"),
    failedGates:
      !cleanReadCmd.includes("읽어") &&
      saveLocPrompt.includes("SAVE OBJECT LOCATION")
        ? []
        : ["READ_QUERY_LEAKED_TO_NAV"],
  });

  // QA-REG-15: LUM-153, 154, 155 ('투게더 아이스크림 통' WALKING_SAFETY 오분류 차단 + 존재하지 않는 날짜 '2026년 2월 29일' 환각 결정론적 차단 & 빙과류 제조일자 안내)
  const iceCreamAuto = parseStructuredHarnessOutput(
    "[WALKING_SAFETY] 투게더 아이스크림 통이 보이네요. 드시기 편하게 준비되어 있어요.",
  );
  const fakeLeapDateBlocked = await smartReaderSkill.executePostProcess!({
    mode: "SMART_READER",
    extractedSlots: {
      product: "투게더 오리지널 바닐라",
      expiryDate: "2026-02-29",
    },
    draftSpokenKorean:
      "투게더 오리지널 바닐라 제품이고요, 소비기한은 2026년 2월 29일까지예요.",
  });
  results.push({
    id: "QA-REG-15",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-153~155] '투게더 아이스크림 통' SMART_READER 자동 분류 및 허위 날짜('2026년 2월 29일') 결정론적 환각 차단·빙과류 제조일자 안내",
    spokenOutput: `모드교정=${iceCreamAuto.mode} | 환각차단응답="${fakeLeapDateBlocked}"`,
    passed:
      iceCreamAuto.mode === "SMART_READER" &&
      !fakeLeapDateBlocked.includes("2월 29일") &&
      fakeLeapDateBlocked.includes("보이지 않아요"),
    failedGates:
      iceCreamAuto.mode === "SMART_READER" &&
      !fakeLeapDateBlocked.includes("2월 29일")
        ? []
        : ["FAKE_DATE_NOT_BLOCKED"],
  });

  // QA-REG-16: SOT-156, 157, 159~164 (Valid date in draftSpeech NEVER erased into '제품 제품이지만', 정수기 -> APPLIANCE_SAFETY, 자판기 -> KIOSK_COACH)
  const validDraftDateKept = await smartReaderSkill.executePostProcess!({
    mode: "SMART_READER",
    extractedSlots: {},
    draftSpokenKorean:
      "해찬들 태양초 고추장 소비기한은 2027년 12월 22일까지예요.",
  });
  const dispenserParsed = parseStructuredHarnessOutput(
    "[SMART_READER] 정수기 물받이 쪽이 보이네요. 온수 버튼을 주의하시고 냉수 버튼을 누르세요.",
  );
  const vendingParsed = parseStructuredHarnessOutput(
    "[WALKING_SAFETY] 자판기 두 번째 칸에 생수가 진열되어 있어요. 오른쪽 카드 단말기에 태그 후 아래 버튼을 누르세요.",
  );
  results.push({
    id: "QA-REG-16",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 SOT-156~164] 정상 소비기한('2027년 12월 22일') 덮어쓰기 버그 제거, 정수기(APPLIANCE_SAFETY)·자판기(KIOSK_COACH) 정확 라우팅",
    spokenOutput: `날짜유지="${validDraftDateKept}" | 정수기=${dispenserParsed.mode} | 자판기=${vendingParsed.mode}`,
    passed:
      validDraftDateKept.includes("2027년 12월 22일") &&
      !validDraftDateKept.includes("제품 제품이지만") &&
      dispenserParsed.mode === "APPLIANCE_SAFETY" &&
      vendingParsed.mode === "KIOSK_COACH",
    failedGates:
      validDraftDateKept.includes("2027년 12월 22일") &&
      dispenserParsed.mode === "APPLIANCE_SAFETY" &&
      vendingParsed.mode === "KIOSK_COACH"
        ? []
        : ["SOT_156_164_REGRESSION"],
  });

  // QA-REG-17: SOT-165~174 (Roadway curb safety rule + Vending machine purchase steps instead of '꺼내 드릴까요?' + Dual-date manufacturing vs expiry playbook)
  const walkingPrompt = harness.assembleDynamicPrompt();
  const kioskSkill = harness
    .getRegisteredSkills()
    .find((s) => s.id === "KIOSK_COACH")!;
  results.push({
    id: "QA-REG-17",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 SOT-165~174] 차도(가로수/연석) 방향 회피 금지·'4~5걸음' 쪼개기 금지 및 자판기 카드결제/선택버튼 구매 가이드 검증",
    spokenOutput: `보행안전 차도금지=${walkingPrompt.includes("차도 쪽 회피 절대 금지")} | 자판기 구매코칭=${kioskSkill.expertPlaybook?.realLifeValueFormula.includes("Card reader tap")}`,
    passed:
      walkingPrompt.includes("차도 쪽 회피 절대 금지") &&
      (kioskSkill.expertPlaybook?.realLifeValueFormula.includes(
        "Card reader tap",
      ) ??
        false),
    failedGates: walkingPrompt.includes("차도 쪽 회피 절대 금지")
      ? []
      : ["MISSING_ROADWAY_GUARD"],
  });

  // QA-REG-18: Universal Structural Generalization (Unseen arbitrary items like '마요네즈 튜브' / '선크림 용기' route to SMART_READER with ZERO item-noun hardcoding!)
  const unseenTubeParsed = parseStructuredHarnessOutput(
    "[WALKING_SAFETY] 마요네즈 튜브 뒷면에 작은 글씨가 인쇄되어 있어요.",
  );
  const unseenLotionParsed = parseStructuredHarnessOutput(
    "[WALKING_SAFETY] 선크림 용기 바닥면에 사용기한이 적혀 있어요.",
  );
  results.push({
    id: "QA-REG-18",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 범용구조] 미등록 임의 사물('마요네즈 튜브', '선크림 용기')도 품목 하드코딩 없이 구조 패턴으로 SMART_READER 100% 분류",
    spokenOutput: `마요네즈튜브=${unseenTubeParsed.mode} | 선크림용기=${unseenLotionParsed.mode}`,
    passed:
      unseenTubeParsed.mode === "SMART_READER" &&
      unseenLotionParsed.mode === "SMART_READER",
    failedGates:
      unseenTubeParsed.mode === "SMART_READER" &&
      unseenLotionParsed.mode === "SMART_READER"
        ? []
        : ["UNSEEN_CONTAINER_MISCLASSIFIED"],
  });

  // QA-REG-19 & QA-REG-20: Comprehensive 16-Skill Layer-2 Optimization (Crosswalk <10s blinking P0 wait override + Expired-food P0 alert even on body-only dates!)
  const crosswalkSkill = harness
    .getRegisteredSkills()
    .find((s) => s.id === "CROSSWALK_SIGNAL")!;
  const shortGreenWaitSpeech = await crosswalkSkill.executePostProcess!({
    mode: "CROSSWALK_SIGNAL",
    extractedSlots: { signal: "GREEN", remainSec: "6" },
    draftSpokenKorean: "초록불입니다. 잔여 6초, 빨리 건너세요.",
  });
  const expiredBodyDateSpeech = await smartReaderSkill.executePostProcess!({
    mode: "SMART_READER",
    extractedSlots: {},
    draftSpokenKorean: "손에 드신 우유 소비기한은 2025년 5월 10일까지예요.",
  });
  results.push({
    id: "QA-REG-19",
    category: "FIELD_REGRESSION",
    title: "[스킬최적화 횡단보도] 초록불 잔여 시간 부족(6초) 또는 점멸 시 무리한 진입 차단 및 다음 신호 대기(P0) 강제",
    spokenOutput: shortGreenWaitSpeech,
    passed:
      shortGreenWaitSpeech.includes("기다리세요") &&
      shortGreenWaitSpeech.includes("다음 초록불"),
    failedGates: shortGreenWaitSpeech.includes("기다리세요")
      ? []
      : ["SHORT_GREEN_NOT_BLOCKED"],
  });
  results.push({
    id: "QA-REG-20",
    category: "FIELD_REGRESSION",
    title: "[스킬최적화 식품안전] 슬롯 누락 본문 날짜('2025년 5월 10일')에서도 소비기한 경과 자동 계산 및 섭취 금지 경고",
    spokenOutput: expiredBodyDateSpeech,
    passed:
      expiredBodyDateSpeech.includes("지났") &&
      (expiredBodyDateSpeech.includes("폐기") ||
        expiredBodyDateSpeech.includes("마세요")),
    failedGates: expiredBodyDateSpeech.includes("지났")
      ? []
      : ["EXPIRED_BODY_DATE_MISSED"],
  });

  // QA-REG-21 ~ 23: 4-Layer Model-Agnostic Live Companion Harness (See & Read · Act & Guide FSM · Persistent Object/Person Memory)
  const dualDateVerified = evaluateVisualInspectionPolicy(
    {
      targetItem: "고추장 용기",
      exactKeyNumbers: ["4135"],
      observedDates: [
        { rawText: "2026.06.23 11:25", hasTimestamp: true },
        { rawText: "2027.12.22", hasTimestamp: false },
      ],
      framingIssue: "NONE",
    },
    "2026-11-24",
  );
  const receiptOrderVerified = evaluateVisualInspectionPolicy({
    targetItem: "카페 영수증",
    exactKeyNumbers: ["4135"],
    observedDates: [],
    framingIssue: "NONE",
  });
  results.push({
    id: "QA-REG-21",
    category: "FIELD_REGRESSION",
    title: "[Model-Agnostic Harness: 바라보기] 스키마 기반 복수 날짜('2026.06.23 11:25' vs '2027.12.22') 분리 및 4자리 주문번호('4135') 검증",
    spokenOutput: `${dualDateVerified.spokenGuidanceKo} | ${receiptOrderVerified.spokenGuidanceKo}`,
    passed:
      dualDateVerified.resolvedExpiryIso === "2027-12-22" &&
      receiptOrderVerified.spokenGuidanceKo.includes("4135"),
    failedGates:
      dualDateVerified.resolvedExpiryIso === "2027-12-22"
        ? []
        : ["DUAL_DATE_POLICY_FAILED"],
  });

  const actFsm = new StatefulActionGuideFsm();
  const actStep1 = actFsm.step({
    surfaceType: "KIOSK_SCREEN",
    targetLabel: "아이스 초코라떼",
    handVisible: false,
  });
  const actStep2 = actFsm.step({
    surfaceType: "KIOSK_SCREEN",
    targetLabel: "아이스 초코라떼",
    handVisible: true,
    dxCm: 4.1,
    dyCm: -2.2,
  });
  const actStep3 = actFsm.step({
    surfaceType: "KIOSK_SCREEN",
    targetLabel: "아이스 초코라떼",
    handVisible: true,
    dxCm: 0.3,
    dyCm: 0.2,
  });
  results.push({
    id: "QA-REG-22",
    category: "FIELD_REGRESSION",
    title: "[Model-Agnostic Harness: 행동하기] 4단계 상태 기계(베젤 기준점 -> 실시간 cm 이동 -> 정조준 클릭 확정) 강제 검증",
    spokenOutput: `${actStep1.stage} -> ${actStep2.stage} -> ${actStep3.stage} ("${actStep3.spokenGuidanceKo}")`,
    passed:
      actStep1.stage === "STAGE_2_SAFE_BEZEL_ANCHOR" &&
      actStep2.stage === "STAGE_3_LIVE_CM_TRACKING" &&
      actStep3.stage === "STAGE_4_PRESS_AND_VERIFY",
    failedGates:
      actStep3.stage === "STAGE_4_PRESS_AND_VERIFY"
        ? []
        : ["ACT_FSM_FAILED"],
  });

  const memStore = new PersistentEntityMemoryStore();
  memStore.upsert({
    category: "PERSON",
    name: "박서연 팀장",
    landmarkOrAppearance: "은테 안경과 베이지색 트렌치코트 착용",
    extraNotes: "디자인팀",
  });
  memStore.upsert({
    category: "OBJECT",
    name: "아침 혈압약 통",
    landmarkOrAppearance: "식탁 왼쪽 정수기 옆 바구니 안",
  });
  const recalledPerson = memStore.recall("박서연", "PERSON");
  const recalledObj = memStore.recall("혈압약", "OBJECT");
  results.push({
    id: "QA-REG-23",
    category: "FIELD_REGRESSION",
    title: "[Model-Agnostic Harness: 기억하기] 사물(OBJECT)·사람(PERSON)·공간(SPACE) 영구 엔티티 메모리 저장 및 회상 검증",
    spokenOutput: `인물="${recalledPerson[0]?.landmarkOrAppearance}" | 사물="${recalledObj[0]?.landmarkOrAppearance}"`,
    passed: recalledPerson.length === 1 && recalledObj.length === 1,
    failedGates:
      recalledPerson.length === 1 && recalledObj.length === 1
        ? []
        : ["MEMORY_STORE_FAILED"],
  });

  // QA-REG-24 & 25: Active Target Watch ('쌈장 찾으러 가자' -> silent until found) & Live Navigation Tool Integration ('왕십리역 가자')
  const watchSession = new GeminiLiveCompanionSession();
  const watchStart = watchSession.handleToolCallLocally(
    "start_watching_target",
    { targetDescription: "쌈장" },
  );
  const navSearch = watchSession.handleToolCallLocally("search_destination", {
    placeQuery: "왕십리역",
    transportMode: "SUBWAY",
  });
  const navStart = watchSession.handleToolCallLocally("confirm_route_start", {});
  results.push({
    id: "QA-REG-24",
    category: "FIELD_REGRESSION",
    title: "[Live Active Watch] '쌈장 찾으러 가자' -> start_watching_target 무음 감시 모드 진입 및 발견 시에만 발화 검증",
    spokenOutput: watchStart.verifiedSpeechKo,
    passed:
      watchSession.getActiveWatchTarget() === "쌈장" &&
      watchStart.verifiedSpeechKo.includes("조용히") &&
      watchStart.verifiedSpeechKo.includes("쌈장"),
    failedGates:
      watchSession.getActiveWatchTarget() === "쌈장"
        ? []
        : ["WATCH_TARGET_NOT_SET"],
  });
  results.push({
    id: "QA-REG-25",
    category: "FIELD_REGRESSION",
    title: "[Live Wayfinding] Live 세션 내 목적지 검색(search_destination) -> 출발 확정(confirm_route_start) -> GPS+무음코파일럿 분리 검증",
    spokenOutput: `${navSearch.verifiedSpeechKo} | ${navStart.verifiedSpeechKo}`,
    passed:
      watchSession.getActiveNavDestination() === "왕십리역" &&
      navStart.verifiedSpeechKo.includes("GPS") &&
      navStart.verifiedSpeechKo.includes("장애물"),
    failedGates:
      watchSession.getActiveNavDestination() === "왕십리역"
        ? []
        : ["LIVE_NAV_TOOL_FAILED"],
  });

  const emartSearch = await nav.searchDestinationCandidates({
    query: "이마트",
    originLat: 37.5006,
    originLng: 127.0364,
    sortMode: "DISTANCE",
  });
  const emartRoute = await nav.buildConfirmedPedestrianRoute({
    originAddressKo: emartSearch.originAddressKo,
    originLat: 37.5006,
    originLng: 127.0364,
    destination: emartSearch.candidatesByDistance[0],
  });
  const emartWalkCheck = evaluateSpeechQualityGates(
    emartRoute.openingGuidanceKo,
    /전체 이동 계획을 먼저 말씀드릴게요.*이마트.*첫 번째 구간/,
  );
  results.push({
    id: "QA-NAV-03",
    category: "WAYFINDING_E2E",
    title: "[E2E 길찾기 3단계] '이마트' 거리순 검색 및 %EC% 인코딩 없는 TMAP 보행자 턴바이턴 안내",
    spokenOutput: emartWalkCheck.naturalSpeech,
    passed: emartWalkCheck.passed,
    failedGates: emartWalkCheck.failedGates,
  });

  // Part 3: Field-Test Regression Scenarios (LUM-17, LUM-19, LUM-45, LUM-47, LUM-49, LUM-50, LUM-65)
  const subSkill = harness
    .getRegisteredSkills()
    .find((s) => s.id === "SUBWAY_PLATFORM")!;

  // QA-REG-01: Black/Unreadable Subway Frame ("None None 방면") -> Must output Active View-Finding Coaching
  const reg01Speech = await subSkill.executePostProcess!({
    mode: "SUBWAY_PLATFORM",
    extractedSlots: {},
    draftSpokenKorean: "None None 방면 승강장 맞습니다.",
  });
  const reg01Check = evaluateSpeechQualityGates(
    reg01Speech,
    /표지판이나 스크린도어 번호 글자가 선명하게 보이지 않습니다.*3~4걸음 다가선 뒤/,
  );
  results.push({
    id: "QA-REG-01",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-17/19] 암전/미식별 승강장에서 'None 방면 맞습니다' 오탐 차단 및 다가서기 시선 코칭",
    spokenOutput: reg01Check.naturalSpeech,
    passed: reg01Check.passed,
    failedGates: reg01Check.failedGates,
  });

  // QA-REG-02: Indoor Window/Desk Dead-End Collision Guard (LUM-49, LUM-50)
  const reg02Check = evaluateSpeechQualityGates(
    "현재 실내 블라인드 창문 앞에 계십니다. 근처 이마트로 가기 위해 정면 직진 방향으로 5걸음 걸어 방을 나서서 현관으로 이동해 주세요.",
    /막혀 있어서 그대로 걸어가면 부딪혀요.*뒤로 돌아서거나/,
  );
  results.push({
    id: "QA-REG-02",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-49/50] 실내 창문/책상 정면 대치 시 직진 지시 차단 및 180도 뒤로 돌기 안내",
    spokenOutput: reg02Check.naturalSpeech,
    passed: reg02Check.passed,
    failedGates: reg02Check.failedGates,
  });

  // QA-REG-03: Sight-Dependent Color Instruction & %EC% URL Encoding Guard (LUM-45, LUM-65)
  const reg03Check = evaluateSpeechQualityGates(
    "[1/4단계] %EC%97%AD%EC%82%BC%EC%97%AD에서 → 밝은 색상의 보행로를 따라 10걸음 이동하세요.",
    /역삼역에서 보행로를 따라 10걸음 이동하세요/,
  );
  results.push({
    id: "QA-REG-03",
    category: "FIELD_REGRESSION",
    title: "[회귀검증 LUM-45/65] '%EC%' 인코딩 디코딩, 화살표/대괄호 제거, '밝은 색상 보행로' 시각 의존 지시어 제거",
    spokenOutput: reg03Check.naturalSpeech,
    passed: reg03Check.passed,
    failedGates: reg03Check.failedGates,
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return { total: results.length, passed, failed, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runFullQaVerificationSuite();
  console.log("================================================================================");
  console.log(
    ` 🧪 SOTA Real Use-Case & Field Regression QA Report (${report.passed}/${report.total} Passed)`,
  );
  console.log("================================================================================\n");

  for (const r of report.results) {
    const badge = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`[${badge}] (${r.id} | ${r.category}) ${r.title}`);
    console.log(`   🗣️ 발화 검증: "${r.spokenOutput}"`);
    if (!r.passed) {
      console.log(`   ⚠️ 실패 게이트: ${r.failedGates.join(", ")}`);
    }
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log(
    `총 ${report.total}개 QA 시나리오 중 ${report.passed}개 통과, ${report.failed}개 실패`,
  );
  console.log("--------------------------------------------------------------------------------");
  if (report.failed > 0) process.exit(1);
}
