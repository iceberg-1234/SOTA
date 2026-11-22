# Country Localization & Micro-Skill Development Guide

SOTA's core engine (`packages/core/`) is **100% language- and country-agnostic**. Every prompt rule and slot schema inside SOTA is written in **English-Core (`E2K` pattern)** so contributors worldwide can collaborate on a single reasoning standard while delivering natural spoken guidance in any target language (`en-US`, `ja-JP`, `es-ES`, `fr-FR`, `de-DE`, `pt-BR`, `ko-KR`, etc.).

This guide explains how to:
1. Create a **Country / Language Locale Pack** (`packages/locale-<lang-region>/`), and
2. Build or extend **2-Tier O&M / ILS Micro-Skills** that genuinely help blind and low-vision users in real daily life.

---

## 1. Anatomy of a Country Locale Pack

Use `packages/locale-ko-kr/` as the reference implementation when creating `packages/locale-<lang-region>/`:

```text
packages/locale-<lang-region>/
├── index.ts              # System persona prompt & localized summary formatters
├── skills.ts             # 16+ Micro-Skills with 2-Tier Expert Playbooks & Layer-2 post-processors
├── pedestrian-nav.ts     # Wayfinding provider (Google Maps Platform by default globally)
├── transit-provider.ts   # Real-time local subway/bus/train arrival adapter (GTFS-RT or Google Routes)
└── subway-transfer-db.ts # Optional major station fast-transfer / exit rules
```

### Global vs. Country-Specific Map & Transit APIs
- **Global Standard (`Google Maps Platform`)**:
  - For most countries (`en-US`, `en-GB`, `ja-JP`, EU, LATAM, SEA), implement wayfinding against **Google Places API (New)** and **Google Routes API** (`WALK` + `TRANSIT` modes) using `GOOGLE_MAPS_API_KEY`, paired with local **GTFS-Realtime** feeds where available.
  - Apply **blind-conservative walking speed calibration (`~0.85 m/s` white-cane pace + station elevator/platform buffer)** rather than sighted sprinting ETAs.
- **Regional Overrides (e.g., `locale-ko-kr`)**:
  - Where global map APIs have regulatory pedestrian restrictions (such as South Korea), encapsulate country-specific providers (like TMAP) strictly inside that locale package so `packages/core/` remains clean.

---

## 2. What Must Be Localized Beyond Mere Translation

Translating strings word-for-word is **not** enough for safe Orientation & Mobility (O&M) and Independent Living Skills (ILS). When building a locale pack for your country, investigate and encode these 5 local realities:

1. **Sidewalk & Crosswalk Infrastructure**:
   - What do tactile paving blocks mean locally (e.g., blister dots = stop/junction vs. directional bars = go)?
   - How do pedestrian crosswalk signals behave (flashing hand countdown in North America, acoustic bird chirps in Japan, green person + seconds in Korea/EU)?
2. **Public Transit Boarding Mechanics**:
   - Are subway platforms equipped with numbered screen doors, car-floor markings, or open tracks requiring stricter edge-distance warnings?
   - Do city buses board from the front door, middle door, or all doors, and where is the transit card reader located?
3. **Food, Beverage & Medication Labeling Laws**:
   - Which date formats are stamped on packages (`MM/DD/YYYY` in the US vs. `DD/MM/YYYY` in Europe vs. `YYYY.MM.DD` in East Asia)?
   - Distinguish local terms such as `Use By` / `Best Before` vs. `MFG / Lot Code`, and note categories exempt from expiration dates (for instance, frozen desserts in some jurisdictions print only manufacturing dates).
4. **Currency, Bills & Kiosk/Keypad Conventions**:
   - Paper bill denominations (especially in countries where bills share identical physical sizes, such as USD!), local contactless payment pad positions, and apartment intercom layouts.
5. **Natural Spoken Spatial Idioms (No Screen-Reader Symbols)**:
   - Never output symbols (`→`, `[`, `]`, `/`) or robotic clock-face jargon (`"at 2 o'clock"`) unless requested. Use natural movement-relative speech in the target language (*"two steps ahead on your right"*, *"turn slightly left and follow the curb"*).

---

## 3. Authoring a Micro-Skill (`SotaSkillPlugin` Contract)

Every Micro-Skill follows a **2-Tier Architecture** so SOTA responds in `< 2 seconds` without sacrificing deep domain reasoning:

- **Tier 1 (`triggerDescriptionKo` / Router Line)**: A single 1-line English description (~12 tokens) shown in the global scene switch directory when the skill is inactive, enabling single-frame switching across all 16+ skills.
- **Tier 2 (`expertPlaybook`)**: Injected **only** when the skill is inside the active Context Gate (`≤ 4` skills). Must define all 4 fields:

```ts
import type { SotaSkillPlugin } from "../core/agent-harness.ts";

export const groceryScannerSkill: SotaSkillPlugin = {
  id: "GROCERY_SCANNER",
  labelKo: "Grocery Look-Alike & Promo Scanner",
  triggerDescriptionKo:
    "Supermarket or convenience-store cans, bottles, packaged food, shelf price tags, or BOGO badges",
  extractionRulesKo:
    "`[GROCERY_SCANNER | product=..., flavor=..., zeroSugar=true|false, price=..., promo=..., unreadableReason=...]`",
  expertPlaybook: {
    visualScanChecklist: [
      "1. Distinguish look-alike variants: Original vs Zero-Sugar, Decaf vs Regular, Allergens",
      "2. Verify that the shelf price tag text directly beneath matches the held product",
      "3. Check BOGO / multi-buy badges or compare left-hand vs right-hand items",
    ],
    realLifeValueFormula:
      "[Exact Brand + Variant/Zero-Sugar] + [Verified Price] + [Active Promo]",
    confounderAndSafetyGuards: [
      "Never announce a neighboring item's shelf price if the label product name does not match",
    ],
    physicalAimingGuide:
      "Hold the front label steady at chest height ~25cm away; include the shelf strip below to check price.",
  },
  relatedSkillIds: ["SMART_READER", "KIOSK_COACH"],
  priority: "P2_COMPANION",
  earcon: "TARGET_FOUND",
  executePostProcess: async (obs) => {
    // Deterministic Layer-2 validation, formatting & anti-hallucination guards
    return obs.draftSpokenKorean;
  },
};
```

---

## 4. Mandatory 6-Point Quality Gate Before Opening a PR

Before submitting a new skill or locale pack:

1. **English-Core Rules + Target-Locale Spoken Output**: Keep internal instructions in concise English (`E2K`) and emit spoken output in your locale's natural conversational phrasing.
2. **Zero Hardcoded Fallbacks**: Never hardcode a dummy station name, bus number, door code, or date when a slot is unreadable.
3. **Zero Date / Number Hallucination**: Verify extracted dates against real calendar validity (`isValidRealIsoDate`) and require visible stamped digits; if out of view, emit `unreadableReason=WRONG_SIDE` and coach how to rotate the object.
4. **Physics-Aware View-Finding**: Handle `TOO_FAR`, `TOO_CLOSE_BLUR`, `OCCLUDED_BY_HAND`, `WRONG_SIDE`, `TILT_UP`, and `GLARE` with object-specific physical guidance.
5. **Add Regression Scenarios**: Add positive, confounder, and unreadable test cases to `apps/scenario-simulator/qa-suite.ts` and `tests/sota.test.ts`.
6. **Run Pre-PR Verification**:
   ```bash
   npm run pre-pr
   ```
