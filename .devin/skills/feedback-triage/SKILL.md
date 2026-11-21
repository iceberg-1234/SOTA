---
name: feedback-triage
description: Pull inference feedback logs from the connected Lumo Android device, create Linear tickets only for unprocessed feedback, and apply skill improvements
triggers:
  - user
  - model
---

# Lumo Field Feedback Triage & Improvement Skill

Use this skill whenever the user asks to pull field test feedback from the device, triage new user feedback into Linear development improvement tickets, or improve Lumo's AI skills based on recorded `👎 비추천` / detailed feedback notes.

## Workflow

1. **Pull Device Feedback & Create Linear Tickets for Unprocessed Items Only**:
   - Run `npm run feedback:triage`
   - This command automatically:
     1. Pulls `files/lumo_feedback_logs.json` from a USB-connected Android device (if attached) and merges into `feedback-logs/inference-feedback.json`.
     2. Skips any feedback record that already has `linearIssueId` populated (preventing duplicate tickets).
     3. Creates a new Linear ticket in the `LUM` team for each unprocessed record where `vote === "DOWN"` or `feedbackText` is non-empty, and saves `linearIssueId`, `linearIssueUrl`, and `processedAtIso` onto the record.

2. **Inspect Newly Triaged Feedback & Apply Code/Skill Improvements**:
   - Read `feedback-logs/inference-feedback.json` and inspect the records that were just triaged (looking at `detectedMode`, `spokenKorean`, `vote`, and `feedbackText`).
   - Update the relevant skill definition in `packages/locale-ko-kr/skills.ts`, `packages/core/agent-harness.ts`, or `apps/android-glass-poc/src/main/java/ai/lumo/glass/NativeLumoAiClient.kt` to address the user's feedback.

3. **Verify & Sync**:
   - Run `npm test` and `npm run android:build` to ensure all tests pass and the updated Android APK is ready.
   - Run `npm run sync:linear` to keep the Linear roadmap synchronized.
