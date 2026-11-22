## Summary
- 

## Pre-PR Verification Checklist (`npm run pre-pr`)
- [ ] **Local Field & Device Testing Completed**: Verified locally (`npm run android:install` / simulator) before opening PR.
- [ ] **Zero Secrets & Zero Internal Files**: `git ls-files` contains no API keys, no `feedback-logs/`, no `ONE_PAGER.md` / `PRD.md`, and no internal Linear scripts (`linear-backlog.ts`, `triage-feedback.ts`, `mcp_config.json`).
- [ ] **Universal Skill Contract (`/sota-skill-architect`)**: All new/modified skills use `English-Core + Target-Locale Output`, have zero hardcoded fallback entities, include `unreadableReason` view-finding coaching, and defend against confounders.
- [ ] **SkillSpector Security Scan**: Scanned modified `.devin/skills/*` directories (`skillspector scan <dir> --no-llm` → Score: `0/100 LOW`).
- [ ] **Automated QA & Tests Pass**: `npm run pre-pr` (`npm run qa` + `npm test`) and `npm run android:build` pass with 0 errors.
