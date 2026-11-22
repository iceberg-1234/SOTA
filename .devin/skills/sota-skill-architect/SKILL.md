---
name: sota-skill-architect
description: Design, generate, and audit general-purpose, zero-hardcoding SOTA Micro-Skills for visually impaired smart-glass use cases using 2-Tier Expert Playbooks, English-Core instructions, Temporal Slot Memory, and Physics-Aware View-Finding.
---

# SOTA Universal Skill Architect Skill

Use this skill whenever creating a new Use Case skill or auditing/refactoring existing skills in SOTA. Every skill MUST be general-purpose (usable by any person in any city/station/store without hardcoded dummy values) and follow the **2-Tier Expert Playbook + English-Core (`E2K`)** architecture.

## 1. Open-Source & Rehabilitation Foundations

Every SOTA Micro-Skill synthesizes proven patterns from leading open-source multimodal AI systems and Orientation & Mobility (O&M) / Independent Living Skills (ILS) rehabilitation standards:

1. **2-Tier Routing vs. Deep Domain Playbook (inspired by `BasedHardware/omi` & `livekit/agents`)**:
   - **Tier 1 (Lightweight Router Trigger — 1 line)**: Shown in the Global Scene Switch Directory when inactive (~10 tokens/skill) so SOTA can switch to any of the 16+ skills in a single frame without prompt bloat.
   - **Tier 2 (`expertPlaybook` — injected ONLY when active)**: Provides deep O&M / ILS domain expertise (`visualScanChecklist`, `realLifeValueFormula`, `confounderAndSafetyGuards`, `physicalAimingGuide`) so the VLM delivers genuine daily-living value rather than shallow image captioning.
2. **Zero-Hardcoding & Structured Failure Reason Contract (inspired by `OpenInterpreter/01` & MCP Tool Spec)**:
   - NEVER hardcode fallback entities (such as a specific station name, screen door `"5-3"`, or bus stop `"22-001"`). All target entities must come from observed slots, the 15-second `TemporalSlotCache`, or the active `MissionContext` / `LocalePack`.

## 2. The 6-Point Universal Skill Contract (Checklist)

Before registering or modifying a skill, verify all 6 requirements:

1. **4-Part `expertPlaybook` Completeness**:
   - `visualScanChecklist`: Step-by-step order of visual details to inspect (e.g., container type -> seal/remaining amount -> cap/side expiration stamp).
   - `realLifeValueFormula`: Actionable information hierarchy for blind independence (e.g., obstacle avoidance + shoreline re-alignment; food name + open/remaining state + expiry D-Day; dining layout + utensils/water cup + bone hazard).
   - `confounderAndSafetyGuards`: Critical look-alike hazards (e.g., eyedrops vs glue/topical ointment; `MANUFACTURED` vs `EXPIRY` date; indoor room window vs subway train door window; wait vs safe-to-cross remaining seconds).
   - `physicalAimingGuide`: Shape-specific camera/hand adjustment when details are out of view (e.g., rotate bottle neck half a turn, touch bottom-right screen bezel first).
2. **English-Core Prompt & Schema + Target-Locale Spoken Output (`E2K` Pattern)**:
   - Write rules and playbooks in concise **English** with bilingual local visual anchors (`tactile paving (점자블록)`), and output final speech in natural conversational Korean (`ko-KR`).
3. **Zero Hardcoded Fallbacks**:
   - Never substitute dummy IDs when a slot is missing; check `TemporalSlotCache` (15s) or trigger view-finding coaching.
4. **Physics-Aware Active View-Finding (`unreadableReason` Slot)**:
   - Support `TOO_FAR`, `TOO_CLOSE_BLUR`, `OCCLUDED_BY_HAND`, `WRONG_SIDE`, `TILT_UP`, `TILT_DOWN`, `GLARE`.
5. **Safety-Preserving Output Merge**:
   - Preserve immediate obstacle or crowd warnings from `draftSpokenKorean` alongside Layer 2 calculations.
6. **Turn-Level QA Regression Coverage**:
   - Register positive, confounder, and unreadable assertions in `apps/scenario-simulator/qa-suite.ts`.
