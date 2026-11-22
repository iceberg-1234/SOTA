import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GeminiVisionAgent } from "../../packages/core/gemini-vision-agent.ts";
import {
  getSecretFromKeychainOrEnv,
  KEYCHAIN_SERVICE_GEMINI,
  maskSecretMetadata,
} from "../../packages/core/keychain.ts";
import { coachFingertipToButtonKo } from "../../packages/core/spatial-language.ts";
import { VisualMemoryStore } from "../../packages/core/visual-memory.ts";
import { KoreanSmartReader } from "../../packages/core/smart-reader.ts";
import {
  KOREAN_SUBWAY_LINES,
  KOREAN_SUBWAY_TRANSFER_HUBS,
} from "../../packages/locale-ko-kr/subway-transfer-db.ts";
import {
  KoreaTransitProvider,
  SEOUL_SAMPLE_BUS_STOPS,
} from "../../packages/locale-ko-kr/transit-provider.ts";
import { createKoreanSkillPlugins } from "../../packages/locale-ko-kr/skills.ts";
import { StatefulSkillHarness } from "../../packages/core/agent-harness.ts";
import { InferenceFeedbackStore } from "../../packages/core/feedback-store.ts";
import { VisualPedestrianNavigator } from "../../packages/locale-ko-kr/pedestrian-nav.ts";
import { runFullDaySimulation } from "../scenario-simulator/run-day.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

export function createCompanionServer(feedbackStorePath?: string) {
  const visionAgent = new GeminiVisionAgent();
  const transitProvider = new KoreaTransitProvider();
  const skillHarness = new StatefulSkillHarness(
    createKoreanSkillPlugins(transitProvider),
  );
  const feedbackStore = new InferenceFeedbackStore(feedbackStorePath);
  const pedestrianNav = new VisualPedestrianNavigator();
  const memoryStore = new VisualMemoryStore();
  memoryStore.seedDefaultHomeMemory();
  const smartReader = new KoreanSmartReader();

  async function readJsonBody(req: http.IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  }

  function sendJson(
    res: http.ServerResponse,
    status: number,
    payload: unknown,
  ): void {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(payload));
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/api/status") {
        const key = getSecretFromKeychainOrEnv(
          KEYCHAIN_SERVICE_GEMINI,
          "GEMINI_API_KEY",
        );
        return sendJson(res, 200, {
          app: "SOTA AI Smart Glass Companion (Korea PoC)",
          geminiKeychain: maskSecretMetadata(key),
          transitCoverage: transitProvider.getProviderStatus(),
          tmapKeychain: pedestrianNav.getTmapStatus(),
          harness: {
            stickyMode: skillHarness.getStickyMode(),
            activeCandidateSkills: skillHarness.getActiveCandidateSkillIds(),
            registeredSkills: skillHarness
              .getRegisteredSkills()
              .map((s) => ({ id: s.id, labelKo: s.labelKo, priority: s.priority })),
          },
          subwayLines: Object.values(KOREAN_SUBWAY_LINES),
          transferHubs: KOREAN_SUBWAY_TRANSFER_HUBS,
          sampleBusStops: SEOUL_SAMPLE_BUS_STOPS,
          dailyTimeline: runFullDaySimulation(),
        });
      }

      if (req.method === "GET" && url.pathname === "/api/gemini/health") {
        const check = await visionAgent.checkConnectivity();
        return sendJson(res, 200, check);
      }

      if (
        req.method === "POST" &&
        url.pathname === "/api/transit/subway-check"
      ) {
        const body = await readJsonBody(req);
        const currentLine = String(body.currentLine ?? "2호선");
        const intendedDirectionStation = String(
          body.intendedDirectionStation ?? "교대",
        );
        const observedNextStationOnSign = String(
          body.observedNextStationOnSign ?? "교대",
        );
        const observedScreenDoor = String(body.observedScreenDoor ?? "3-2");
        const transferStationName = String(
          body.transferStationName ?? "교대역",
        );
        const transferTargetLine = String(body.transferTargetLine ?? "3호선");
        const preferElevator = Boolean(body.preferElevator);
        let nextTrainArrivalMinutes = Number(
          body.nextTrainArrivalMinutes ?? 0,
        );
        let arrivalSource: "SEOUL_TOPIS_LIVE" | "SEOUL_EMBEDDED_FALLBACK" =
          "SEOUL_EMBEDDED_FALLBACK";

        if (!body.nextTrainArrivalMinutes) {
          const liveSub = await transitProvider.fetchSeoulSubwayArrivalLive({
            stationName: transferStationName,
            intendedDirectionStation,
          });
          nextTrainArrivalMinutes = liveSub.arrivalMinutes;
          arrivalSource = liveSub.source;
        }

        const platformResult =
          transitProvider.querySubwayPlatformAndTransferGuidance({
            currentLine,
            intendedDirectionStation,
            observedNextStationOnSign,
            observedScreenDoor,
            transferStationName,
            transferTargetLine,
            preferElevator,
            nextTrainArrivalMinutes,
          });

        const corridorSteps = pedestrianNav.getIndoorTransferCorridorPlan({
          stationName: transferStationName,
          fromLine: currentLine,
          toLine: transferTargetLine,
        });

        return sendJson(res, 200, {
          platformResult,
          arrivalSource,
          corridorSteps,
          earcon: platformResult.isCorrectPlatform
            ? "TRANSIT_ARRIVING"
            : "HAZARD_ALERT",
          priority: "P1_NAVIGATION",
        });
      }

      if (req.method === "POST" && url.pathname === "/api/transit/bus-check") {
        const body = await readJsonBody(req);
        const observedArsId = body.observedArsId
          ? String(body.observedArsId)
          : "22-001";
        const targetRouteNumber = String(body.targetRouteNumber ?? "140");
        const intendedDirectionKeyword = String(
          body.intendedDirectionKeyword ?? "양재역",
        );
        const approachingBuses = Array.isArray(body.approachingBuses)
          ? body.approachingBuses
          : [
              { order: 1, routeNumber: "143" },
              {
                order: 2,
                routeNumber: targetRouteNumber,
                doorDistanceMeters: 4,
                isDoorOpen: true,
              },
            ];

        const result =
          body.useLiveSeoulApi !== false
            ? await transitProvider.fetchSeoulBusStopGuidanceLive({
                observedArsId,
                targetRouteNumber,
                intendedDirectionKeyword,
                approachingBusesFromVision: approachingBuses,
              })
            : transitProvider.queryBusStopGuidance({
                observedArsId,
                targetRouteNumber,
                intendedDirectionKeyword,
                approachingBusesFromVision: approachingBuses,
              });

        return sendJson(res, 200, {
          result,
          earcon: result.isCorrectDirection
            ? "TRANSIT_ARRIVING"
            : "HAZARD_ALERT",
          priority: "P1_NAVIGATION",
        });
      }

      if (req.method === "POST" && url.pathname === "/api/kiosk/hand-coach") {
        const body = await readJsonBody(req);
        const spokenGuidance = coachFingertipToButtonKo({
          deltaXCm: Number(body.deltaXCm ?? 3),
          deltaYCm: Number(body.deltaYCm ?? -1),
          targetLabel: String(body.targetLabel ?? "김치찌개 단품(9,000원)"),
        });
        return sendJson(res, 200, {
          spokenGuidance,
          earcon: "TARGET_FOUND",
          priority: "P1_NAVIGATION",
        });
      }

      if (req.method === "POST" && url.pathname === "/api/memory/find") {
        const body = await readJsonBody(req);
        const result = memoryStore.findObjectKo(
          String(body.query ?? "에어팟"),
        );
        return sendJson(res, 200, {
          ...result,
          earcon: result.found ? "TARGET_FOUND" : "SCANNING_TICK",
          priority: "P2_COMPANION",
        });
      }

      if (req.method === "POST" && url.pathname === "/api/reader/expiry") {
        const body = await readJsonBody(req);
        const result = smartReader.summarizeFoodExpiry({
          productName: String(body.productName ?? "서울우유 1L"),
          expiryDateIso: String(body.expiryDateIso ?? "2026-11-18"),
          containerPositionHint: body.containerPositionHint
            ? String(body.containerPositionHint)
            : "위칸 오른쪽",
        });
        return sendJson(res, 200, {
          ...result,
          earcon: result.isExpired ? "HAZARD_ALERT" : "SCANNING_TICK",
          priority: result.isExpired ? "P0_SAFETY" : "P2_COMPANION",
        });
      }

      if (req.method === "POST" && url.pathname === "/api/mission/start") {
        const body = await readJsonBody(req);
        const resMission = skillHarness.startMission(
          String(body.goalText ?? ""),
        );
        return sendJson(res, 200, resMission);
      }

      if (req.method === "POST" && url.pathname === "/api/nav/search") {
        const body = await readJsonBody(req);
        const query = String(body.query ?? "이마트");
        const originLat = Number(body.originLat ?? 37.5006);
        const originLng = Number(body.originLng ?? 127.0364);
        const searchRes = await pedestrianNav.searchDestinationCandidates({
          query,
          originLat,
          originLng,
        });
        return sendJson(res, 200, searchRes);
      }

      if (req.method === "POST" && url.pathname === "/api/nav/confirm") {
        const body = await readJsonBody(req);
        const originAddressKo = String(body.originAddressKo ?? "현재 위치");
        const originLat = Number(body.originLat ?? 37.5006);
        const originLng = Number(body.originLng ?? 127.0364);
        const destination = body.destination;
        const confirmed = await pedestrianNav.buildConfirmedPedestrianRoute({
          originAddressKo,
          originLat,
          originLng,
          destination,
        });
        skillHarness.startMission(
          `${destination.shortAddressKo} (${destination.name})`,
        );
        return sendJson(res, 200, confirmed);
      }

      if (req.method === "POST" && url.pathname === "/api/vision/analyze") {
        const body = await readJsonBody(req);
        if (!body.mode || body.mode === "AUTO") {
          const imageBase64 = body.imageBase64
            ? String(body.imageBase64)
            : undefined;
          const stepRes = await skillHarness.stepFrame(visionAgent, {
            imageBase64,
            imageMimeType: body.imageMimeType ?? "image/jpeg",
            userQuery: body.userQuery ? String(body.userQuery) : undefined,
          });
          const logRecord = feedbackStore.addInferenceRecord({
            id: `inf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestampIso: new Date().toISOString(),
            deviceSource: body.deviceSource === "ANDROID_GLASS_APK"
              ? "ANDROID_GLASS_APK"
              : "WEB_COMPANION",
            model: stepRes.model,
            latencyMs: stepRes.latencyMs,
            detectedMode: stepRes.detectedMode,
            detectedModeLabelKo: stepRes.detectedModeLabelKo,
            activeCandidateSkills: stepRes.activeCandidateSkills,
            extractedSlots: stepRes.extractedSlots,
            spokenKorean: stepRes.spokenKorean,
            imageBase64,
          });
          return sendJson(res, 200, { ...stepRes, logId: logRecord.id, logRecord });
        }
        const response = await visionAgent.analyzeSceneForMode({
          mode: body.mode,
          userQuery: String(
            body.userQuery ?? "지금 내 눈앞에 뭐가 있는지 시계 방향으로 알려줘",
          ),
          imageBase64: body.imageBase64 ? String(body.imageBase64) : undefined,
          imageMimeType: body.imageMimeType ?? "image/jpeg",
          extraContext: body.extraContext
            ? String(body.extraContext)
            : undefined,
        });
        return sendJson(res, 200, response);
      }

      if (req.method === "GET" && url.pathname === "/api/feedback/logs") {
        return sendJson(res, 200, {
          logs: feedbackStore.listRecords(100),
        });
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/update") {
        const body = await readJsonBody(req);
        const updated = feedbackStore.updateFeedback({
          id: String(body.id ?? ""),
          vote: body.vote,
          feedbackText: body.feedbackText,
        });
        if (!updated) {
          return sendJson(res, 404, { error: "Record not found" });
        }
        return sendJson(res, 200, { ok: true, record: updated });
      }

      if (req.method === "POST" && url.pathname === "/api/feedback/sync") {
        const body = await readJsonBody(req);
        const records = Array.isArray(body.records) ? body.records : [];
        const resStats = feedbackStore.mergeDeviceRecords(records);
        return sendJson(res, 200, { ok: true, ...resStats });
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const htmlPath = path.join(PUBLIC_DIR, "index.html");
        const html = fs.readFileSync(htmlPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : "Internal Server Error",
      });
    }
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4310);
  const host = process.env.HOST ?? "0.0.0.0";
  const server = createCompanionServer();
  server.listen(port, host, () => {
    console.log(
      `SOTA Smart Glass Companion Server listening on http://127.0.0.1:${port} (LAN & Emulator 10.0.2.2:${port} enabled)`,
    );
  });
}
