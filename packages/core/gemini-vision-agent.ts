import {
  getSecretFromKeychainOrEnv,
  KEYCHAIN_SERVICE_GEMINI,
  maskSecretMetadata,
} from "./keychain.ts";
import { KO_KR_SYSTEM_PROMPT } from "../locale-ko-kr/index.ts";

export interface GeminiVisionRequest {
  userPrompt: string;
  /** Optional base64-encoded image frame (JPEG/PNG/WEBP) */
  imageBase64?: string;
  imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
  systemInstruction?: string;
  maxOutputTokens?: number;
}

export interface GeminiVisionResponse {
  ok: boolean;
  source: "gemini-live-api" | "vertex-express-api" | "offline-fallback";
  model: string;
  spokenKorean: string;
  latencyMs: number;
  diagnostic?: string;
}

export interface GeminiConnectivityCheckResult {
  keyMetadata: ReturnType<typeof maskSecretMetadata>;
  reachable: boolean;
  endpointUsed: string;
  statusCode?: number;
  modelTested: string;
  sampleKoreanOutput?: string;
  diagnosticMessage: string;
}

export type AutoDetectedSceneMode =
  | "WALKING_SAFETY"
  | "STEP_AND_GLASS_DOOR"
  | "CROSSWALK_SIGNAL"
  | "BUS_STOP"
  | "TAXI_MATCHER"
  | "SUBWAY_PLATFORM"
  | "SUBWAY_ON_BOARD"
  | "TRANSFER_CORRIDOR"
  | "RESTROOM_AND_SEAT"
  | "KIOSK_COACH"
  | "APPLIANCE_SAFETY"
  | "SMART_READER"
  | "GROCERY_SCANNER"
  | "DINING_ASSISTANT"
  | "INDOOR_SPACE"
  | "SOCIAL_MEETING"
  | "NAV_CONTROL";

export interface AutoSceneVisionResponse extends GeminiVisionResponse {
  detectedMode: AutoDetectedSceneMode;
  detectedModeLabelKo: string;
  priority: "P0_SAFETY" | "P1_NAVIGATION" | "P2_COMPANION";
  earcon:
    | "HAZARD_ALERT"
    | "SIGNAL_GREEN"
    | "TRANSIT_ARRIVING"
    | "TARGET_FOUND"
    | "SCANNING_TICK";
}

const AUTO_SCENE_PROMPT = `카메라에 들어온 1인칭 시야(또는 상황 정보)를 보고 현재 시각장애인 사용자의 상황 모드를 스스로 판단하여 가장 필요한 정보를 안내하세요.

반드시 맨 앞 줄에 아래 태그 중 하나만 대괄호로 먼저 적고, 이어서 시각장애인에게 읽어줄 한국어 음성 안내(1~2문장, 시계 방향 10~2시 및 걸음 수/cm 기준)를 작성하세요:
- [WALKING_SAFETY] : 보행로, 점자블록, 킥보드/볼라드/계단 등 장애물이 보일 때
- [CROSSWALK_SIGNAL] : 횡단보도나 보행자 신호등(적색/녹색/잔여시간)이 보일 때
- [BUS_STOP] : 버스 정류장 표지판, BIT 전광판, 진입하는 버스가 보일 때
- [SUBWAY_PLATFORM] : 지하철 승강장, 스크린도어 번호(예: 3-2), 역명판이 보일 때
- [TRANSFER_CORRIDOR] : 지하철 환승 유도 표지판(노선 색상/화살표), 점자블록 갈림길, 계단/에스컬레이터가 보일 때
- [KIOSK_COACH] : 무인 키오스크, 터치스크린, 정수기/엘리베이터 버튼과 손가락이 보일 때
- [SMART_READER] : 약봉지, 고지서, 택배 송장, 식품 유통기한, 메뉴판 등 글자 문서가 가까이 보일 때
- [INDOOR_SPACE] : 집, 카페, 사무실 등 실내 공간이나 생활 물건이 보일 때

출력 예시:
[WALKING_SAFETY] 전방 12시 방향 3걸음 앞 점자블록 위에 공유 킥보드가 있습니다. 왼쪽 10시 방향으로 반 걸음 피해서 이동하세요.`;

const MODE_META_MAP: Record<
  AutoDetectedSceneMode,
  {
    labelKo: string;
    priority: AutoSceneVisionResponse["priority"];
    earcon: AutoSceneVisionResponse["earcon"];
  }
> = {
  WALKING_SAFETY: {
    labelKo: "보행 안전 · 장애물 감지",
    priority: "P0_SAFETY",
    earcon: "HAZARD_ALERT",
  },
  STEP_AND_GLASS_DOOR: {
    labelKo: "무표시 계단 · 단차 · 투명유리문 감지",
    priority: "P0_SAFETY",
    earcon: "HAZARD_ALERT",
  },
  CROSSWALK_SIGNAL: {
    labelKo: "횡단보도 · 신호등 인식",
    priority: "P0_SAFETY",
    earcon: "SIGNAL_GREEN",
  },
  BUS_STOP: {
    labelKo: "버스 정류장 · 진입 버스",
    priority: "P1_NAVIGATION",
    earcon: "TRANSIT_ARRIVING",
  },
  TAXI_MATCHER: {
    labelKo: "호출 택시 · 장콜 번호판 매칭",
    priority: "P1_NAVIGATION",
    earcon: "TRANSIT_ARRIVING",
  },
  SUBWAY_PLATFORM: {
    labelKo: "지하철 승강장 · 빠른 환승",
    priority: "P1_NAVIGATION",
    earcon: "TRANSIT_ARRIVING",
  },
  SUBWAY_ON_BOARD: {
    labelKo: "지하철 탑승 중 · 정거장/하차문 안내",
    priority: "P1_NAVIGATION",
    earcon: "SCANNING_TICK",
  },
  TRANSFER_CORRIDOR: {
    labelKo: "지하철 환승 통로 내비",
    priority: "P1_NAVIGATION",
    earcon: "TARGET_FOUND",
  },
  RESTROOM_AND_SEAT: {
    labelKo: "공공화장실 성별/빈칸 · 빈 좌석 탐색",
    priority: "P1_NAVIGATION",
    earcon: "TARGET_FOUND",
  },
  KIOSK_COACH: {
    labelKo: "키오스크 · 터치 손가락 코칭",
    priority: "P1_NAVIGATION",
    earcon: "TARGET_FOUND",
  },
  APPLIANCE_SAFETY: {
    labelKo: "인덕션 잔열(H) · 정수기 · 가전 판독",
    priority: "P0_SAFETY",
    earcon: "HAZARD_ALERT",
  },
  SMART_READER: {
    labelKo: "문서 · 약봉지 · 유통기한 요약",
    priority: "P2_COMPANION",
    earcon: "SCANNING_TICK",
  },
  GROCERY_SCANNER: {
    labelKo: "마트/편의점 맛 · 제로 · 1+1 행사 리더",
    priority: "P2_COMPANION",
    earcon: "TARGET_FOUND",
  },
  DINING_ASSISTANT: {
    labelKo: "식사 반찬 배치 · 가시 주의 · 남은 양",
    priority: "P2_COMPANION",
    earcon: "TARGET_FOUND",
  },
  INDOOR_SPACE: {
    labelKo: "실내 공간 · 물건 탐색",
    priority: "P2_COMPANION",
    earcon: "TARGET_FOUND",
  },
  SOCIAL_MEETING: {
    labelKo: "상대방 명함/악수 제스처 · 회의 슬라이드",
    priority: "P2_COMPANION",
    earcon: "TARGET_FOUND",
  },
  NAV_CONTROL: {
    labelKo: "내비게이션 경로 · 이동수단 제어",
    priority: "P1_NAVIGATION",
    earcon: "TARGET_FOUND",
  },
};

export function parseAutoSceneOutput(rawText: string): {
  detectedMode: AutoDetectedSceneMode;
  detectedModeLabelKo: string;
  priority: AutoSceneVisionResponse["priority"];
  earcon: AutoSceneVisionResponse["earcon"];
  cleanSpokenKorean: string;
} {
  const tagMatch = rawText
    .trim()
    .match(
      /^\[(WALKING_SAFETY|STEP_AND_GLASS_DOOR|CROSSWALK_SIGNAL|BUS_STOP|TAXI_MATCHER|SUBWAY_PLATFORM|SUBWAY_ON_BOARD|TRANSFER_CORRIDOR|RESTROOM_AND_SEAT|KIOSK_COACH|APPLIANCE_SAFETY|SMART_READER|GROCERY_SCANNER|DINING_ASSISTANT|INDOOR_SPACE|SOCIAL_MEETING|NAV_CONTROL)\]\s*(.*)$/s,
    );

  let mode: AutoDetectedSceneMode = "INDOOR_SPACE";
  let cleanText = rawText.replace(/\*\*/g, "").trim();

  if (tagMatch) {
    mode = tagMatch[1] as AutoDetectedSceneMode;
    cleanText = tagMatch[2].replace(/\*\*/g, "").trim();
  } else if (/킥보드|장애물|볼라드|단차|위험/.test(cleanText)) {
    mode = "WALKING_SAFETY";
  } else if (/신호등|횡단보도|녹색|적색/.test(cleanText)) {
    mode = "CROSSWALK_SIGNAL";
  } else if (/버스|정류장|정류소/.test(cleanText)) {
    mode = "BUS_STOP";
  } else if (/승강장|스크린도어|호차|열차/.test(cleanText)) {
    mode = "SUBWAY_PLATFORM";
  } else if (/환승|계단|에스컬레이터|표지판/.test(cleanText)) {
    mode = "TRANSFER_CORRIDOR";
  } else if (/키오스크|버튼|손가락|결제/.test(cleanText)) {
    mode = "KIOSK_COACH";
  } else if (/약봉지|고지서|유통기한|소비기한|택배|메뉴/.test(cleanText)) {
    mode = "SMART_READER";
  }

  const meta = MODE_META_MAP[mode];
  return {
    detectedMode: mode,
    detectedModeLabelKo: meta.labelKo,
    priority: meta.priority,
    earcon: meta.earcon,
    cleanSpokenKorean: cleanText,
  };
}

const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export class GeminiVisionAgent {
  private readonly model: string;
  private readonly customApiKey?: string;

  constructor(options?: { model?: string; apiKey?: string }) {
    this.model = options?.model ?? DEFAULT_MODEL;
    this.customApiKey = options?.apiKey;
  }

  private resolveKey(): string | null {
    if (this.customApiKey) return this.customApiKey;
    return getSecretFromKeychainOrEnv(
      KEYCHAIN_SERVICE_GEMINI,
      "GEMINI_API_KEY",
    );
  }

  private buildPayload(req: GeminiVisionRequest): Record<string, unknown> {
    const parts: Array<Record<string, unknown>> = [];
    if (req.imageBase64) {
      parts.push({
        inlineData: {
          mimeType: req.imageMimeType ?? "image/jpeg",
          data: req.imageBase64,
        },
      });
    }
    parts.push({ text: req.userPrompt });

    return {
      systemInstruction: {
        role: "system",
        parts: [{ text: req.systemInstruction ?? KO_KR_SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: req.maxOutputTokens ?? 160,
        thinkingConfig: {
          thinkingLevel: "MINIMAL",
        },
      },
    };
  }

  /**
   * Attempts Vertex AI Express (`aiplatform.googleapis.com` for `AQ.` keys) and Google AI Studio (`generativelanguage.googleapis.com` for `AIza` keys).
   */
  async generateVisionBriefing(
    req: GeminiVisionRequest,
  ): Promise<GeminiVisionResponse> {
    const start = Date.now();
    const key = this.resolveKey();
    if (!key) {
      return {
        ok: false,
        source: "offline-fallback",
        model: this.model,
        spokenKorean: this.offlineHeuristicFallback(req.userPrompt),
        latencyMs: Date.now() - start,
        diagnostic:
          "macOS Keychain(SOTA_GEMINI_API_KEY) 또는 GEMINI_API_KEY 환경변수에 키가 없습니다.",
      };
    }

    const payload = this.buildPayload(req);
    const endpoints = this.getCandidateEndpoints(key);
    let lastDiagnostic = "";

    for (const candidate of endpoints) {
      try {
        const res = await fetch(candidate.url, {
          method: "POST",
          headers: candidate.headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });

        const data = (await res.json().catch(() => ({}))) as Record<
          string,
          any
        >;

        if (res.ok) {
          const text =
            data?.candidates?.[0]?.content?.parts
              ?.map((p: { text?: string }) => p.text ?? "")
              .join(" ")
              .trim() ?? "";
          if (text) {
            return {
              ok: true,
              source: candidate.source,
              model: this.model,
              spokenKorean: text,
              latencyMs: Date.now() - start,
            };
          }
        }

        const errMsg =
          data?.error?.message ?? `HTTP ${res.status} ${res.statusText}`;
        lastDiagnostic = `[${candidate.source}] ${errMsg}`;
      } catch (err) {
        lastDiagnostic = `[${candidate.source}] ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return {
      ok: false,
      source: "offline-fallback",
      model: this.model,
      spokenKorean: this.offlineHeuristicFallback(req.userPrompt),
      latencyMs: Date.now() - start,
      diagnostic: lastDiagnostic,
    };
  }

  async checkConnectivity(): Promise<GeminiConnectivityCheckResult> {
    const key = this.resolveKey();
    const keyMetadata = maskSecretMetadata(key);
    if (!key) {
      return {
        keyMetadata,
        reachable: false,
        endpointUsed: "none",
        modelTested: this.model,
        diagnosticMessage: "Keychain or environment key not found",
      };
    }

    const response = await this.generateVisionBriefing({
      userPrompt:
        "시각장애인 보행 보조 테스트입니다. '소타 비전 연결 정상입니다.'라고 한 문장으로만 답하세요.",
      maxOutputTokens: 60,
    });

    return {
      keyMetadata,
      reachable: response.ok,
      endpointUsed: response.source,
      modelTested: this.model,
      sampleKoreanOutput: response.spokenKorean,
      diagnosticMessage: response.ok
        ? `Connected (${response.latencyMs}ms)`
        : (response.diagnostic ?? "Connection failed"),
    };
  }

  /**
   * Automatically determines the scene mode from the incoming 1st-person camera frame (and optional user voice hint)
   * and returns the classified mode, audio priority, earcon, and concise Korean speech.
   */
  async analyzeAutoScene(params: {
    imageBase64?: string;
    imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
    userQuery?: string;
    previousSpokenKorean?: string;
  }): Promise<AutoSceneVisionResponse> {
    const queryPart = params.userQuery?.trim()
      ? `사용자 추가 질문/힌트: ${params.userQuery.trim()}`
      : "현재 카메라 시야에서 시각장애인에게 가장 중요한 보행/교통/생활 정보를 즉시 브리핑하세요.";
    const dedupHint = params.previousSpokenKorean
      ? `\n(직전 안내 문장: "${params.previousSpokenKorean}" — 만약 시야에 새로운 위험이나 변화가 있으면 새로운 내용을 중심으로 말하세요.)`
      : "";

    const rawRes = await this.generateVisionBriefing({
      userPrompt: `${AUTO_SCENE_PROMPT}\n\n${queryPart}${dedupHint}`,
      imageBase64: params.imageBase64,
      imageMimeType: params.imageMimeType ?? "image/jpeg",
    });

    const parsed = parseAutoSceneOutput(rawRes.spokenKorean);
    return {
      ...rawRes,
      spokenKorean: parsed.cleanSpokenKorean,
      detectedMode: parsed.detectedMode,
      detectedModeLabelKo: parsed.detectedModeLabelKo,
      priority: parsed.priority,
      earcon: parsed.earcon,
    };
  }

  /**
   * Multimodal scene analysis tailored for Korean visually impaired users across walking, transit, kiosk, and home modes.
   */
  async analyzeSceneForMode(params: {
    mode:
      | "AUTO"
      | "WALKING_SAFETY"
      | "BUS_STOP"
      | "SUBWAY_PLATFORM"
      | "TRANSFER_CORRIDOR"
      | "KIOSK_COACH"
      | "SMART_READER"
      | "OBJECT_FINDER";
    userQuery: string;
    imageBase64?: string;
    imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
    extraContext?: string;
  }): Promise<GeminiVisionResponse | AutoSceneVisionResponse> {
    if (!params.mode || params.mode === "AUTO") {
      return this.analyzeAutoScene({
        imageBase64: params.imageBase64,
        imageMimeType: params.imageMimeType,
        userQuery: params.userQuery,
      });
    }
    const modePromptMap: Record<typeof params.mode, string> = {
      WALKING_SAFETY:
        "전방 보행로와 점자블록 위의 장애물(킥보드, 볼라드, 계단, 간판), 보행자 신호등(적색/녹색/잔여시간)을 시계 방향(10~2시)과 걸음 수로 2문장 이내로 즉시 경고하세요.",
      BUS_STOP:
        "버스 정류장 표지판의 정류소명, 5자리 정류소 번호(ARS-ID), 진행 방면, 진입 중인 버스 번호판과 문 위치를 2문장 이내로 안내하세요.",
      SUBWAY_PLATFORM:
        "지하철 승강장의 노선, 다음 역 화살표 방면, 스크린도어 호차-문번호(예: 3-2)를 읽고 빠른 환승 이동 방향과 걸음 수를 안내하세요.",
      TRANSFER_CORRIDOR:
        "지하철 환승 유도 표지판(노선 색상/번호, 화살표 방향, 남은 거리)과 점자블록 갈림길, 전방 계단/에스컬레이터/엘리베이터 위치를 시계 방향과 걸음 수로 안내하세요.",
      KIOSK_COACH:
        "무인 키오스크나 터치 패널에서 사용자가 찾는 버튼의 위치와 현재 손가락 끝 위치 사이의 상대 거리(오른쪽/왼쪽/위/아래 몇 cm) 및 결제 투입구 위치를 안내하세요.",
      SMART_READER:
        "한국어 약봉지, 관리비 고지서, 택배 송장, 식품 유통기한, 메뉴판의 핵심 3요소만 1~2문장으로 먼저 요약하세요.",
      OBJECT_FINDER:
        "사용자가 찾는 물건의 위치를 시계 방향(10~2시)과 걸음 수(또는 손 뻗기 cm) 및 주변 기준물로 간결하게 안내하세요.",
    };

    const fullPrompt = [
      `[모드 지침]: ${modePromptMap[params.mode]}`,
      params.extraContext ? `[센서/공공데이터 컨텍스트]: ${params.extraContext}` : "",
      `[사용자 요청]: ${params.userQuery}`,
    ]
      .filter(Boolean)
      .join("\n");

    return this.generateVisionBriefing({
      userPrompt: fullPrompt,
      imageBase64: params.imageBase64,
      imageMimeType: params.imageMimeType,
    });
  }

  private getCandidateEndpoints(key: string): Array<{
    source: "gemini-live-api" | "vertex-express-api";
    url: string;
    headers: Record<string, string>;
  }> {
    const encodedKey = encodeURIComponent(key);
    const aiStudioCandidate = {
      source: "gemini-live-api" as const,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodedKey}`,
      headers: { "Content-Type": "application/json" },
    };
    const vertexCandidate = {
      source: "vertex-express-api" as const,
      url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${this.model}:generateContent?key=${encodedKey}`,
      headers: { "Content-Type": "application/json" },
    };

    return [aiStudioCandidate, vertexCandidate];
  }

  private offlineHeuristicFallback(prompt: string): string {
    if (prompt.includes("신호등") || prompt.includes("횡단보도")) {
      return "온디바이스 안전 모드: 전방 보행자 신호등을 스캔 중입니다. 음향신호기 및 주변 차량 소리에 유의하세요.";
    }
    if (prompt.includes("정류장") || prompt.includes("버스")) {
      return "온디바이스 교통 모드: 정류장 표지판 번호와 진입 버스 번호판을 로컬 OCR로 판독합니다.";
    }
    if (prompt.includes("지하철") || prompt.includes("환승") || prompt.includes("승강장")) {
      return "온디바이스 지하철 모드: 스크린도어 호차-문번호(예: 3-2)와 환승 유도 표지판 화살표를 추적합니다.";
    }
    return "소타 로컬 보조 모드가 활성화되어 있습니다. 전방 시야의 텍스트와 장애물을 분석합니다.";
  }
}
