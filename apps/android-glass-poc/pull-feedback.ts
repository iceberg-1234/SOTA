import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  InferenceFeedbackStore,
  type InferenceFeedbackRecord,
} from "../../packages/core/feedback-store.ts";

const ADB = path.join(
  os.homedir(),
  "Library/Android/sdk/platform-tools/adb",
);

function main() {
  const store = new InferenceFeedbackStore();

  try {
    const rawJson = execFileSync(
      ADB,
      [
        "exec-out",
        "run-as",
        "ai.sota.glass",
        "cat",
        "files/sota_feedback_logs.json",
      ],
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
    ).trim();

    if (!rawJson || rawJson.includes("No such file")) {
      console.log("ℹ️ 기기에 아직 저장된 추론/피드백 로그가 없습니다.");
      return;
    }

    const records = JSON.parse(rawJson) as InferenceFeedbackRecord[];
    const { totalCount, mergedCount } = store.mergeDeviceRecords(records);

    console.log("====================================================================");
    console.log(
      `✅ 기기에서 ${mergedCount}건의 AI 추론 및 피드백 로그를 성공적으로 가져왔습니다! (총 ${totalCount}건 보관 중)`,
    );
    console.log("   저장 경로: feedback-logs/inference-feedback.json");
    console.log("====================================================================\n");

    const withFeedback = records.filter(
      (r) => r.vote !== "NONE" || (r.feedbackText && r.feedbackText.trim() !== ""),
    );
    if (withFeedback.length > 0) {
      console.log(`📌 사용자 피드백이 작성된 항목 (${withFeedback.length}건):`);
      for (const item of withFeedback) {
        const icon = item.vote === "UP" ? "👍 추천" : item.vote === "DOWN" ? "👎 비추천" : "💬 메모";
        console.log(
          `  • [${item.timestampIso}] ${icon} | AI 추론 상황: [${item.detectedMode}] (${item.detectedModeLabelKo}) | ${item.latencyMs}ms`,
        );
        console.log(`    - AI 답변: "${item.spokenKorean}"`);
        if (item.feedbackText) {
          console.log(`    - 사용자 피드백: "${item.feedbackText}"`);
        }
      }
    }
  } catch (err) {
    console.error(
      "❌ 기기에서 피드백 로그를 가져오지 못했습니다. USB 디버깅 연결 상태를 확인해 주세요.",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

main();
