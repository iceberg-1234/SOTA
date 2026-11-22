# SOTA Project Guide (AGENTS.md)

## Commands
- Run all unit & integration tests (Node 22 native TypeScript):
  `npm test`
- Run the full-day Korean visually impaired simulation (`UC-01` ~ `UC-13`):
  `npm run simulate`
- Start the Interactive Smart Glass Companion Web Server (`http://0.0.0.0:4310`):
  `npm start`
- Build the Android Pilot APK (`apps/android-glass-poc/build/outputs/apk/debug/sota-android-glass-poc-debug.apk`):
  `npm run android:build`
- Install APK, bind `adb reverse tcp:4310 tcp:4310`, grant Camera/Mic/Location permissions, and launch on connected Emulator or Real Device:
  `npm run android:install`
- Launch the local Android Emulator (`Medium_Phone_API_36.1`):
  `npm run android:emulator`

## Secrets & Security
- Never hardcode API keys in source files or commit them to Git.
- The Gemini API Key is stored in the macOS Keychain under the service name `SOTA_GEMINI_API_KEY`:
  - Read via `packages/core/keychain.ts` (`security find-generic-password -s SOTA_GEMINI_API_KEY -w`) or `GEMINI_API_KEY` env var fallback.
  - Default low-latency model verified with this key: `gemini-3.5-flash-lite` on `generativelanguage.googleapis.com/v1beta`.
- Seoul/Metropolitan Public Transit & TMAP API keys (when issued) are stored in the macOS Keychain under:
  - `SOTA_SEOUL_SUBWAY_API_KEY` (Seoul Open Data Plaza `swopenAPI.seoul.go.kr` realtime subway arrival)
  - `SOTA_SEOUL_BUS_API_KEY` (Seoul/Metropolitan Bus `ws.bus.go.kr` / data.go.kr)
  - `SOTA_TMAP_API_KEY` (SKT TMAP POI, Pedestrian & Public Transit Routing)

## Local-First Iteration & Pull Request Rules (MANDATORY — Use `/sota-github-pr` Skill)
- Always invoke the `/sota-github-pr` skill (`.devin/skills/sota-github-pr/SKILL.md`) whenever preparing, pushing, or opening/updating a GitHub Pull Request.
- **Local-First Workflow (No Auto-PR per feature)**:
  - Do NOT automatically `git push` or open a GitHub Pull Request after every individual feature or bugfix.
  - Develop, iterate, and test locally first (`npm run qa`, `npm test`, `npm run android:build`, `npm run android:install` on the connected device).
  - Only create a commit/branch/PR when the user explicitly requests to push or open a PR after local verification.
- **Pre-PR Verification Checklist (`npm run pre-pr` — MUST run before every PR)**:
  1. **Zero Secret & Internal File Leakage**: Ensure `ONE_PAGER.md`, `PRD.md`, `feedback-logs/`, `packages/core/linear-backlog.ts`, `apps/android-glass-poc/triage-feedback.ts`, `.devin/mcp_config.json`, `.devin/skills/feedback-triage/`, and any API keys or `LINEAR` references are NEVER tracked in Git.
  2. **Universal Skill Contract (`/sota-skill-architect`)**: Every skill must use `English-Core + Target-Locale Output`, have zero hardcoded station/door/stop fallback IDs, handle `unreadableReason` view-finding coaching, and defend against confounders.
  3. **SkillSpector Security Scan**: If any `.devin/skills/*` file was added or modified, run `skillspector scan <skill-dir> --no-llm` and report the score (`0/100 LOW`) in the PR body.
  4. **QA & Test Gate**: `npm run pre-pr` (`npm run qa` + `npm test` + repository hygiene check) and `npm run android:build` must pass with 0 errors.
