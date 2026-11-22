---
name: sota-github-pr
description: Manage SOTA's Local-First development workflow and Pre-PR verification pipeline (secret/internal-file hygiene, QA suite, Android build, SkillSpector scan, and clean branch/PR creation) whenever preparing, pushing, or opening a GitHub Pull Request.
---

# SOTA GitHub PR & Release Hygiene Skill

Invoke this skill whenever preparing repository changes for GitHub, checking release readiness, or opening/updating a Pull Request in `sota`.

## 1. Local-First Policy (No Automatic PRs)

- **Do NOT push or open a PR after every individual feature or bugfix.**
- Keep changes local while iterating and testing on the simulator and connected Android device (`npm run android:build && npm run android:install`).
- Proceed to commit, push, and open a Pull Request **ONLY when the user explicitly asks** to push or open a PR.

## 2. Mandatory Pre-PR Pipeline

Execute all steps in order before pushing any branch to `origin`:

1. **Automated Hygiene, QA & Test Gate**:
   - Run `npm run pre-pr`.
   - Confirm zero tracked internal/private files (`ONE_PAGER.md`, `PRD.md`, `linear-backlog.ts`, `triage-feedback.ts`, `mcp_config.json`, `feedback-triage`, `feedback-logs/`, `.env`, `*.apk`).
   - Inspect `git status -s` and `git diff` to ensure zero hardcoded API keys, tokens, or personal LAN IPs.
2. **Android Build & Universal Skill Audit**:
   - If files under `apps/android-glass-poc/` changed, run `npm run android:build` and confirm `BUILD SUCCESSFUL`.
   - If any Micro-Skill in `skills.ts` or `NativeSotaAiClient.kt` changed, verify compliance with `/sota-skill-architect` (English-Core + Target-Locale Output, Zero Hardcoding, 2-Tier `expertPlaybook`, `unreadableReason` coaching).
3. **SkillSpector Security Scan**:
   - For every added or modified directory under `.devin/skills/`, run:
     `skillspector scan .devin/skills/<skill-name> --no-llm`
   - Treat `HIGH` or `CRITICAL` findings as blockers. Include the exact score (e.g. `0/100 LOW`) in the PR body.
4. **Branch & Merged-PR Check**:
   - Run `git fetch origin main` and check `gh pr list --state all --limit 5`.
   - If the current branch's PR was already `MERGED`, create a new branch from `origin/main` (`git checkout -b feat/<short-topic> origin/main`) rather than pushing new commits onto an already-merged branch.
5. **Create Pull Request**:
   - Stage clean files, commit with a concise why-focused message, push with `-u origin <branch>`, and run `gh pr create` populated with the `.github/PULL_REQUEST_TEMPLATE.md` checklist.
