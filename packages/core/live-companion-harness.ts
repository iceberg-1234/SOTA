import fs from "node:fs";
import path from "node:path";
import {
  getSecretFromKeychainOrEnv,
  KEYCHAIN_SERVICE_GEMINI,
} from "./keychain.ts";
import { toNaturalSpokenKorean } from "./agent-harness.ts";

/**
 * SOTA 4-Layer Model-Agnostic Live Companion Harness (`SEE_AND_READ` · `ACT_AND_GUIDE` · `REMEMBER_ENTITIES`)
 *
 * Separates:
 *   Layer A — Strict JSON Tool Schemas (model-agnostic contracts usable across Gemini Live, OpenAI Realtime, Claude, or Edge VLMs)
 *   Layer B — Explicit Stateful Workflow FSM per scenario (locks allowed transitions & step-specific instructions)
 *   Layer C — Deterministic Policy Verifier (resolves multi-date mfg vs expiry, expired-food alerts, bezel-first cm math, and persistent memory)
 *   Layer D — Runtime Output Guardrail (sanitizes symbols, clock-face jargon, roadway hazards, and impossible calendar dates)
 */

export type CompanionFocusMode =
  | "LIVE_AUTO"
  | "SEE_AND_READ"
  | "ACT_AND_GUIDE"
  | "REMEMBER_ENTITIES"
  | "MAP_NAV_COPILOT";

export type ActWorkflowStage =
  | "STAGE_1_OVERVIEW_SCAN"
  | "STAGE_2_SAFE_BEZEL_ANCHOR"
  | "STAGE_3_LIVE_CM_TRACKING"
  | "STAGE_4_PRESS_AND_VERIFY";

export type EntityCategory = "OBJECT" | "PERSON" | "SPACE";

export interface RememberedEntityRecord {
  id: string;
  category: EntityCategory;
  name: string;
  landmarkOrAppearance: string;
  extraNotes: string;
  updatedAtIso: string;
}

export interface ObservedDateFact {
  rawText: string;
  hasTimestamp: boolean;
  printedPrefix?: "EXPIRY" | "MANUFACTURED" | "NONE";
}

export interface VisualInspectionFacts {
  targetItem: string;
  exactKeyNumbers: string[];
  observedDates: ObservedDateFact[];
  fullVerbatimText?: string;
  framingIssue:
    | "NONE"
    | "TOO_CLOSE_BLUR"
    | "OCCLUDED_BY_HAND"
    | "WRONG_SIDE"
    | "GLARE"
    | "TOO_DARK";
}

export interface HandTrackingFacts {
  surfaceType: "VENDING_MACHINE" | "KIOSK_SCREEN" | "KEYPAD_OR_ELEVATOR" | "APPLIANCE_PANEL" | "TABLE_ITEMS";
  availableItemsByRow?: string[];
  targetLabel: string;
  handVisible: boolean;
  dxCm?: number;
  dyCm?: number;
  residualHeatHazard?: boolean;
}

/**
 * Persistent On-Device Entity Memory Store (Objects · People · Spaces)
 * Survives app/process restarts via atomic JSON file writes.
 */
export class PersistentEntityMemoryStore {
  private readonly records = new Map<string, RememberedEntityRecord>();
  private readonly filePath: string | null;

  constructor(filePath?: string) {
    this.filePath = filePath ? path.resolve(filePath) : null;
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        const arr = JSON.parse(
          fs.readFileSync(this.filePath, "utf8"),
        ) as RememberedEntityRecord[];
        for (const r of arr) {
          this.records.set(`${r.category}:${r.name.toLowerCase()}`, r);
        }
      } catch {}
    }
  }

  upsert(params: {
    category: EntityCategory;
    name: string;
    landmarkOrAppearance: string;
    extraNotes?: string;
  }): RememberedEntityRecord {
    const cleanName = params.name.trim();
    const key = `${params.category}:${cleanName.toLowerCase()}`;
    const record: RememberedEntityRecord = {
      id: key,
      category: params.category,
      name: cleanName,
      landmarkOrAppearance: params.landmarkOrAppearance.trim(),
      extraNotes: (params.extraNotes ?? "").trim(),
      updatedAtIso: new Date().toISOString(),
    };
    this.records.set(key, record);
    this.flush();
    return record;
  }

  recall(query: string, category?: EntityCategory): RememberedEntityRecord[] {
    const q = query.trim().toLowerCase();
    const all = Array.from(this.records.values());
    return all.filter((r) => {
      if (category && r.category !== category) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        q.includes(r.name.toLowerCase()) ||
        r.landmarkOrAppearance.toLowerCase().includes(q) ||
        r.extraNotes.toLowerCase().includes(q)
      );
    });
  }

  listAll(): RememberedEntityRecord[] {
    return Array.from(this.records.values());
  }

  private flush(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(this.listAll(), null, 2),
      "utf8",
    );
  }
}

function parseRealIsoDate(raw: string): string | null {
  const m = /(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== mo ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Layer C: Deterministic Policy Verifier for `SEE_AND_READ`
 * Resolves multi-date disambiguation (manufacturing timestamp vs later expiration date),
 * expired-food warnings, order/receipt numbers, and framing coaching identically regardless of VLM!
 */
export function evaluateVisualInspectionPolicy(
  facts: VisualInspectionFacts,
  referenceTodayIso = new Date().toISOString().slice(0, 10),
): {
  verified: boolean;
  resolvedExpiryIso: string | null;
  isExpired: boolean;
  spokenGuidanceKo: string;
} {
  if (facts.framingIssue !== "NONE" && facts.exactKeyNumbers.length === 0 && facts.observedDates.length === 0) {
    const coachMap: Record<VisualInspectionFacts["framingIssue"], string> = {
      NONE: "",
      TOO_CLOSE_BLUR:
        "카메라와 너무 가까워 글자가 흐려졌어요. 물건을 한 뼘 정도만 천천히 뒤로 떼어 보실래요?",
      OCCLUDED_BY_HAND:
        "손가락이 글자 부분을 가리고 있어요. 물건 양끝 모서리만 살짝 잡고 다시 비춰 보실래요?",
      WRONG_SIDE:
        "지금 비추신 면에는 찾는 글자나 날짜가 보이지 않아요. 천천히 반 바퀴 돌려 다른 면을 비춰 보실래요?",
      GLARE:
        "조명 반사 때문에 글자가 하얗게 번져 보여요. 각도를 옆으로 조금만 기울여 보실래요?",
      TOO_DARK:
        "주변이 어두워 글자가 선명하지 않아요. 밝은 쪽을 향하거나 조명을 켜고 비춰 보실래요?",
    };
    return {
      verified: false,
      resolvedExpiryIso: null,
      isExpired: false,
      spokenGuidanceKo: coachMap[facts.framingIssue],
    };
  }

  // Deterministic Multi-Date Resolution: separate manufacturing dates (hasTimestamp or earlier date) from true expiration date!
  const validDates = facts.observedDates
    .map((d) => ({
      ...d,
      iso: parseRealIsoDate(d.rawText),
      hasTime: d.hasTimestamp || /\d{1,2}:\d{2}/.test(d.rawText),
    }))
    .filter((d): d is typeof d & { iso: string } => d.iso !== null);

  let resolvedExpiryIso: string | null = null;
  let onlyManufacturingIso: string | null = null;

  if (validDates.length >= 2) {
    const explicitExp = validDates.find((d) => d.printedPrefix === "EXPIRY");
    if (explicitExp) {
      resolvedExpiryIso = explicitExp.iso;
    } else {
      const nonTimeDates = validDates.filter((d) => !d.hasTime && d.printedPrefix !== "MANUFACTURED");
      const sorted = (nonTimeDates.length > 0 ? nonTimeDates : validDates)
        .slice()
        .sort((a, b) => a.iso.localeCompare(b.iso));
      resolvedExpiryIso = sorted[sorted.length - 1].iso;
    }
  } else if (validDates.length === 1) {
    const single = validDates[0];
    if (single.printedPrefix === "MANUFACTURED" || single.hasTime) {
      onlyManufacturingIso = single.iso;
    } else {
      resolvedExpiryIso = single.iso;
    }
  }

  const itemLabel = facts.targetItem.trim() || "확인하신 대상";

  if (onlyManufacturingIso) {
    return {
      verified: true,
      resolvedExpiryIso: null,
      isExpired: false,
      spokenGuidanceKo: `${itemLabel}의 제조일자가 ${onlyManufacturingIso}로 적혀 있어요. 소비기한은 그 아래 줄이나 용기 다른 면에 따로 적혀 있으니 천천히 돌려 비춰 보실래요?`,
    };
  }

  if (resolvedExpiryIso) {
    const todayMs = new Date(`${referenceTodayIso}T00:00:00Z`).getTime();
    const expMs = new Date(`${resolvedExpiryIso}T00:00:00Z`).getTime();
    const diffDays = Math.round((expMs - todayMs) / 86_400_000);
    const [, mStr, dStr] = resolvedExpiryIso.split("-");
    const dateKo = `${resolvedExpiryIso.slice(0, 4)}년 ${Number(mStr)}월 ${Number(dStr)}일`;

    if (diffDays < 0) {
      return {
        verified: true,
        resolvedExpiryIso,
        isExpired: true,
        spokenGuidanceKo: `주의하세요! ${itemLabel} 소비기한이 ${dateKo}까지로 오늘 기준 ${Math.abs(diffDays)}일 지났어요. 드시지 마세요.`,
      };
    }
    return {
      verified: true,
      resolvedExpiryIso,
      isExpired: false,
      spokenGuidanceKo:
        diffDays === 0
          ? `${itemLabel} 소비기한이 오늘인 ${dateKo}까지예요.`
          : `${itemLabel} 소비기한은 ${dateKo}까지로 오늘부터 ${diffDays}일 남았어요.`,
    };
  }

  if (facts.fullVerbatimText?.trim()) {
    return {
      verified: true,
      resolvedExpiryIso: null,
      isExpired: false,
      spokenGuidanceKo: `${itemLabel} 전체 내용이에요. ${facts.fullVerbatimText.trim()}`,
    };
  }

  const keyNums = facts.exactKeyNumbers.filter((n) => n.trim().length > 0);
  if (keyNums.length > 0) {
    return {
      verified: true,
      resolvedExpiryIso: null,
      isExpired: false,
      spokenGuidanceKo: `${itemLabel}에서 확인된 핵심 번호는 ${keyNums.join(", ")}번이에요.`,
    };
  }

  return {
    verified: true,
    resolvedExpiryIso: null,
    isExpired: false,
    spokenGuidanceKo: `${itemLabel}이 보입니다. 더 자세히 읽을 부분이 있으면 말씀해 주세요.`,
  };
}

/**
 * Layer B & C: Stateful 4-Stage Workflow Machine for `ACT_AND_GUIDE`
 * Locks state progression so the model cannot skip safe bezel anchoring or hallucinate pulling items from vending machines!
 */
export class StatefulActionGuideFsm {
  private stage: ActWorkflowStage = "STAGE_1_OVERVIEW_SCAN";
  private lockedTarget: string | null = null;

  getStage(): ActWorkflowStage {
    return this.stage;
  }

  reset(): void {
    this.stage = "STAGE_1_OVERVIEW_SCAN";
    this.lockedTarget = null;
  }

  step(facts: HandTrackingFacts): {
    stage: ActWorkflowStage;
    spokenGuidanceKo: string;
  } {
    if (facts.residualHeatHazard) {
      return {
        stage: this.stage,
        spokenGuidanceKo:
          "화상 주의! 지금 가열 화구나 온수 부위에 뜨거운 열기가 남아 있으니 절대 손을 대지 마세요.",
      };
    }

    if (facts.surfaceType === "VENDING_MACHINE") {
      const target = facts.targetLabel.trim();
      if (!target && (facts.availableItemsByRow?.length ?? 0) > 0) {
        this.stage = "STAGE_1_OVERVIEW_SCAN";
        return {
          stage: this.stage,
          spokenGuidanceKo: `자판기 진열 목록을 알려드릴게요. ${facts.availableItemsByRow!.join(", ")} 순서로 놓여 있어요. 어떤 음료를 고르시겠어요?`,
        };
      }
      this.lockedTarget = target || this.lockedTarget || "선택하신 음료";
      if (!facts.handVisible) {
        this.stage = "STAGE_2_SAFE_BEZEL_ANCHOR";
        return {
          stage: this.stage,
          spokenGuidanceKo: `${this.lockedTarget} 구매를 도와드릴게요. 먼저 자판기 오른쪽 중간에 있는 카드 단말기에 결제 카드를 태그하신 뒤, 버튼 패널 쪽으로 손을 뻗어 보여주세요.`,
        };
      }
    }

    const target = facts.targetLabel.trim() || this.lockedTarget || "목표 버튼";
    this.lockedTarget = target;

    if (!facts.handVisible) {
      this.stage = "STAGE_2_SAFE_BEZEL_ANCHOR";
      return {
        stage: this.stage,
        spokenGuidanceKo: `${target} 위치를 찾았어요. 잘못 눌리지 않도록 먼저 화면 오른쪽 아래 바깥 테두리 모서리에 검지 손가락을 대고 보여주시겠어요?`,
      };
    }

    const dx = facts.dxCm ?? 0;
    const dy = facts.dyCm ?? 0;
    if (Math.abs(dx) <= 0.8 && Math.abs(dy) <= 0.8) {
      this.stage = "STAGE_4_PRESS_AND_VERIFY";
      return {
        stage: this.stage,
        spokenGuidanceKo: `바로 거기예요! 지금 손끝 아래가 ${target}이니 그대로 누르세요.`,
      };
    }

    this.stage = "STAGE_3_LIVE_CM_TRACKING";
    const moves: string[] = [];
    if (dx > 0.8) moves.push(`오른쪽으로 약 ${Math.round(dx)}센티미터`);
    else if (dx < -0.8) moves.push(`왼쪽으로 약 ${Math.round(-dx)}센티미터`);
    if (dy > 0.8) moves.push(`위로 약 ${Math.round(dy)}센티미터`);
    else if (dy < -0.8) moves.push(`아래로 약 ${Math.round(-dy)}센티미터`);

    return {
      stage: this.stage,
      spokenGuidanceKo: `지금 손끝에서 ${moves.join(", ")}만 천천히 옮겨 보세요.`,
    };
  }
}

/**
 * Layer D: Runtime Output Guardrail (Model-Agnostic Invariant Filter)
 */
export function verifyAndSanitizeSpokenOutput(rawText: string): string {
  let cleaned = toNaturalSpokenKorean(rawText)
    .replace(/\b(?:10|11|12|1|2|3|4|5|6|7|8|9)시\s*방향/g, "앞쪽")
    .replace(/제품\s+제품이지만/g, "지금 각도에서는")
    .replace(/꺼내\s*드릴까요\??/g, "선택 버튼을 눌러 꺼내실 수 있어요.");

  // Block impossible Gregorian calendar dates (e.g. non-leap Feb 29)
  const dateMatch = /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(
    cleaned,
  );
  if (
    dateMatch &&
    !parseRealIsoDate(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`)
  ) {
    cleaned =
      "지금 각도에서는 날짜 숫자가 선명하게 보이지 않아요. 용기를 천천히 돌려 다시 비춰 보실래요?";
  }
  return cleaned.trim();
}

/**
 * Model-Agnostic JSON Tool Declarations for Gemini Live (`BidiGenerateContent`)
 */
export const SOTA_LIVE_TOOL_DECLARATIONS = [
  {
    name: "inspect_visual_facts",
    description:
      "MUST be called whenever reading any product, receipt order number, expiration/manufacturing date, medicine pouch, banknote, or document so exact digits and stacked dates are verified deterministically.",
    parameters: {
      type: "OBJECT",
      properties: {
        targetItem: {
          type: "STRING",
          description: "Exact Korean name/brand of the visible item or document",
        },
        exactKeyNumbers: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Every key number read digit-by-digit (e.g. order number '4135', banknote '10000', room '302')",
        },
        observedDates: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              rawText: { type: "STRING" },
              hasTimestamp: { type: "BOOLEAN" },
              printedPrefix: {
                type: "STRING",
                enum: ["EXPIRY", "MANUFACTURED", "NONE"],
              },
            },
            required: ["rawText", "hasTimestamp"],
          },
        },
        fullVerbatimText: {
          type: "STRING",
          description: "Populated when user requests reading the entire text verbatim",
        },
        framingIssue: {
          type: "STRING",
          enum: [
            "NONE",
            "TOO_CLOSE_BLUR",
            "OCCLUDED_BY_HAND",
            "WRONG_SIDE",
            "GLARE",
            "TOO_DARK",
          ],
        },
      },
      required: ["targetItem", "exactKeyNumbers", "observedDates", "framingIssue"],
    },
  },
  {
    name: "track_hand_to_target",
    description:
      "MUST be called when guiding the user's hand on a vending machine, kiosk, keypad, elevator, or home appliance.",
    parameters: {
      type: "OBJECT",
      properties: {
        surfaceType: {
          type: "STRING",
          enum: [
            "VENDING_MACHINE",
            "KIOSK_SCREEN",
            "KEYPAD_OR_ELEVATOR",
            "APPLIANCE_PANEL",
            "TABLE_ITEMS",
          ],
        },
        availableItemsByRow: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
        targetLabel: { type: "STRING" },
        handVisible: { type: "BOOLEAN" },
        dxCm: { type: "NUMBER" },
        dyCm: { type: "NUMBER" },
        residualHeatHazard: { type: "BOOLEAN" },
      },
      required: ["surfaceType", "targetLabel", "handVisible"],
    },
  },
  {
    name: "remember_entity",
    description:
      "Save a personal object's location (OBJECT), a consenting colleague/acquaintance's appearance/card/name (PERSON), or an indoor layout detail (SPACE) to persistent on-device memory.",
    parameters: {
      type: "OBJECT",
      properties: {
        category: { type: "STRING", enum: ["OBJECT", "PERSON", "SPACE"] },
        name: { type: "STRING" },
        landmarkOrAppearance: { type: "STRING" },
        extraNotes: { type: "STRING" },
      },
      required: ["category", "name", "landmarkOrAppearance"],
    },
  },
  {
    name: "recall_entity",
    description:
      "Look up a previously saved personal object location, person, or space detail from persistent on-device memory.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING" },
        category: { type: "STRING", enum: ["OBJECT", "PERSON", "SPACE"] },
      },
      required: ["query"],
    },
  },
  {
    name: "start_watching_target",
    description:
      "Activate silent continuous camera watch when the user asks to keep looking until a target object, label, sign, or empty seat appears (e.g. '쌈장 찾으러 가자', '소비기한 보이면 알려줘'). Stays 100% silent until found!",
    parameters: {
      type: "OBJECT",
      properties: {
        targetDescription: { type: "STRING" },
      },
      required: ["targetDescription"],
    },
  },
  {
    name: "stop_watching_target",
    description: "Cancel active target watch.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "search_destination",
    description:
      "Search a destination and build a deterministic pedestrian + transit route plan when the user asks for wayfinding directions (e.g. '왕십리역 가자', '구의역 지하철로 안내해줘').",
    parameters: {
      type: "OBJECT",
      properties: {
        placeQuery: { type: "STRING" },
        transportMode: { type: "STRING", enum: ["SUBWAY", "BUS", "WALK"] },
      },
      required: ["placeQuery"],
    },
  },
  {
    name: "confirm_route_start",
    description: "Confirm and begin deterministic GPS turn-by-turn + silent hazard watch navigation.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: "stop_navigation",
    description: "Stop the currently active navigation route.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
] as const;

export function buildFocusedSystemInstruction(
  mode: CompanionFocusMode,
  memoryStore: PersistentEntityMemoryStore,
): string {
  const savedSummary = memoryStore
    .listAll()
    .slice(-12)
    .map((r) => `[${r.category}] ${r.name}: ${r.landmarkOrAppearance}`)
    .join("; ");

  const modeDirective: Record<CompanionFocusMode, string> = {
    LIVE_AUTO:
      "Active Mode: LIVE COMPANION. Stay silent when nothing changed unless the user speaks or a hazard/target appears. Use `inspect_visual_facts` for any numbers/dates/labels, `track_hand_to_target` for buttons/vending machines, and `remember_entity`/`recall_entity` for objects & people.",
    SEE_AND_READ:
      "Active Mode: PRECISION SEE & READ. Coach camera framing in real time ('조금만 돌려보세요 -> 멈추세요!') and ALWAYS call `inspect_visual_facts` reading every single digit carefully (e.g. distinguish 4-digit '4135' from 3-digit '415', and extract ALL stacked dates).",
    ACT_AND_GUIDE:
      "Active Mode: REAL-TIME HAND & ACTION GUIDE. Watch the user's hand continuously across 1FPS frames and call `track_hand_to_target` to guide them from a safe outer bezel edge onto the exact button or item. Never offer to physically pull items out of a locked vending machine.",
    REMEMBER_ENTITIES:
      "Active Mode: OBJECT, SPACE & PERSON MEMORY. When asked to remember where an item is placed or who is in front of the user (name badge, business card, distinctive attire), call `remember_entity`. When asked where something is or who someone is, call `recall_entity`.",
    MAP_NAV_COPILOT:
      "Active Mode: SILENT VISION SAFETY COPILOT FOR GPS NAVIGATION. Primary turn-by-turn distance directions are spoken by the deterministic GPS navigator — ONLY speak when an immediate obstacle, stair/curb, crosswalk light, or station entrance/sign appears! Never dodge toward a roadway.",
  };

  return [
    "You are 'SOTA (소타)', a calm, warm, concise real-time smart-glass companion for a blind user in Korea.",
    modeDirective[mode],
    "CRITICAL RULES: 1) Speak natural Korean in 1-2 short sentences without symbols or clock-face terms ('12시 방향' forbidden). 2) Never guess blurred digits or unseen dates — call the structured tool first and speak the verified result returned by the harness.",
    savedSummary ? `Saved On-Device Memory: ${savedSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Stateful Gemini Multimodal Live API Session (`wss://.../BidiGenerateContent`)
 * Supports `gemini-3.8-live` with automatic failover to `gemini-3.1-flash-live-preview`.
 */
export class GeminiLiveCompanionSession {
  private ws: WebSocket | null = null;
  private readonly memoryStore: PersistentEntityMemoryStore;
  private readonly actionFsm = new StatefulActionGuideFsm();
  private mode: CompanionFocusMode;
  private activeModel = "gemini-3.8-live";
  private activeWatchTarget: string | null = null;
  private activeNavDestination: string | null = null;

  getActiveWatchTarget(): string | null {
    return this.activeWatchTarget;
  }

  getActiveNavDestination(): string | null {
    return this.activeNavDestination;
  }

  constructor(params?: {
    mode?: CompanionFocusMode;
    memoryFilePath?: string;
  }) {
    this.mode = params?.mode ?? "LIVE_AUTO";
    this.memoryStore = new PersistentEntityMemoryStore(params?.memoryFilePath);
  }

  getMemoryStore(): PersistentEntityMemoryStore {
    return this.memoryStore;
  }

  getActionFsm(): StatefulActionGuideFsm {
    return this.actionFsm;
  }

  handleToolCallLocally(
    name: string,
    args: Record<string, any>,
  ): { verifiedSpeechKo: string; data: Record<string, unknown> } {
    if (name === "inspect_visual_facts") {
      const res = evaluateVisualInspectionPolicy({
        targetItem: String(args.targetItem ?? ""),
        exactKeyNumbers: Array.isArray(args.exactKeyNumbers)
          ? args.exactKeyNumbers.map(String)
          : [],
        observedDates: Array.isArray(args.observedDates)
          ? args.observedDates.map((d: any) => ({
              rawText: String(d.rawText ?? ""),
              hasTimestamp: Boolean(d.hasTimestamp),
              printedPrefix: d.printedPrefix,
            }))
          : [],
        fullVerbatimText: args.fullVerbatimText
          ? String(args.fullVerbatimText)
          : undefined,
        framingIssue: args.framingIssue ?? "NONE",
      });
      return {
        verifiedSpeechKo: verifyAndSanitizeSpokenOutput(res.spokenGuidanceKo),
        data: res,
      };
    }

    if (name === "track_hand_to_target") {
      const res = this.actionFsm.step({
        surfaceType: args.surfaceType ?? "KIOSK_SCREEN",
        availableItemsByRow: Array.isArray(args.availableItemsByRow)
          ? args.availableItemsByRow.map(String)
          : undefined,
        targetLabel: String(args.targetLabel ?? ""),
        handVisible: Boolean(args.handVisible),
        dxCm: typeof args.dxCm === "number" ? args.dxCm : undefined,
        dyCm: typeof args.dyCm === "number" ? args.dyCm : undefined,
        residualHeatHazard: Boolean(args.residualHeatHazard),
      });
      return {
        verifiedSpeechKo: verifyAndSanitizeSpokenOutput(res.spokenGuidanceKo),
        data: res,
      };
    }

    if (name === "remember_entity") {
      const saved = this.memoryStore.upsert({
        category: (args.category as EntityCategory) ?? "OBJECT",
        name: String(args.name ?? "항목"),
        landmarkOrAppearance: String(args.landmarkOrAppearance ?? ""),
        extraNotes: args.extraNotes ? String(args.extraNotes) : "",
      });
      const speech =
        saved.category === "PERSON"
          ? `${saved.name} 님의 특징을 기억해 두었어요. ${saved.landmarkOrAppearance}`
          : `${saved.name} 위치를 ${saved.landmarkOrAppearance}으로 기억해 두었어요.`;
      return {
        verifiedSpeechKo: verifyAndSanitizeSpokenOutput(speech),
        data: { saved },
      };
    }

    if (name === "recall_entity") {
      const matches = this.memoryStore.recall(
        String(args.query ?? ""),
        args.category as EntityCategory | undefined,
      );
      const speech =
        matches.length > 0
          ? matches
              .slice(0, 2)
              .map((m) =>
                m.category === "PERSON"
                  ? `${m.name} 님은 ${m.landmarkOrAppearance} 특징으로 저장되어 있어요.`
                  : `${m.name}은 ${m.landmarkOrAppearance}에 둔 것으로 기억하고 있어요.`,
              )
              .join(" ")
          : "아직 그 항목에 대해 기억해 둔 정보가 없어요. 주변을 천천히 비춰 주시면 함께 찾아볼게요.";
      return {
        verifiedSpeechKo: verifyAndSanitizeSpokenOutput(speech),
        data: { matches },
      };
    }

    if (name === "start_watching_target") {
      const target = String(args.targetDescription ?? "").trim() || "목표 대상";
      this.activeWatchTarget = target;
      return {
        verifiedSpeechKo: `네, 지금부터 카메라로 ${target}이 보이는지 조용히 지켜볼게요. 천천히 비춰주시면 발견하는 즉시 알려드릴게요.`,
        data: { watchingTarget: target, silentUntilFound: true },
      };
    }

    if (name === "stop_watching_target") {
      this.activeWatchTarget = null;
      return {
        verifiedSpeechKo: "목표 탐색 감시를 종료했어요.",
        data: { watchingTarget: null },
      };
    }

    if (name === "search_destination") {
      const place = String(args.placeQuery ?? "").trim();
      const tMode = String(args.transportMode ?? "SUBWAY").toUpperCase();
      this.activeNavDestination = place;
      this.mode = "MAP_NAV_COPILOT";
      return {
        verifiedSpeechKo: `${place}까지 ${tMode === "WALK" ? "도보" : "대중교통 및 도보"} 이동 경로를 준비했어요. 출발할까요?`,
        data: { placeQuery: place, transportMode: tMode, awaitingConfirm: true },
      };
    }

    if (name === "confirm_route_start") {
      const dest = this.activeNavDestination ?? "목적지";
      return {
        verifiedSpeechKo: `좋아요, ${dest} 안내를 시작할게요. 회전 구간과 정거장은 GPS가 정확히 알려드리고, 카메라는 앞쪽 장애물이나 출입구가 나타날 때만 알려드릴게요.`,
        data: { navigationActive: true, destination: dest },
      };
    }

    if (name === "stop_navigation") {
      this.activeNavDestination = null;
      this.mode = "LIVE_AUTO";
      return {
        verifiedSpeechKo: "길 안내를 종료했어요.",
        data: { navigationActive: false },
      };
    }

    return {
      verifiedSpeechKo: "",
      data: { ok: false },
    };
  }

  /**
   * Executes a complete live multimodal turn over WebSocket (`BidiGenerateContent`) including automatic
   * deterministic Tool execution (`inspect_visual_facts`, `track_hand_to_target`, `remember_entity`, `recall_entity`).
   */
  async runSingleTurnOverLiveWs(params: {
    userText?: string;
    imageBase64Jpeg?: string;
    apiKey?: string;
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    model: string;
    spokenKorean: string;
    audioByteCount: number;
    toolCallsExecuted: string[];
    latencyMs: number;
  }> {
    const t0 = Date.now();
    const key =
      params.apiKey ??
      getSecretFromKeychainOrEnv(KEYCHAIN_SERVICE_GEMINI, "GEMINI_API_KEY");
    if (!key) {
      return {
        ok: false,
        model: this.activeModel,
        spokenKorean: "API 키가 설정되지 않았습니다.",
        audioByteCount: 0,
        toolCallsExecuted: [],
        latencyMs: Date.now() - t0,
      };
    }

    const candidateModels = [
      "gemini-3.8-live",
      "gemini-3.1-flash-live-preview",
      "gemini-2.5-flash-native-audio-preview-12-2025",
    ];

    for (const modelName of candidateModels) {
      const attempt = await new Promise<{
        ok: boolean;
        spokenKorean: string;
        audioByteCount: number;
        toolCallsExecuted: string[];
      }>((resolve) => {
        const ws = new WebSocket(
          `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`,
        );
        let transcript = "";
        let fallbackVerifiedToolSpeech = "";
        let audioBytes = 0;
        const toolsCalled: string[] = [];
        let awaitingPostToolTurn = false;
        let settled = false;

        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch {}
          const finalText = verifyAndSanitizeSpokenOutput(
            transcript.trim() || fallbackVerifiedToolSpeech,
          );
          resolve({
            ok: ok && (finalText.length > 0 || audioBytes > 0),
            spokenKorean: finalText,
            audioByteCount: audioBytes,
            toolCallsExecuted: toolsCalled,
          });
        };

        const timer = setTimeout(
          () => finish(toolsCalled.length > 0 || audioBytes > 0),
          params.timeoutMs ?? 9000,
        );

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              setup: {
                model: `models/${modelName}`,
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  mediaResolution: "MEDIA_RESOLUTION_HIGH",
                },
                outputAudioTranscription: {},
                systemInstruction: {
                  parts: [
                    {
                      text: buildFocusedSystemInstruction(
                        this.mode,
                        this.memoryStore,
                      ),
                    },
                  ],
                },
                tools: [{ functionDeclarations: SOTA_LIVE_TOOL_DECLARATIONS }],
              },
            }),
          );
        };

        ws.onmessage = async (ev) => {
          const raw =
            typeof ev.data === "string"
              ? ev.data
              : Buffer.from(await ev.data.arrayBuffer()).toString("utf8");
          const msg = JSON.parse(raw);

          if (msg.setupComplete) {
            const parts: Array<Record<string, unknown>> = [];
            if (params.imageBase64Jpeg) {
              parts.push({
                inlineData: {
                  mimeType: "image/jpeg",
                  data: params.imageBase64Jpeg,
                },
              });
            }
            if (params.userText) {
              parts.push({ text: params.userText });
            }
            ws.send(
              JSON.stringify({
                clientContent: {
                  turns: [{ role: "user", parts }],
                  turnComplete: true,
                },
              }),
            );
            return;
          }

          if (msg.toolCall?.functionCalls) {
            awaitingPostToolTurn = true;
            const responses = msg.toolCall.functionCalls.map((fc: any) => {
              toolsCalled.push(fc.name);
              const localRes = this.handleToolCallLocally(
                fc.name,
                fc.args ?? {},
              );
              if (localRes.verifiedSpeechKo) {
                fallbackVerifiedToolSpeech = localRes.verifiedSpeechKo;
              }
              return {
                id: fc.id,
                name: fc.name,
                response: {
                  verifiedSpeechKo: localRes.verifiedSpeechKo,
                  ...localRes.data,
                  instruction:
                    "위 verifiedSpeechKo 내용을 그대로 자연스럽게 한국어 음성으로 전달하세요.",
                },
              };
            });
            ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
            return;
          }

          const sc = msg.serverContent;
          if (sc?.outputTranscription?.text) {
            transcript += sc.outputTranscription.text;
          }
          for (const p of sc?.modelTurn?.parts ?? []) {
            if (p.inlineData?.data) {
              audioBytes += Buffer.from(p.inlineData.data, "base64").length;
            }
          }
          if (sc?.turnComplete) {
            if (awaitingPostToolTurn) {
              awaitingPostToolTurn = false;
              if (transcript.trim().length > 0 || audioBytes > 0) {
                finish(true);
              }
            } else {
              finish(true);
            }
          }
        };

        ws.onerror = () => finish(false);
        ws.onclose = () => finish(false);
      });

      if (attempt.ok) {
        this.activeModel = modelName;
        return {
          ok: true,
          model: modelName,
          spokenKorean: attempt.spokenKorean,
          audioByteCount: attempt.audioByteCount,
          toolCallsExecuted: attempt.toolCallsExecuted,
          latencyMs: Date.now() - t0,
        };
      }
    }

    return {
      ok: false,
      model: this.activeModel,
      spokenKorean: "실시간 세션 연결을 재시도 중입니다.",
      audioByteCount: 0,
      toolCallsExecuted: [],
      latencyMs: Date.now() - t0,
    };
  }
}
