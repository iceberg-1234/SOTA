import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  InferenceFeedbackStore,
  type InferenceFeedbackRecord,
} from "../../packages/core/feedback-store.ts";
import { triageUnprocessedFeedbackToLinear } from "../../packages/core/linear-backlog.ts";

const ADB = path.join(
  os.homedir(),
  "Library/Android/sdk/platform-tools/adb",
);

function tryPullFromConnectedDevice(store: InferenceFeedbackStore): number {
  try {
    const rawJson = execFileSync(
      ADB,
      [
        "exec-out",
        "run-as",
        "ai.lumo.glass",
        "cat",
        "files/lumo_feedback_logs.json",
      ],
      {
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    if (!rawJson || rawJson.includes("No such file")) {
      return 0;
    }

    const records = JSON.parse(rawJson) as InferenceFeedbackRecord[];
    const { mergedCount } = store.mergeDeviceRecords(records);
    return mergedCount;
  } catch {
    return 0;
  }
}

async function main() {
  const store = new InferenceFeedbackStore();
  const pulledCount = tryPullFromConnectedDevice(store);

  if (pulledCount > 0) {
    console.log(`📱 연결된 Android 기기에서 ${pulledCount}건의 추론 로그를 동기화했습니다.`);
  } else {
    console.log(
      "ℹ️ USB로 연결된 기기가 없거나 새 기기 로그가 없어 로컬 저장소(feedback-logs/inference-feedback.json) 기준으로 검사합니다.",
    );
  }

  const result = await triageUnprocessedFeedbackToLinear(store);
  console.log(
    `⏭️ 이미 티켓화되어 건너뛴 피드백: ${result.skippedAlreadyProcessedCount}건`,
  );

  if (result.createdTickets.length === 0) {
    console.log("✅ 새로 처리할 미처리(Unprocessed) 피드백이 없습니다.");
    return;
  }

  console.log(
    `\n🎫 신규 Linear 개발 개선 티켓 ${result.createdTickets.length}건 생성 완료:`,
  );
  for (const t of result.createdTickets) {
    console.log(
      `  • [${t.linearIssueId}] (${t.detectedMode}) "${t.feedbackText || "비추천 추론 개선"}" -> ${t.linearIssueUrl}`,
    );
  }
}

main();
