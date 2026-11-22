<div align="center">

# SOTA

**An Open-Source AI Smart-Glass Companion for Blind and Low-Vision Independence**

![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)
![Release Stage](https://img.shields.io/badge/Stage-v0.2.0--poc%20(Field%20Alpha)-amber.svg)
![Platform](https://img.shields.io/badge/Android%20XR-AI%20Glasses%20Ready-3DDC84.svg)

*Eye-level perception, hands-free mobility, and independent daily living — built in the open for every city and language.*

[Why We Started SOTA](#why-we-started-sota) •
[Concrete Use Cases](#what-sota-helps-with-in-daily-life) •
[Our Vision](#the-world-we-dream-of) •
[Release Status](#release-status--roadmap) •
[Architecture](#repository-structure--architecture) •
[Getting Started](#getting-started) •
[Test App Guide](#using-the-android-test-app) •
[Contributing & Localization](#contributing--global-localization) •
[Built With AI](#built-with-ai)

</div>

---

## Why We Started SOTA

Screen readers and smartphone accessibility apps have transformed information access for blind and low-vision people. Yet throughout a real day—walking down a busy street, transferring subways, sorting morning vs. evening prescription pouches, telling apart identical-feeling shampoo and conditioner bottles, or checking whether food in the fridge is past its expiration date—**there are moments when your hands are already occupied and awareness needs to happen naturally at eye level**:

- Outdoors, one hand holds a **white cane or guide-dog harness**, while the other often holds a handrail, an umbrella, or a bag.
- At home, everyday items that **feel identical by touch—medicine pouches, eyedrop vials, pump bottles of shampoo vs. body wash, or sealed side-dish tubs—** require holding and rotating the object with both hands while reading fine print or tiny ink-jet expiration stamps (*"rotate the bottle neck half a turn"*), which works far more naturally from a head-worn camera aligned with your own gaze.
- Across public spaces, **flat capacitive touch kiosks, unlabelled apartment entrance keypads, frameless glass doors, and digital appliance panels** offer zero tactile or Braille cues (surveys show over 85% of visually impaired people cannot rely on Braille in daily environments because markings are absent or sight loss occurred later in life).

We started **SOTA** to bring low-latency, rehabilitation-informed visual assistance to open AI smart glasses—keeping both hands free while speaking concise, actionable guidance like a trusted companion walking beside you.

---

## What SOTA Helps With in Daily Life

SOTA's growing library of **16+ Context-Gated Micro-Skills** already supports **23+ concrete daily scenarios** from morning wake-up to returning home at night—and continues to expand as new real-world skills are added:


| Daily Moment                  | Concrete Real-World Use Cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Walking & Street Safety**   | • **Obstacle Avoidance + Shoreline Re-alignment**: Detecting e-scooters, motorcycles, or bollards blocking tactile paving—and guiding how to return to the tactile line or curb afterward.<br>• **Low-Contrast Drop-Offs & Glass Doors**: Spotting uncolored grey downward stairs and frameless glass doors, including whether to *push*, *pull*, or press an auto-door pillar button.<br>• **Crosswalk Signals & Glare**: Reading pedestrian signals and remaining seconds even under strong backlight, advising whether it is safe to cross now or wait for the next cycle.<br>• **Dark Adaptation Support**: Confirming floor flatness and wall/handrail shorelines when entering dim corridors or night streets.                                                                                                                                                               |
| **Public Transit & Taxis**    | • **Bus Stops & Multi-Bus Queues**: Verifying stop direction and distinguishing whether your route is the **1st front bus or the 2nd bus queued behind it**, plus steps to the open front door.<br>• **Subway Platforms & On-Board Tracking**: Confirming platform direction, calculating steps to the fastest transfer screen door, tracking live remaining stops, announcing which side door opens (`left` vs. `right`), and alerting 1 stop prior.<br>• **Exit Corridors & Ride Matching**: Guiding through fare gates and cordoned-off stairs to a target exit number, or reading an arriving call-taxi's license plate, color, and rear-right door handle position.                                                                                                                                                                                                           |
| **Home, Meds & Reading**      | • **Medication, Eyedrop & Bottle Identification**: Distinguishing morning vs. evening prescription pouches, telling apart identical-feeling pump bottles (**shampoo vs. conditioner / body wash**), and preventing dangerous mix-ups (eyedrops vs. topical solutions).<br>• **Expired Food & Refrigerator Checks**: Checking whether milk, beverages, or side dishes are **past their expiration date (`D-Day`)**, confirming whether a container is already opened and how much remains, and separating `Expiration Date` from `Manufacturing Date` (with zero date hallucination when stamps are out of view).<br>• **Adaptive Full-Text Reading & Mail Triage**: Instant 3-point summaries for utility bills/parcels (filtering out spam flyers in 1 second), or **Full Verbatim Reading** from top to bottom whenever requested (*"read the entire card"*).<br>• **Appliance Burn Prevention**: Warning immediately about flat induction stove residual heat (`H`) and hot-water dispenser touch buttons, while reading washer/microwave remaining minutes. |
| **Shopping, Dining & Social** | • **Look-Alike Grocery Packaging**: Telling apart Original vs. Zero-Sugar, Decaf vs. Regular, flavor variants, verified shelf prices, and `1+1` / `2+1` promotions.<br>• **Dining & Restaurant Independence**: Describing body-relative meal layouts (highlighting white-on-white foods like tofu or fish), warning about fish bones or sizzling pots, and locating the water cup, utensil drawer, and napkins.<br>• **Touch Kiosks, Keypads & Elevators**: Centimeter-level fingertip-to-button coaching (`2 cm right, 1 cm up`) on unmanned kiosks, apartment touch keypads, and elevator panels.<br>• **Personal Item Memory, Restrooms & Meetings**: Remembering where earbuds/keys/glasses were left, checking outfits for stains, reading non-Braille restroom gender pictograms & vacant stalls, and whispering cues when a colleague extends a business card or handshake. |


---

## The World We Dream Of

> **"Independence and a lifelong companion for every person with visual impairment."**

We dream of a world where:

- **Open & Replaceable**: Any AI smart glass—from **Android XR Audio & Display Glasses** to lightweight open-hardware camera frames—can run SOTA.
- **Every Country & City Has First-Class Local Intelligence**: Through open-source **Locale Packs**, contributors around the world can adapt SOTA to their country's transit systems, tactile sidewalk standards, product packaging conventions, and natural spoken idioms.
- **Safety Is Grounded, Never Hallucinated**: Probabilistic AI perception is always paired with deterministic verification so users can trust when SOTA speaks—and trust SOTA to say *"it isn't visible from this angle"* rather than guessing.

---

## Release Status & Roadmap

> ⚠️ **Safety Notice (`v0.2.0-poc` Field Alpha)**: SOTA is an active open-source Proof of Concept under field testing. It is built to **complement—never replace**—primary mobility aids such as a white cane or guide dog.


| Phase       | Milestone                                              | Status          | Scope                                                                                                                                                                                                                                                                                                                                               |
| :---------- | :----------------------------------------------------- | :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1** | **`v0.2.0-poc` — Core Engine & Wearable Field Alpha**  | **In Progress** | • 2-Tier Context-Gated Micro-Skill Harness (`16+` skills, `23+` daily scenarios, `41/41` QA gates passing)<br>• Sub-2s multimodal vision pipeline (`gemini-3.5-flash-lite` minimal-thinking + Zero-Wait TTS)<br>• 3-Phase conversational wayfinding & initial `locale-ko-kr` pack<br>• Native Android APK (`ai.sota.glass`) & real-world validation toward **Google Intelligent AI Glasses** |
| **Phase 2** | **Global Reach for Blind Communities Worldwide**       | **Planned**     | • Expanding SOTA alongside contributors around the world so blind and low-vision people in every country and language can benefit in their own everyday lives                                                                                                                                                                                      |
| **Phase 3** | **Always-On Companion & Universal Wearable Ecosystem** | **Planned**     | • Seamless, zero-dropout real-time companionship across open smart-glass hardware, combining continuous live perception with resilient on-device safety awareness even offline                                                                                                                                                                     |


---

## Repository Structure & Architecture

SOTA separates **multimodal VLM perception (Layer 1)** from **deterministic safety, spatial math, and calendar/transit verification (Layer 2)**:

```text
[1st-Person Camera + Mic + GPS/IMU]
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Layer 1: Context-Gated Micro-Skill Router (English-Core Prompt)   │
│  • Injects Tier-2 O&M/ILS Expert Playbooks ONLY for top ≤4 skills │
│  • Keeps Tier-1 1-line scene switch directory for instant jump    │
└───────────────────────────────┬───────────────────────────────────┘
                                │ Structured Header `[SKILL_ID | key=val]` + Draft
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Layer 2: Deterministic Verification & Locale Post-Processors      │
│  • Pluggable Global (Google Maps) / Regional Transit Providers    │
│  • 15s TemporalSlotCache + Calendar/Stamp Anti-Hallucination      │
│  • Physics-Aware View-Finding Coach (`OCCLUDED`, `WRONG_SIDE`)    │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Priority Audio Arbiter (`P0_SAFETY` > `P1_NAV` > `P2_COMPANION`)  │
│  • Spatial earcons + instant barge-in on voice or temple tap      │
└───────────────────────────────────────────────────────────────────┘
```

### Directory Layout

```text
sota/
├── packages/
│   ├── core/                  # Hardware- & country-agnostic runtime engine
│   │   ├── agent-harness.ts   # 2-Tier Context-Gated Skill Router & 15s TemporalSlotCache
│   │   ├── audio-arbiter.ts   # P0/P1/P2 priority speech preemption & barge-in
│   │   ├── gemini-vision-agent.ts # Low-latency Gemini multimodal adapter
│   │   ├── smart-reader.ts    # Expiry D-Day, medicine, grocery, appliance & social helpers
│   │   ├── spatial-language.ts# Body-relative steps, cm fingertip coaching, tactile phrasing
│   │   ├── transit-engine.ts  # Platform door math, bus queue & ride plate verifier
│   │   └── visual-memory.ts   # Personal item landmark indexing & recall
│   ├── hardware-adapters/     # Abstract interfaces for Camera, Mic, Open-Ear/Bone TTS, IMU
│   └── locale-ko-kr/          # Reference Locale Pack (South Korea — 16 skills & local transit)
├── apps/
│   ├── android-glass-poc/     # Native Kotlin Android APK (`ai.sota.glass`) + XR Glass Simulator
│   ├── companion-web/         # Zero-dependency Node HTTP server & browser test console
│   └── scenario-simulator/    # Full-day scenario simulator (`run-day.ts`) & 41-gate QA (`qa-suite.ts`)
├── docs/
│   └── LOCALIZATION_AND_SKILL_GUIDE.md # Guide for building Country Locale Packs & Micro-Skills
├── .devin/skills/             # Reusable engineering skills (`sota-skill-architect`, `sota-github-pr`)
└── tests/
    └── sota.test.ts           # End-to-end & unit test suite (Node native test runner)
```

---

## Getting Started

### 1. Prerequisites

- **Node.js `22.6+`** (runs TypeScript natively via `--experimental-strip-types` with zero external runtime dependencies).

### 2. API Keys (Global vs. Regional)

Offline unit tests (`npm test`) and simulations (`npm run simulate`) run out of the box without API keys. For live multimodal inference and routing:

- **Core Multimodal Vision (All Regions)**:
  - `GEMINI_API_KEY` — Google Gemini API key (`gemini-3.5-flash-lite`).
- **Map & Transit Routing**:
  - **Global (Upcoming Default)**: `GOOGLE_MAPS_API_KEY` — Google Maps Platform (Places, Routes & Transit) is planned as the default worldwide wayfinding provider across international Locale Packs.
  - **South Korea (`locale-ko-kr`)**: Because Google Maps pedestrian/transit turn-by-turn coverage is restricted in South Korea, `locale-ko-kr` currently uses `TMAP_API_KEY` alongside `SEOUL_SUBWAY_API_KEY` and `SEOUL_BUS_API_KEY`.

Copy `.env.example` to `.env` (git-ignored) or store keys in macOS Keychain:

```bash
cp .env.example .env
# Optional on macOS Keychain:
security add-generic-password -U -a sota -s SOTA_GEMINI_API_KEY -w "YOUR_GEMINI_KEY"
```

### 3. Run Tests, QA Suite & Companion Server

```bash
# Run the 17 core & integration tests
npm test

# Run all 41 Use-Case & Field Regression QA gates
npm run qa

# Run the 23-scenario daily life simulation
npm run simulate

# Start the local Companion Web Server at http://127.0.0.1:4310
npm start
```

---

## Using the Android Test App

`apps/android-glass-poc` builds a standalone Android app (`ai.sota.glass`) modeled on the **official Google Android XR AI Glasses interaction specification**, letting you test hands-free smart-glass interactions on any Android 10+ phone today.

### Build & Install

1. Enable **Developer Options → USB Debugging** on your Android phone (on Samsung One UI, disable *Auto Blocker* under *Security and privacy* first).
2. Build and install via USB (or launch an emulator):

```bash
npm run android:build
npm run android:install
# Or on an Android Studio emulator:
npm run android:emulator
```

### Operating the Two Test Modes

Use the top switcher (`👓 Glass Mode` | `🧪 UC QA & Logs`) to toggle between eyes-free wearable simulation and scenario inspection:

1. **`👓 Glass Mode` (Default — Eyes-Free Android XR Simulator)**
   - **`TEMPLE TOUCHPAD` Gestures** (tap anywhere on the large center pad without looking):
     - **Single Tap**: Mutes ongoing speech immediately; confirms route departure when a route plan is pending; or repeats the last spoken guidance during silence.
     - **Touch & Hold**: Opens the voice microphone (**Invoke AI**) to ask a question, request full-text reading, save an object's location, or set a destination.
     - **Double Tap**: Captures and analyzes **1 instant camera frame** silently.
     - **Swipe Left / Right**: Cycles through searched destination candidates or toggles continuous `Live AI` mode `ON / OFF`.
   - **Hardware Volume Buttons (= Glasses Physical Buttons)**:
     - **Volume UP (1x press)**: Interrupts speech and opens Push-to-Talk voice input.
     - **Volume DOWN (1x press)**: Instant 1-frame camera scan (`2x double-press` toggles continuous `Live AI ON / OFF`, mirroring Android XR's `TOGGLE_APP_CAMERA`).
   - **Hands-Free Voice Feedback**:
     - Tap **`👍 Good`** or **`👎 Bad (🎙️ Voice Note)`** right below the touchpad to record spoken field feedback directly onto the latest inference log without typing.
2. **`🧪 UC QA & Logs` (Scenario Lab & Log Inspector)**
   - Browse **6 daily categories** and **23 one-tap scenario chips**, send silent text commands, inspect frame thumbnails & latency (`ms`), and pull device logs to your computer with `npm run feedback:pull`.

---

## Contributing & Global Localization

**Localization is where SOTA needs the global open-source community most.** Every country has its own tactile paving geometry, transit signage, food date-labeling laws (e.g., products exempt from expiration dates), crosswalk signals, and culturally natural spatial phrasing.

We have prepared a dedicated step-by-step guide for international contributors:
👉 [**Country Localization & Universal Micro-Skill Development Guide (`docs/LOCALIZATION_AND_SKILL_GUIDE.md`)**](./docs/LOCALIZATION_AND_SKILL_GUIDE.md)

Ways you can contribute right away:

1. **Create a Country / Language Locale Pack (`packages/locale-<lang-region>/`)**: Connect **Google Maps Platform** (or local transit APIs), translate spoken templates into natural body-relative phrasing for your language, and adapt local street/packaging rules.
2. **Author or Refine Micro-Skills**: Follow SOTA's **2-Tier O&M / ILS Expert Playbook** contract (`English-Core` internal reasoning + localized spoken output, zero hardcoded entities, deterministic Layer-2 guards).
3. **Add Hardware Adapters (`packages/hardware-adapters/`)**: Bridge Android XR Projected Glasses, OpenGlass/ESP32 frames, or Bluetooth open-ear wearables.
4. **Share Blind & O&M Specialist Field Feedback**: Open an issue with real-world edge cases encountered indoors or outdoors.

Before opening a Pull Request, run our Pre-PR verification gate:

```bash
npm run pre-pr
```

---

## Built With AI

- **Google Gemini 4 & Cognition [Devin](https://devin.ai)** — Powered end-to-end across domain research, system architecture, codebase implementation, and QA simulation with human-in-the-loop field-feedback iterations.

---

## License

Licensed under the **Apache License 2.0**. See [`LICENSE`](./LICENSE) for details.
