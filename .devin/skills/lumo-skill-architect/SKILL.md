---
name: lumo-skill-architect
description: Design, generate, and audit general-purpose, zero-hardcoding Lumo Micro-Skills for visually impaired smart-glass use cases using English-Core instructions, Temporal Slot Memory, and Physics-Aware View-Finding.
---

# Lumo Universal Skill Architect Skill

Use this skill whenever creating a new Use Case skill or auditing/refactoring existing skills in Lumo. Every skill MUST be general-purpose (usable by any person in any city/station/store without hardcoded dummy values) and follow the **English-Core + Target-Locale Output** architecture.

## 1. Open-Source Architectural Foundations

Every Lumo Micro-Skill synthesizes proven patterns from leading open-source multimodal & wearable AI systems:

1. **Capability Surface & Latency Class Separation (inspired by `BasedHardware/omi`)**:
   - Declare the physical `surface` (`OUTDOOR_WALK`, `TRANSIT`, `INDOOR_DAILY`, `ANY`) so the **Context Gate** masks out mutually exclusive skills (never loading kitchen stove rules on a subway train, or keeping <= 4 active micro-skills per prompt).
   - Separate **Layer 1 Perception (Single-Pass VLM slot extraction)** from **Layer 2 Deterministic Execution (API lookup, date/distance math, state transitions)**.
2. **Small Task Handoff & Turn-Level Scenario Grading (inspired by `livekit/agents` & `livekit/agent-skills`)**:
   - Keep each Micro-Skill focused on a single visual/situational job (1 Use Case = 1 Micro-Skill).
   - Pair every skill with positive and negative (confounder/unreadable) assertions in the automated QA suite.
3. **Zero-Hardcoding & Structured Failure Reason Contract (inspired by `OpenInterpreter/01` & MCP Tool Spec)**:
   - **NEVER hardcode fallback entities** (such as a specific station name, screen door `"5-3"`, bus stop `"22-001"`, or brand name) inside a skill's execution handler. All target entities must come from observed slots, the 15-second `TemporalSlotCache`, or the active `MissionContext` / `LocalePack`.

## 2. The 5-Point Universal Skill Contract (Checklist)

Before a skill is registered, verify all 5 requirements:

1. **English-Core Prompt & Schema + Target-Locale Spoken Output (`E2K` Pattern)**:
   - Write `triggerDescription` and `extractionRules` in concise **English** (with bilingual local visual anchors where helpful, e.g., `tactile paving (점자블록)`, `screen door code (스크린도어 번호)`).
   - Keep extracted text values in their observed script and produce the final spoken output in the user's target locale (`ko-KR`).
2. **Zero Hardcoded Fallbacks**:
   - If a required slot (`door`, `nextStation`, `arsId`, `expiryDate`, `taxiPlate`) is missing after checking both the current frame and the 15-second `TemporalSlotCache`, do NOT substitute a dummy constant. Trigger **Physics-Aware Active View-Finding** instead.
3. **Physics-Aware Active View-Finding (`unreadableReason` Slot)**:
   - Instruct the VLM to emit `unreadableReason` when a target cannot be read clearly, and map each reason to a physical action the blind user can perform:
     - `TOO_FAR`: Walk 2-3 steps closer toward the sign/target.
     - `TOO_CLOSE_BLUR`: Hold the item about one hand-span (20-30cm) away from the camera.
     - `OCCLUDED_BY_HAND`: Shift fingers slightly down or to the edge of the package.
     - `WRONG_SIDE`: Slowly rotate or flip the container half a turn to expose the label.
     - `TILT_UP` / `TILT_DOWN`: Tilt the head/camera slightly up or down.
     - `GLARE`: Angle the object or head slightly to reduce reflection.
4. **Confounder Defense (Negative Constraints)**:
   - Explicitly distinguish look-alike hazards in the skill rules:
     - `MANUFACTURED_DATE` (`제조일자`) vs `EXPIRY_DATE` (`소비기한/유통기한`).
     - Indoor room window (`INDOOR_SPACE`) vs subway train door window (`SUBWAY_ON_BOARD`).
     - Waiting on platform (`SUBWAY_PLATFORM`) vs actually open train doors.
5. **Safety-Preserving Output Merge**:
   - When Layer 2 generates a deterministic calculation (e.g., D-Day count, transfer door steps, bus arrival time), preserve any immediate obstacle or crowd warning detected in `draftSpokenKorean`.
