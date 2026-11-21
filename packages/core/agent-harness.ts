import type { EarconType, SpeechPriority } from "../hardware-adapters/interfaces.ts";
import type { AutoDetectedSceneMode, GeminiVisionAgent } from "./gemini-vision-agent.ts";

export type UserJourneyPhase =
  | "PHASE_1_PLANNING_CONVERSATION"
  | "PHASE_2_AWAITING_PLAN_CONFIRM"
  | "PHASE_3_ACTIVE_MISSION_GUIDANCE";

export interface ActiveMissionState {
  goalText: string;
  journeyPhase: UserJourneyPhase;
  originAddressKo?: string;
  destinationAddressKo?: string;
  totalDistanceMeters?: number;
  macroPlanOverviewKo?: string;
  macroMilestones?: string[];
  nextTurnInstructionKo?: string;
  compassCoachingKo?: string;
  currentStageIndex: number; // 1..4
  totalStages: number;
  stageLabelKo: string;
  startedAtIso: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  timestampIso: string;
}

/**
 * Converts any raw LLM or navigation string into natural, symbol-free spoken Korean suitable for TTS.
 * - Strips brackets `[...]`, arrows `→`/`->`, slashes `/`, middle dots `·`, and parenthetical code dumps
 * - Prevents screen-reader-like mechanical reading ("대괄호", "오른쪽 화살표", "슬래시" 등 원천 제거)
 */
export function toNaturalSpokenKorean(rawSpeech: string): string {
  let decoded = rawSpeech;
  if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {}
  }

  let text = decoded
    // Preserve subway line info like [수도권2호선] -> 2호선
    .replace(/\[(?:수도권|서울|부산|대구|대전|광주)?(\d+호선|신분당선|경의중앙선|수인분당선|공항철도)\]/g, " $1 ")
    .replace(/\[(?:간선|지선|광역|마을|수도권)\s*:\s*([^\]]+)\]/g, "$1번 ")
    .replace(/\[[^\]]*\]/g, " ")
    // Replace arrows with natural Korean connectors (avoiding duplicate "에서 에서")
    .replace(/에서\s*(?:→|->|▶|➔|⇒)\s*/g, "에서 ")
    .replace(/\s*(?:→|->|▶|➔|⇒)\s*/g, "에서 ")
    // Convert numeric ranges like 3~4걸음 into natural Korean
    .replace(/(\d+)\s*~\s*(\d+)/g, "$1~$2")
    // Remove parenthetical technical notes like (남동쪽 680m), (180도), (약 64걸음) -> keep natural text
    .replace(/\(([^)]+)\)/g, ", $1, ")
    // Remove symbols that TTS reads awkwardly
    .replace(/[·|•*#"`_]/g, " ")
    .replace(/(\d+)\s*\/\s*(\d+)단계/g, "$2단계 중 $1단계")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/^,\s*|\s*,$/g, "")
    .trim();

  // Replace sight-dependent color/light instructions (LUM-45, LUM-75)
  text = text
    .replace(/밝은\s*색상의?\s*보행로/g, "보행로")
    .replace(/어두운\s*색상의?\s*보행로/g, "보행로")
    .replace(/(?:초록빛|파란빛|노란빛|붉은빛)\s*조명이\s*보이는\s*/g, "")
    .replace(/플랫폼의?\s*노란\s*안전선/g, "승강장 안전선")
    .replace(/노란색\s*점자블록/g, "발바닥으로 느껴지는 점자블록");

  // LUM-86: Visually impaired passengers stand safely holding a handrail near the door rather than hunting for empty seats
  text = text.replace(
    /자리가\s*비어\s*있다면\s*조심히\s*앉아서\s*다음\s*안내를\s*기다려\s*볼까요\??/g,
    "출입문 옆 손잡이를 안전하게 잡고 계세요.",
  );

  // LUM-49 & LUM-50 vs LUM-79 & LUM-89: Dead-end indoor window/desk collision guard ONLY applies in indoor rooms, NEVER inside a subway train!
  const isInsideTrain = /지하철|열차|객차|정거장|승강장|출입문|손잡이/.test(text);
  const hasDeadEndAhead =
    /(창문|블라인드|책상|모니터|벽면)\s*(앞에\s*계십니다|앞입니다|보입니다|있어요|있습니다|이라\s*막혀)/.test(
      text,
    );
  const tellsWalkForward = /(정면|직진|뒤로\s*돌아).*?(걸어|이동해|가|나가|나서|현관|환승)/.test(
    text,
  );
  if (isInsideTrain && /(바로\s*앞은\s*(?:지하철\s*)?창문이라\s*막혀|창문에서\s*몸을\s*돌려)/.test(text)) {
    return "현재 지하철 열차 안 출입문 앞에 안전하게 서 계시네요. 손잡이를 잘 잡고 목적지 역 도착 안내를 기다려 주세요.";
  }
  if (!isInsideTrain && hasDeadEndAhead && tellsWalkForward) {
    return "지금 바로 앞은 창문이나 책상으로 막혀 있어서 그대로 걸어가면 부딪혀요. 제자리에서 뒤로 돌아서거나 몸을 천천히 돌려서 방문 쪽을 먼저 비춰 보실래요?";
  }

  return text;
}

export function sanitizeBlindFriendlySpeech(rawSpeech: string): string {
  return toNaturalSpokenKorean(rawSpeech);
}

export interface SkillObservation {
  mode: AutoDetectedSceneMode;
  extractedSlots: Record<string, string>;
  draftSpokenKorean: string;
  userQuery?: string;
  activeMission?: ActiveMissionState | null;
}

export interface LumoSkillPlugin {
  id: AutoDetectedSceneMode;
  labelKo: string;
  triggerDescriptionKo: string;
  extractionRulesKo: string;
  relatedSkillIds: readonly AutoDetectedSceneMode[];
  priority: SpeechPriority;
  earcon: EarconType;
  executePostProcess?: (obs: SkillObservation) => Promise<string> | string;
}

export interface HarnessStepResult {
  ok: boolean;
  model: string;
  detectedMode: AutoDetectedSceneMode;
  detectedModeLabelKo: string;
  previousStickyMode: AutoDetectedSceneMode;
  activeCandidateSkills: AutoDetectedSceneMode[];
  extractedSlots: Record<string, string>;
  activeMission?: ActiveMissionState | null;
  priority: SpeechPriority;
  earcon: EarconType;
  spokenKorean: string;
  latencyMs: number;
}

const GLOBAL_SAFETY_SKILL_ID: AutoDetectedSceneMode = "WALKING_SAFETY";

const INVALID_SLOT_VALUES = new Set([
  "none",
  "null",
  "undefined",
  "n/a",
  "unknown",
  "알수없음",
  "알 수 없음",
  "미상",
  "없음",
  "?",
  "-",
]);

export function isValidObservedSlot(val?: string | null): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (trimmed.length === 0) return false;
  return !INVALID_SLOT_VALUES.has(trimmed.toLowerCase());
}

/**
 * Parses single-pass VLM output formatted as:
 * `[SUBWAY_PLATFORM | station=교대, door=3-2] 2호선 교대 방면 승강장입니다.`
 */
export function parseStructuredHarnessOutput(
  rawText: string,
  fallbackMode: AutoDetectedSceneMode = "INDOOR_SPACE",
): {
  mode: AutoDetectedSceneMode;
  slots: Record<string, string>;
  draftSpeech: string;
} {
  const cleaned = rawText.replace(/\*\*/g, "").trim();
  const headerMatch = cleaned.match(
    /^\[(WALKING_SAFETY|STEP_AND_GLASS_DOOR|CROSSWALK_SIGNAL|BUS_STOP|TAXI_MATCHER|SUBWAY_PLATFORM|SUBWAY_ON_BOARD|TRANSFER_CORRIDOR|RESTROOM_AND_SEAT|KIOSK_COACH|APPLIANCE_SAFETY|SMART_READER|GROCERY_SCANNER|DINING_ASSISTANT|INDOOR_SPACE|SOCIAL_MEETING|NAV_CONTROL)(?:\s*\|\s*([^\]]+))?\]\s*(.*)$/s,
  );

  const slots: Record<string, string> = {};
  if (headerMatch) {
    const mode = headerMatch[1] as AutoDetectedSceneMode;
    const rawSlots = headerMatch[2]?.trim();
    if (rawSlots) {
      for (const pair of rawSlots.split(",")) {
        const [k, ...rest] = pair.split("=");
        if (k && rest.length > 0) {
          const v = rest.join("=").trim();
          if (isValidObservedSlot(v)) {
            slots[k.trim()] = v;
          }
        }
      }
    }
    const draftSpeech = headerMatch[3]?.trim() || cleaned;
    return { mode, slots, draftSpeech };
  }

  let inferredMode: AutoDetectedSceneMode = fallbackMode;
  if (/킥보드|장애물|볼라드|단차|위험/.test(cleaned)) {
    inferredMode = "WALKING_SAFETY";
  } else if (/신호등|횡단보도|녹색|적색/.test(cleaned)) {
    inferredMode = "CROSSWALK_SIGNAL";
  } else if (/버스|정류장|정류소/.test(cleaned)) {
    inferredMode = "BUS_STOP";
  } else if (/승강장|스크린도어|호차|열차/.test(cleaned)) {
    inferredMode = "SUBWAY_PLATFORM";
  } else if (/환승|계단|에스컬레이터|표지판/.test(cleaned)) {
    inferredMode = "TRANSFER_CORRIDOR";
  } else if (/키오스크|버튼|손가락|결제/.test(cleaned)) {
    inferredMode = "KIOSK_COACH";
  } else if (/약봉지|고지서|유통기한|소비기한|택배|메뉴/.test(cleaned)) {
    inferredMode = "SMART_READER";
  }

  const doorMatch = cleaned.match(/(\d{1,2}-\d)/);
  if (doorMatch) {
    slots.door = doorMatch[1];
  }
  const arsMatch = cleaned.match(/(\d{2}-\d{3}|\b\d{5}\b)/);
  if (arsMatch) {
    slots.arsId = arsMatch[1];
  }

  return { mode: inferredMode, slots, draftSpeech: cleaned };
}

const STAGE_LABELS: Record<number, string> = {
  1: "1/4단계: 정류장·역사 진입 및 보행 이동",
  2: "2/4단계: 정류장·승강장 방면 및 탑승 위치 확인",
  3: "3/4단계: 대중교통 탑승 및 환승 통로 이동",
  4: "4/4단계: 목적지 주변 도착 마무리",
};

export class StatefulSkillHarness {
  private readonly skills = new Map<AutoDetectedSceneMode, LumoSkillPlugin>();
  private stickyMode: AutoDetectedSceneMode = "WALKING_SAFETY";
  private lastSpokenKorean = "";
  private activeMission: ActiveMissionState | null = null;
  private readonly conversationHistory: ConversationTurn[] = [];

  constructor(initialSkills: readonly LumoSkillPlugin[] = []) {
    for (const sk of initialSkills) {
      this.registerSkill(sk);
    }
  }

  appendConversationTurn(role: "user" | "assistant", text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.conversationHistory.push({
      role,
      text: clean,
      timestampIso: new Date().toISOString(),
    });
    if (this.conversationHistory.length > 8) {
      this.conversationHistory.shift();
    }
  }

  getConversationHistory(): readonly ConversationTurn[] {
    return this.conversationHistory;
  }

  registerSkill(skill: LumoSkillPlugin): void {
    this.skills.set(skill.id, skill);
  }

  getRegisteredSkills(): LumoSkillPlugin[] {
    return Array.from(this.skills.values());
  }

  getStickyMode(): AutoDetectedSceneMode {
    return this.stickyMode;
  }

  setStickyMode(mode: AutoDetectedSceneMode): void {
    this.stickyMode = mode;
  }

  getActiveMission(): ActiveMissionState | null {
    return this.activeMission;
  }

  /**
   * Sets a persistent user goal/mission (LUM-20, LUM-26, LUM-27) and returns a pre-departure checklist announcement
   * including a transit payment card check.
   */
  startMission(goalText: string): {
    mission: ActiveMissionState | null;
    openingAnnouncementKo: string;
  } {
    const clean = goalText.trim();
    if (!clean) {
      this.activeMission = null;
      return {
        mission: null,
        openingAnnouncementKo: "진행 중인 목적지 미션을 종료했습니다.",
      };
    }

    this.activeMission = {
      goalText: clean,
      journeyPhase: "PHASE_3_ACTIVE_MISSION_GUIDANCE",
      currentStageIndex: 1,
      totalStages: 4,
      stageLabelKo: STAGE_LABELS[1],
      startedAtIso: new Date().toISOString(),
    };

    return {
      mission: this.activeMission,
      openingAnnouncementKo: `${clean} 쪽으로 안내해 드릴게요. 출발하기 전에 교통카드나 결제할 카드는 챙기셨죠? 이제 걸어가시는 방향을 보면서 편하게 말씀해 주세요.`,
    };
  }

  private updateMissionProgressForMode(mode: AutoDetectedSceneMode): void {
    if (!this.activeMission) return;
    if (
      (mode === "BUS_STOP" || mode === "SUBWAY_PLATFORM") &&
      this.activeMission.currentStageIndex < 2
    ) {
      this.activeMission.currentStageIndex = 2;
      this.activeMission.stageLabelKo = STAGE_LABELS[2];
    } else if (
      mode === "TRANSFER_CORRIDOR" &&
      this.activeMission.currentStageIndex < 3
    ) {
      this.activeMission.currentStageIndex = 3;
      this.activeMission.stageLabelKo = STAGE_LABELS[3];
    }
  }

  /**
   * Context-Gated Micro-Skill Router:
   * Even as total Micro-Skills scale to 17+ (covering all 23 Use Cases), this gate selects AT MOST 4
   * mutually compatible Micro-Skills for the current frame/query so prompt size stays constant
   * and unrelated Use Cases never interfere with each other!
   */
  getActiveCandidateSkillIds(userQuery?: string): AutoDetectedSceneMode[] {
    const activeSet = new Set<AutoDetectedSceneMode>();
    const q = (userQuery ?? "").trim();

    if (q) {
      if (/계단|단차|유리문/.test(q)) activeSet.add("STEP_AND_GLASS_DOOR");
      if (/신호등|횡단보도|초록불|빨간불/.test(q)) activeSet.add("CROSSWALK_SIGNAL");
      if (/택시|장콜|번호판|승차문/.test(q)) activeSet.add("TAXI_MATCHER");
      if (/버스|정류장/.test(q)) activeSet.add("BUS_STOP");
      if (/승강장|스크린도어|빠른\s*환승|방면/.test(q)) activeSet.add("SUBWAY_PLATFORM");
      if (/열차\s*안|정거장|하차문|내릴/.test(q)) activeSet.add("SUBWAY_ON_BOARD");
      if (/환승\s*통로|출구/.test(q)) activeSet.add("TRANSFER_CORRIDOR");
      if (/화장실|빈\s*칸|세면대|빈\s*좌석|빈자리|카페/.test(q)) activeSet.add("RESTROOM_AND_SEAT");
      if (/엘리베이터|키오스크|버튼|몇\s*cm/.test(q)) activeSet.add("KIOSK_COACH");
      if (/인덕션|잔열|화구|정수기|온수|세탁기|전자레인지|가전/.test(q)) activeSet.add("APPLIANCE_SAFETY");
      if (/약봉지|안약|소비기한|유통기한|고지서|택배/.test(q)) activeSet.add("SMART_READER");
      if (/마트|편의점|1\+1|제로|가격|맛|음료|상품/.test(q)) activeSet.add("GROCERY_SCANNER");
      if (/반찬|식탁|접시|식판|가시|밥|식사/.test(q)) activeSet.add("DINING_ASSISTANT");
      if (/기억|에어팟|안경|열쇠|지갑|옷|얼룩|복장/.test(q)) activeSet.add("INDOOR_SPACE");
      if (/명함|악수|슬라이드|회의|발표/.test(q)) activeSet.add("SOCIAL_MEETING");
    }

    if (this.stickyMode !== "SUBWAY_ON_BOARD") {
      activeSet.add(GLOBAL_SAFETY_SKILL_ID);
    }
    if (activeSet.size < 4) {
      activeSet.add(this.stickyMode);
    }
    const currentSkill = this.skills.get(this.stickyMode);
    if (currentSkill) {
      for (const rel of currentSkill.relatedSkillIds) {
        if (activeSet.size >= 4) break;
        activeSet.add(rel);
      }
    }
    if (this.activeMission && activeSet.size < 4) {
      for (const mMode of ["SUBWAY_PLATFORM", "TRANSFER_CORRIDOR", "BUS_STOP"] as AutoDetectedSceneMode[]) {
        if (activeSet.size >= 4) break;
        activeSet.add(mMode);
      }
    }
    return Array.from(activeSet).slice(0, 4);
  }

  assembleDynamicPrompt(userQuery?: string): string {
    const activeIds = new Set(this.getActiveCandidateSkillIds(userQuery));
    const activeBlocks: string[] = [];
    const fallbackTriggers: string[] = [];

    for (const skill of this.skills.values()) {
      if (activeIds.has(skill.id)) {
        activeBlocks.push(
          `• [${skill.id}] (${skill.labelKo}): ${skill.triggerDescriptionKo}\n  - 세부 규칙: ${skill.extractionRulesKo}`,
        );
      } else {
        fallbackTriggers.push(
          `• [${skill.id}]: ${skill.triggerDescriptionKo}`,
        );
      }
    }

    const lines = [
      `[Layer 1: 상태 유지형 스킬 라우터 | 직전 상황: ${this.stickyMode}]`,
      `당신은 시각장애인 사용자의 옆에서 함께 걸으며 대화하는 다정한 AI 동반자 '루모'입니다 (Gemini Live / Pickle 스타일).`,
      `카메라 시야를 보고 맨 앞에만 시스템용 \`[모드ID | 키=값]\` 헤더를 적고, 그 뒤에 이어지는 문장은 **기계적인 스크린 리더기가 아니라 옆에 있는 친구/길동무가 말하듯 자연스러운 구어체(~해요, ~있어요, ~할까요?)로 짧게 1~2문장(70자 내외)**만 작성하세요.`,
      `⚠️ [절대 지켜야 할 대화형 음성 UX 규칙]:`,
      `1. **기호·화살표·괄호 절대 금지**: 음성으로 읽힐 본문에는 \`→\`, \`[\`, \`]\`, \`(\`, \`)\`, \`·\`, \`/\` 같은 기호나 '1/4단계' 같은 딱딱한 보고서 말머리를 절대 쓰지 마세요.`,
      `2. **시계 방향('12시 방향') 및 색상 지시('밝은 색 보도') 절대 금지**: 대신 "지금 걸어가시는 방향 그대로 다섯 걸음만 직진해 보세요", "오른쪽으로 살짝 비켜가 볼까요?"처럼 자연스럽게 말하세요.`,
      `3. **창문/책상/벽 앞 충돌 방지 (LUM-49/50)**: 정면에 창문, 블라인드, 책상, 벽이 보이면 절대 앞으로 걸어 나가라고 하지 마세요! "어이쿠, 바로 앞은 창문(또는 책상)이라 막혀 있어요. 뒤로 돌아서서 방문 쪽을 먼저 비춰 보실래요?"라고 다정하게 말려주세요.`,
      `4. **엘리베이터 층수 코칭 (LUM-47)**: 외출 중 엘리베이터 버튼이 보이면 닫힘 버튼보다 먼저 1층 버튼에 불이 들어와 있는지 봐주고, 안 눌려 있으면 "일단 1층 버튼부터 눌러볼까요? 지금 손에서 조금만 아래로 내려보세요"처럼 대화하듯 코칭하세요.`,
    ];

    if (this.conversationHistory.length > 0) {
      lines.push(
        `\n💬 [최근 사용자와의 대화 맥락 (티키타카 유지)]:`,
        ...this.conversationHistory
          .slice(-5)
          .map((t) => `  - ${t.role === "user" ? "사용자" : "루모"}: "${t.text}"`),
      );
    }

    if (this.activeMission) {
      const navExtra = [
        this.activeMission.originAddressKo
          ? `출발지: ${this.activeMission.originAddressKo}`
          : "",
        this.activeMission.destinationAddressKo
          ? `확정 목적지: ${this.activeMission.destinationAddressKo}`
          : "",
        this.activeMission.nextTurnInstructionKo
          ? `실제 보행자 도로 경로 지침: ${this.activeMission.nextTurnInstructionKo}`
          : "",
        this.activeMission.compassCoachingKo
          ? `나침반 방위각 정렬: ${this.activeMission.compassCoachingKo}`
          : "",
      ]
        .filter(Boolean)
        .join(" | ");

      lines.push(
        `\n🎯 [최우선 사용자 내비게이션 미션]: "${this.activeMission.goalText}" (${this.activeMission.stageLabelKo})`,
        navExtra ? `- [실시간 GPS/경로 컨텍스트]: ${navExtra}` : "",
        `- 위 실제 보행자 경로 지침과 카메라 시야의 보행 안전 요소를 결합해 안내하세요. (단, 문장 앞에 '[1/4단계]' 같은 말머리를 직접 붙이지 마세요. 시스템이 자동으로 1회만 붙입니다.)`,
      );
    }

    lines.push(
      ``,
      `[우선 활성 스킬 규칙 (상세 지침 적용)]:`,
      ...activeBlocks,
      ``,
      `[상황 급변 시 즉시 전환 가능한 타 스킬]:`,
      ...fallbackTriggers,
    );

    if (this.lastSpokenKorean) {
      lines.push(
        `\n[중복 방지]: 직전 발화("${this.lastSpokenKorean}")와 동일한 내용 반복을 피하고 새로 보이는 변화나 핵심 정보를 안내하세요.`,
      );
    }

    if (userQuery?.trim()) {
      lines.push(`\n[사용자 음성/텍스트 요청]: ${userQuery.trim()}`);
    } else {
      lines.push(
        `\n[요청]: 현재 1인칭 카메라 시야를 분석하여 가장 알맞은 [모드ID]와 안내 문장을 출력하세요.`,
      );
    }

    return lines.join("\n");
  }

  async stepFrame(
    visionAgent: GeminiVisionAgent,
    params: {
      imageBase64?: string;
      imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
      userQuery?: string;
    },
  ): Promise<HarnessStepResult> {
    const previousStickyMode = this.stickyMode;
    const activeCandidateSkills = this.getActiveCandidateSkillIds();
    const dynamicPrompt = this.assembleDynamicPrompt(params.userQuery);

    const vlmRes = await visionAgent.generateVisionBriefing({
      userPrompt: dynamicPrompt,
      imageBase64: params.imageBase64,
      imageMimeType: params.imageMimeType ?? "image/jpeg",
    });

    const parsed = parseStructuredHarnessOutput(
      vlmRes.spokenKorean,
      previousStickyMode,
    );
    this.stickyMode = parsed.mode;
    this.updateMissionProgressForMode(parsed.mode);

    const matchedSkill = this.skills.get(parsed.mode);
    let finalSpeech = parsed.draftSpeech;

    if (matchedSkill?.executePostProcess) {
      try {
        finalSpeech = await matchedSkill.executePostProcess({
          mode: parsed.mode,
          extractedSlots: parsed.slots,
          draftSpokenKorean: parsed.draftSpeech,
          userQuery: params.userQuery,
          activeMission: this.activeMission,
        });
      } catch {
        finalSpeech = parsed.draftSpeech;
      }
    }

    finalSpeech = toNaturalSpokenKorean(finalSpeech);
    if (params.userQuery?.trim()) {
      this.appendConversationTurn("user", params.userQuery.trim());
    }
    this.appendConversationTurn("assistant", finalSpeech);
    this.lastSpokenKorean = finalSpeech;

    return {
      ok: vlmRes.ok,
      model: vlmRes.model,
      detectedMode: parsed.mode,
      detectedModeLabelKo: matchedSkill?.labelKo ?? parsed.mode,
      previousStickyMode,
      activeCandidateSkills,
      extractedSlots: parsed.slots,
      activeMission: this.activeMission,
      priority: matchedSkill?.priority ?? "P2_COMPANION",
      earcon: matchedSkill?.earcon ?? "TARGET_FOUND",
      spokenKorean: finalSpeech,
      latencyMs: vlmRes.latencyMs,
    };
  }
}
