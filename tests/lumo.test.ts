import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { PriorityAudioArbiter } from "../packages/core/audio-arbiter.ts";
import {
  verifyBusStopAndArrivalKo,
  verifyCalledTaxiOrRideKo,
  verifySubwayPlatformAndTransferKo,
  guideTransferCorridorKo,
  parseScreenDoorCode,
} from "../packages/core/transit-engine.ts";
import { coachFingertipToButtonKo } from "../packages/core/spatial-language.ts";
import { KoreanSmartReader } from "../packages/core/smart-reader.ts";
import { VisualMemoryStore } from "../packages/core/visual-memory.ts";
import {
  getSecretFromKeychainOrEnv,
  KEYCHAIN_SERVICE_GEMINI,
  maskSecretMetadata,
} from "../packages/core/keychain.ts";
import {
  GeminiVisionAgent,
  parseAutoSceneOutput,
} from "../packages/core/gemini-vision-agent.ts";
import {
  isValidObservedSlot,
  parseStructuredHarnessOutput,
  sanitizeBlindFriendlySpeech,
  StatefulSkillHarness,
  toNaturalSpokenKorean,
} from "../packages/core/agent-harness.ts";
import { createKoreanSkillPlugins } from "../packages/locale-ko-kr/skills.ts";
import { findSubwayTransferRule } from "../packages/locale-ko-kr/subway-transfer-db.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InferenceFeedbackStore } from "../packages/core/feedback-store.ts";
import { KoreaTransitProvider } from "../packages/locale-ko-kr/transit-provider.ts";
import { LUMO_LINEAR_TICKETS } from "../packages/core/linear-backlog.ts";
import {
  coachHeadingAlignmentKo,
  VisualPedestrianNavigator,
} from "../packages/locale-ko-kr/pedestrian-nav.ts";
import { runFullDaySimulation } from "../apps/scenario-simulator/run-day.ts";
import { createCompanionServer } from "../apps/companion-web/server.ts";
import type {
  AudioSink,
  EarconType,
  SpeechPriority,
} from "../packages/hardware-adapters/interfaces.ts";

class MockAudioSink implements AudioSink {
  public earcons: EarconType[] = [];
  public spoken: Array<{ text: string; priority: SpeechPriority }> = [];
  public stopCount = 0;

  playEarcon(earcon: EarconType): void {
    this.earcons.push(earcon);
  }
  speak(text: string, priority: SpeechPriority): void {
    this.spoken.push({ text, priority });
  }
  stopSpeaking(): void {
    this.stopCount += 1;
  }
}

test("Subway screen door parser and fast transfer door step calculation (3-2 -> 5-3)", () => {
  assert.deepEqual(parseScreenDoorCode("3-2"), { car: 3, door: 2 });
  assert.equal(parseScreenDoorCode("15-9"), null);

  const res = verifySubwayPlatformAndTransferKo({
    lineName: "2호선",
    intendedDirectionStation: "교대",
    observedNextStationOnSign: "교대",
    observedScreenDoor: "3-2",
    fastTransferTargetDoor: "5-3",
    transferStationName: "교대역",
    transferTargetLine: "3호선",
    higherCarDirectionWhenFacingDoor: "RIGHT",
    nextTrainArrivalMinutes: 3,
  });

  assert.equal(res.isCorrectPlatform, true);
  assert.equal(res.doorOffsetCount, 9);
  assert.equal(res.estimatedSteps, 64);
  assert.equal(res.moveDirectionKo, "오른쪽(3시 방향)");
  assert.match(res.spokenGuidance, /오른쪽\(3시 방향\)으로 문 9개, 약 64걸음 이동하세요/);
});

test("Subway wrong platform detection alerts user immediately", () => {
  const res = verifySubwayPlatformAndTransferKo({
    lineName: "2호선",
    intendedDirectionStation: "교대",
    observedNextStationOnSign: "역삼",
    observedScreenDoor: "3-2",
    higherCarDirectionWhenFacingDoor: "RIGHT",
    nextTrainArrivalMinutes: 2,
  });

  assert.equal(res.isCorrectPlatform, false);
  assert.match(res.spokenGuidance, /반대편 승강장으로 이동하세요/);
});

test("Bus stop wrong direction warning vs correct direction arrival", () => {
  const wrong = verifyBusStopAndArrivalKo({
    targetRouteNumber: "472",
    intendedDirectionKeyword: "강남역",
    observedStopName: "신논현역",
    observedDirectionSign: "신사역·한남대교",
    nextArrivalMinutes: 4,
    stopsAway: 2,
  });
  assert.equal(wrong.isCorrectDirection, false);
  assert.match(wrong.spokenGuidance, /건너편 정류장으로 이동해야 합니다/);
});

test("Transfer corridor signage + tactile junction + stairs guidance", () => {
  const msg = guideTransferCorridorKo({
    targetLineName: "3호선",
    arrowDirection: "LEFT",
    remainingMeters: 50,
    hasTactileJunctionAhead: true,
    verticalTransitionAhead: {
      type: "STAIRS_DOWN",
      distanceMeters: 7,
      handrailSide: "RIGHT",
    },
  });
  assert.match(
    msg,
    /전방 점자블록 갈림길에서 3호선 환승 표지판을 따라 왼쪽 9시 방향으로 꺾으세요/,
  );
  assert.match(
    msg,
    /10걸음 앞에 내려가는 계단이 있습니다\. 오른쪽 손잡이를 잡으세요/,
  );
});

test("Korean Subway Transfer Hub DB & VisualPedestrianNavigator outdoor/indoor routing", () => {
  const gangnamRule = findSubwayTransferRule({
    stationName: "강남",
    fromLine: "2호선",
    toLine: "신분당선",
  });
  assert.ok(gangnamRule);
  assert.equal(gangnamRule.fastTransferDoor, "8-3");

  const nav = new VisualPedestrianNavigator();
  const corridorPlan = nav.getIndoorTransferCorridorPlan({
    stationName: "교대역",
    fromLine: "2호선",
    toLine: "3호선",
  });
  assert.equal(corridorPlan.length, 2);
  assert.match(corridorPlan[0], /주황색 3호선/);

  let route = nav.createSampleRouteToStation("신논현역 버스정류장");
  const step1 = nav.advanceOutdoorWalk(route, 48); // ~33.6m -> within 3.5m of CP-1 (35m)
  assert.match(step1.spokenGuidance, /CU 편의점 유리문에서 3시 방향으로 우회전하세요/);
});

test("KoreanSmartReader summarizes medicine, food expiry, and parcel labels", () => {
  const reader = new KoreanSmartReader();
  const med = reader.summarizeMedicine({
    timingSlot: "아침 식후",
    purposeSummary: "위장약 및 소염진통제",
    caution: "졸음을 유발할 수 있음",
  });
  assert.equal(
    med,
    "아침 식후에 복용하는 위장약 및 소염진통제 약입니다. 주의사항: 졸음을 유발할 수 있음.",
  );

  const validFood = reader.summarizeFoodExpiry({
    productName: "서울우유",
    expiryDateIso: "2026-11-18",
    referenceTodayIso: "2026-11-15T00:00:00Z",
    containerPositionHint: "위칸 오른쪽",
  });
  assert.equal(validFood.isExpired, false);
  assert.equal(validFood.daysRemaining, 3);
  assert.match(validFood.spokenKorean, /3일 남았습니다/);

  const expiredFood = reader.summarizeFoodExpiry({
    productName: "두부",
    expiryDateIso: "2026-11-12",
    referenceTodayIso: "2026-11-15T00:00:00Z",
  });
  assert.equal(expiredFood.isExpired, true);
  assert.match(expiredFood.spokenKorean, /3일 지났습니다/);

  // UC-15: Called taxi / wheelchair call taxi verification
  const taxiMatch = verifyCalledTaxiOrRideKo({
    expectedPlateNumber: "34바 5678",
    observedPlateNumber: "서울 34바 5678",
    vehicleColorKo: "흰색",
    vehicleModelKo: "쏘나타",
    doorDistanceMeters: 2.1,
  });
  assert.equal(taxiMatch.isMatch, true);
  assert.match(taxiMatch.spokenGuidance, /3걸음 앞에 뒷좌석 오른쪽 문 손잡이/);

  // UC-16: Grocery similar container / promo reader
  const grocery = reader.summarizeGroceryProductKo({
    productName: "코카콜라",
    variantOrFlavor: "레몬향 500ml",
    isZeroSugar: true,
    priceWon: 2000,
    promotionBadge: "1+1",
  });
  assert.match(grocery, /제로슈거/);
  assert.match(grocery, /1\+1 행사 상품/);

  // UC-17: Dining plate layout & fish bone warning
  const dining = reader.describeDiningPlateLayoutKo([
    { positionKo: "앞쪽 왼쪽", foodName: "흰쌀밥" },
    { positionKo: "위쪽 가운데", foodName: "고등어구이", hasBoneOrThorns: true },
  ]);
  assert.match(dining, /고등어구이 가시나 뼈가 있으니 주의하세요/);

  // UC-20: Flat induction residual heat burn warning
  const induction = reader.summarizeAppliancePanelKo({
    applianceType: "인덕션",
    activeCourseOrZone: "오른쪽 아래",
    powerLevelOrTemp: "7단계",
    hasResidualHeatWarning: true,
  });
  assert.match(induction, /잔열 표시가 떠서 뜨거우니 절대 손을 대지 마세요/);

  // UC-21 & UC-22: Restroom & social cue coaching
  const restroom = reader.describeRestroomAndStallKo({
    entranceGenderKo: "남자 화장실",
    entranceDirectionKo: "왼쪽",
    availableStallOrder: 2,
  });
  assert.match(restroom, /2번째 칸 문이 비어 있어요/);
});

test("VisualMemoryStore recalls household objects using clock-face spatial language", () => {
  const store = new VisualMemoryStore();
  store.seedDefaultHomeMemory();

  const found = store.findObjectKo("내 에어팟 어디 있어?");
  assert.equal(found.found, true);
  assert.match(found.spokenKorean, /소파 오른쪽 쿠션 아래, 2시 방향 팔 뻗을 거리\(70cm\) 앞 에어팟 케이스 있습니다/);

  const missing = store.findObjectKo("선글라스");
  assert.equal(missing.found, false);
});

test("PriorityAudioArbiter preempts P2 companion speech when P0 safety alert fires & supports Barge-in", () => {
  const sink = new MockAudioSink();
  const arbiter = new PriorityAudioArbiter(sink);

  assert.equal(
    arbiter.emit("관리비 고지서 설명 중입니다...", "P2_COMPANION"),
    true,
  );
  assert.equal(
    arbiter.emit("전방 2미터 킥보드!", "P0_SAFETY", "HAZARD_ALERT"),
    true,
  );
  assert.equal(sink.stopCount, 1);
  assert.equal(arbiter.getHistory()[0].interrupted, true);
  assert.equal(arbiter.emit("덜 중요한 안내", "P2_COMPANION"), false);

  assert.equal(arbiter.bargeIn("됐어"), true);
  assert.equal(sink.earcons.at(-1), "BARGE_IN_ACK");
});

test("Kiosk hand-to-button coaching guides relative centimeter movement", () => {
  const guide = coachFingertipToButtonKo({
    deltaXCm: 3.1,
    deltaYCm: -1.8,
    targetLabel: "아메리카노",
  });
  assert.equal(
    guide,
    "아메리카노 버튼까지 지금 손가락에서 오른쪽으로 3cm, 위로 2cm 이동해 누르세요.",
  );
});

test("Full day simulation covers all 23 Korean visually impaired use cases (UC-01 ~ UC-23)", () => {
  const timeline = runFullDaySimulation();
  assert.equal(timeline.length, 23);
  assert.equal(timeline[0].useCaseId, "UC-01");
  assert.equal(timeline[6].useCaseId, "UC-07");
  assert.equal(timeline[7].useCaseId, "UC-08");
  assert.equal(timeline[8].useCaseId, "UC-09");
  assert.equal(timeline[12].useCaseId, "UC-13");
  assert.equal(timeline[13].useCaseId, "UC-14");
  assert.equal(timeline[22].useCaseId, "UC-23");
});

test("macOS Keychain secret masking never exposes secret and GeminiVisionAgent connects or falls back cleanly", async () => {
  const key = getSecretFromKeychainOrEnv(
    KEYCHAIN_SERVICE_GEMINI,
    "GEMINI_API_KEY",
  );
  const meta = maskSecretMetadata(key);
  assert.equal(meta.configured, true);
  assert.equal(meta.prefix.endsWith("***"), true);

  const agent = new GeminiVisionAgent();
  const connectivity = await agent.checkConnectivity();
  assert.equal(connectivity.keyMetadata.configured, true);
  assert.ok(connectivity.sampleKoreanOutput && connectivity.sampleKoreanOutput.length > 0);
});

test("Seoul Subway TOPIS & Seoul Bus live APIs connect via macOS Keychain", async () => {
  const provider = new KoreaTransitProvider();
  const status = provider.getProviderStatus();
  assert.equal(status.seoulSubwayKey.configured, true);
  assert.equal(status.seoulBusKey.configured, true);

  const subLive = await provider.fetchSeoulSubwayArrivalLive({
    stationName: "교대",
    intendedDirectionStation: "강남",
  });
  assert.equal(subLive.source, "SEOUL_TOPIS_LIVE");
  assert.ok(subLive.arrivalMinutes >= 1);

  const busLive = await provider.fetchSeoulBusStopGuidanceLive({
    observedArsId: "22-001",
    targetRouteNumber: "140",
    intendedDirectionKeyword: "양재역",
  });
  assert.equal(busLive.source, "SEOUL_BUS_LIVE");
  assert.equal(busLive.isCorrectDirection, true);
  assert.match(busLive.spokenGuidance, /말죽거리공원사거리 정류장 맞습니다/);
});

test("Auto scene classifier parses [MODE] tags and assigns earcon & priority automatically", () => {
  const parsed = parseAutoSceneOutput(
    "[SUBWAY_PLATFORM] 2호선 교대 방면 승강장이며 현재 3-2번 스크린도어 앞입니다.",
  );
  assert.equal(parsed.detectedMode, "SUBWAY_PLATFORM");
  assert.equal(parsed.detectedModeLabelKo, "지하철 승강장 · 빠른 환승");
  assert.equal(parsed.priority, "P1_NAVIGATION");
  assert.equal(parsed.earcon, "TRANSIT_ARRIVING");
  assert.equal(
    parsed.cleanSpokenKorean,
    "2호선 교대 방면 승강장이며 현재 3-2번 스크린도어 앞입니다.",
  );
});

test("2-Layer StatefulSkillHarness maintains sticky state, assembles dynamic skill window, and runs Layer 2 skill post-processors", async () => {
  const harness = new StatefulSkillHarness(createKoreanSkillPlugins());
  assert.equal(harness.getStickyMode(), "WALKING_SAFETY");

  // Layer 1 active window for SUBWAY_PLATFORM should include WALKING_SAFETY (always P0), SUBWAY_PLATFORM, and TRANSFER_CORRIDOR
  harness.setStickyMode("SUBWAY_PLATFORM");
  const activeWindow = harness.getActiveCandidateSkillIds();
  assert.ok(activeWindow.includes("WALKING_SAFETY"));
  assert.ok(activeWindow.includes("SUBWAY_PLATFORM"));
  assert.ok(activeWindow.includes("TRANSFER_CORRIDOR"));
  assert.equal(activeWindow.includes("SMART_READER"), false);

  const dynamicPrompt = harness.assembleDynamicPrompt("지금 몇 번 문 앞이야?");
  assert.match(dynamicPrompt, /Sticky Mode: SUBWAY_PLATFORM/);

  const parsedHeader = parseStructuredHarnessOutput(
    "[SUBWAY_PLATFORM | line=2호선, nextStation=교대, door=3-2] 2호선 교대 방면 3-2번 문 앞입니다.",
  );
  assert.equal(parsedHeader.mode, "SUBWAY_PLATFORM");
  assert.equal(parsedHeader.slots.door, "3-2");
  assert.equal(parsedHeader.slots.nextStation, "교대");

  // LUM-17 & LUM-19: Invalid 'None' / '알수없음' slots must be rejected and converted into view-finding step/gaze coaching
  assert.equal(isValidObservedSlot("None"), false);
  assert.equal(isValidObservedSlot("알수없음"), false);
  const parsedNone = parseStructuredHarnessOutput(
    "[SUBWAY_PLATFORM | line=None, nextStation=None] None None 방면 승강장 맞습니다.",
  );
  assert.equal(parsedNone.slots.line, undefined);
  assert.equal(parsedNone.slots.nextStation, undefined);
  const subSkill = createKoreanSkillPlugins().find(
    (s) => s.id === "SUBWAY_PLATFORM",
  )!;
  const fixedSpeech = await subSkill.executePostProcess!({
    mode: "SUBWAY_PLATFORM",
    extractedSlots: parsedNone.slots,
    draftSpokenKorean: parsedNone.draftSpeech,
  });
  assert.doesNotMatch(fixedSpeech, /None/);
  assert.match(fixedSpeech, /3~4걸음 다가선 뒤 유리문 상단 표지판을 바라봐 주세요/);

  // LUM-20, LUM-26, LUM-27: Persistent Mission Context & Pre-Departure Transit Card Check
  const missionStart = harness.startMission("5호선 환승해서 여의도역 가기");
  assert.match(missionStart.openingAnnouncementKo, /교통카드/);
  assert.equal(missionStart.mission?.currentStageIndex, 1);
  const missionPrompt = harness.assembleDynamicPrompt();
  assert.match(missionPrompt, /5호선 환승해서 여의도역 가기/);
  assert.match(missionPrompt, /지금 걸어가시는 방향 그대로/);

  // LUM-45, LUM-49, LUM-50: Sanitize visual-only color instructions, duplicate stage prefix, and dead-end window/desk collision
  const sanitizedColor = sanitizeBlindFriendlySpeech(
    "[1/4단계(정류장·역사 진입)] [1/4단계(정류장·역사 진입)] 밝은 색상의 보행로를 따라 10걸음 이동하세요.",
  );
  assert.equal(sanitizedColor, "보행로를 따라 10걸음 이동하세요.");

  const sanitizedWindow = sanitizeBlindFriendlySpeech(
    "현재 실내 블라인드 창문 앞에 계십니다. 근처 이마트로 가기 위해 정면 직진 방향으로 5걸음 걸어 방을 나서서 현관으로 이동해 주세요.",
  );
  assert.match(sanitizedWindow, /제자리에서 뒤로 돌아서거나/);

  // LUM-46: Compass heading alignment coaching
  const oppositeHeading = coachHeadingAlignmentKo(0, 180);
  assert.equal(oppositeHeading.isAligned, false);
  assert.match(oppositeHeading.coachingKo, /뒤로\(180도\) 돌아서 주세요/);

  // LUM-52 & LUM-65: Conversational TTS sanitizer removes arrows, brackets, slashes, and decodes %EC% URL-encoded text
  const naturalSpeech = toNaturalSpokenKorean(
    "[1/4단계] %EA%B5%AC%EC%9D%98%EC%97%AD → 신반포역 [간선:360] 탑승 · 도보 150m 이동하세요.",
  );
  assert.doesNotMatch(naturalSpeech, /[→\[\]·\/%]/);
  assert.match(naturalSpeech, /구의역에서 신반포역 360번 탑승/);

  harness.appendConversationTurn("user", "에브리데이로 가자");
  harness.appendConversationTurn("assistant", "좋아요, 이마트에브리데이 쪽으로 안내할게요.");
  assert.equal(harness.getConversationHistory().length, 2);
});

test("TMAP live POI search (Recommended vs Distance + E-Mart Everyday expansion) and Pedestrian/Transit routing", async () => {
  const nav = new VisualPedestrianNavigator();
  const searchRes = await nav.searchDestinationCandidates({
    query: "이마트",
    originLat: 37.5006,
    originLng: 127.0364,
    sortMode: "RECOMMENDED",
  });

  assert.ok(searchRes.originAddressKo.includes("강남구"));
  assert.ok(searchRes.candidatesByRecommended.length >= 2);
  assert.ok(searchRes.candidatesByDistance.length >= 2);
  // Distance list must be strictly sorted by ascending meters
  assert.ok(
    searchRes.candidatesByDistance[0].straightDistanceMeters <=
      searchRes.candidatesByDistance[1].straightDistanceMeters,
  );
  // Brand expansion should surface E-Mart Everyday, E-Mart24, or E-Mart branches without parking sub-POIs
  assert.ok(
    searchRes.candidatesByRecommended.every(
      (c) => !c.name.includes("주차장"),
    ),
  );

  const routeRes = await nav.buildConfirmedPedestrianRoute({
    originAddressKo: searchRes.originAddressKo,
    originLat: 37.5006,
    originLng: 127.0364,
    destination: searchRes.candidatesByDistance[0],
  });
  assert.equal(routeRes.route.routeSource, "TMAP_PEDESTRIAN");
  assert.ok(routeRes.route.turnSteps.length >= 2);
  assert.match(routeRes.route.macroPlanOverviewKo, /전체 이동 계획을 먼저 말씀드릴게요/);
  assert.ok(routeRes.route.macroMilestones.length >= 2);

  // LUM-66: Searching "구의역" from Gangnam (radius=0) finds Guui Subway Line 2 Station as #1 and builds transit route
  const guuiSearch = await nav.searchDestinationCandidates({
    query: "구의역",
    originLat: 37.5006,
    originLng: 127.0364,
    sortMode: "RECOMMENDED",
  });
  assert.ok(guuiSearch.candidatesByRecommended.length >= 1);
  assert.match(guuiSearch.candidatesByRecommended[0].name, /구의역/);
  const guuiRoute = await nav.buildConfirmedPedestrianRoute({
    originAddressKo: guuiSearch.originAddressKo,
    originLat: 37.5006,
    originLng: 127.0364,
    destination: guuiSearch.candidatesByRecommended[0],
  });
  assert.ok(
    guuiRoute.route.routeSource === "TMAP_SUBWAY_AND_WALK" ||
      guuiRoute.route.routeSource === "TMAP_TRANSIT_AND_WALK",
  );
  assert.ok((guuiRoute.route.transitLegs?.length ?? 0) >= 2);

  // LUM-69: Conversational mode switch / non-place phrases must not hallucinate a fake POI, while multi-word place queries extract cleanly
  assert.equal(
    VisualPedestrianNavigator.extractCleanPlaceQuery(
      "아니 지하철로 대중교통 검색",
    ),
    "",
  );
  assert.equal(
    VisualPedestrianNavigator.extractCleanPlaceQuery(
      "거기 말고 조금 더 가까운 곳으로 가자",
    ),
    "",
  );
  assert.equal(
    VisualPedestrianNavigator.extractCleanPlaceQuery(
      "아까 말한 데 말고 건대입구역 근처 스타벅스 찾아줘",
    ),
    "건대입구역 스타벅스",
  );
  const multiWordSearch = await nav.searchDestinationCandidates({
    query: "아까 말한 데 말고 건대입구역 근처 스타벅스 찾아줘",
    originLat: 37.5404,
    originLng: 127.0692,
  });
  assert.ok(multiWordSearch.candidates.length >= 1);
  assert.match(multiWordSearch.candidates[0].name, /스타벅스/);
});

test("InferenceFeedbackStore skips already-processed feedback and preserves linearIssueId across device merges", () => {
  const tmpFile = path.join(
    os.tmpdir(),
    `lumo_fb_test_${Date.now()}.json`,
  );
  try {
    const store = new InferenceFeedbackStore(tmpFile);
    store.addInferenceRecord({
      id: "fb_already_done",
      timestampIso: "2026-11-15T10:00:00.000Z",
      deviceSource: "ANDROID_GLASS_APK",
      model: "gemini-3.5-flash-lite",
      latencyMs: 910,
      detectedMode: "BUS_STOP",
      detectedModeLabelKo: "버스 정류장 · 진입 버스",
      spokenKorean: "140번 버스 진입 중입니다.",
      vote: "DOWN",
      feedbackText: "버스 번호 오인식",
      linearIssueId: "LUM-99",
      linearIssueUrl: "https://linear.app/lumo-2026/issue/LUM-99",
    });

    store.addInferenceRecord({
      id: "fb_new_unprocessed",
      timestampIso: "2026-11-15T10:05:00.000Z",
      deviceSource: "ANDROID_GLASS_APK",
      model: "gemini-3.5-flash-lite",
      latencyMs: 1020,
      detectedMode: "WALKING_SAFETY",
      detectedModeLabelKo: "보행 안전 · 장애물 감지",
      spokenKorean: "전방 3걸음 앞 볼라드가 있습니다.",
      vote: "DOWN",
      feedbackText: "볼라드가 아니라 공유 킥보드였음",
    });

    // Simulate re-pulling from device where device copy doesn't have linearIssueId yet
    store.mergeDeviceRecords([
      {
        id: "fb_already_done",
        timestampIso: "2026-11-15T10:00:00.000Z",
        deviceSource: "ANDROID_GLASS_APK",
        model: "gemini-3.5-flash-lite",
        latencyMs: 910,
        detectedMode: "BUS_STOP",
        detectedModeLabelKo: "버스 정류장 · 진입 버스",
        spokenKorean: "140번 버스 진입 중입니다.",
        vote: "DOWN",
        feedbackText: "버스 번호 오인식",
      },
    ]);

    const unprocessed = store.getUnprocessedActionableFeedback();
    assert.equal(unprocessed.length, 1);
    assert.equal(unprocessed[0].id, "fb_new_unprocessed");
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test("Companion Web Server HTTP API endpoints respond accurately", async () => {
  const tmpStorePath = path.join(
    os.tmpdir(),
    `lumo_srv_fb_${Date.now()}.json`,
  );
  const server = createCompanionServer(tmpStorePath);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const statusRes = await fetch(`${baseUrl}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as any;
    assert.equal(statusJson.dailyTimeline.length, 23);
    assert.equal(
      statusJson.transitCoverage.activeRegionScope,
      "SEOUL_METROPOLITAN",
    );
    assert.equal(
      statusJson.transitCoverage.nationwideTagoScope,
      "BACKLOG_PHASE_2",
    );
    assert.ok(
      LUMO_LINEAR_TICKETS.some(
        (t) => t.key === "LUMO-104" && t.phase === "PHASE_1_SEOUL_POC",
      ),
    );
    assert.ok(
      LUMO_LINEAR_TICKETS.some(
        (t) => t.key === "LUMO-201" && t.phase === "PHASE_2_BACKLOG",
      ),
    );

    const subRes = await fetch(`${baseUrl}/api/transit/subway-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentLine: "2호선",
        intendedDirectionStation: "교대",
        observedNextStationOnSign: "교대",
        observedScreenDoor: "3-2",
        transferStationName: "교대역",
        transferTargetLine: "3호선",
      }),
    });
    assert.equal(subRes.status, 200);
    const subJson = (await subRes.json()) as any;
    assert.equal(subJson.platformResult.isCorrectPlatform, true);
    assert.equal(subJson.platformResult.doorOffsetCount, 9);
    assert.equal(subJson.corridorSteps.length, 2);

    const busRes = await fetch(`${baseUrl}/api/transit/bus-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        observedArsId: "22-001",
        targetRouteNumber: "472",
        intendedDirectionKeyword: "강남역",
      }),
    });
    assert.equal(busRes.status, 200);
    const busJson = (await busRes.json()) as any;
    assert.equal(busJson.result.isCorrectDirection, true);

    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /AI 답변: OFF/);

    const syncRes = await fetch(`${baseUrl}/api/feedback/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: [
          {
            id: "test_inf_1",
            timestampIso: "2026-11-15T12:00:00.000Z",
            deviceSource: "ANDROID_GLASS_APK",
            model: "gemini-3.5-flash-lite",
            latencyMs: 980,
            detectedMode: "SUBWAY_PLATFORM",
            detectedModeLabelKo: "지하철 승강장 · 빠른 환승",
            spokenKorean: "2호선 교대 방면 3-2번 문 앞입니다.",
            vote: "DOWN",
            feedbackText: "문 번호는 맞는데 환승 계단 방향 설명이 부족함",
          },
        ],
      }),
    });
    assert.equal(syncRes.status, 200);

    const logsRes = await fetch(`${baseUrl}/api/feedback/logs`);
    const logsJson = (await logsRes.json()) as any;
    const foundLog = logsJson.logs.find((l: any) => l.id === "test_inf_1");
    assert.ok(foundLog);
    assert.equal(foundLog.vote, "DOWN");
    assert.equal(foundLog.detectedMode, "SUBWAY_PLATFORM");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (fs.existsSync(tmpStorePath)) fs.unlinkSync(tmpStorePath);
  }
});
