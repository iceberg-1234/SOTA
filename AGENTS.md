# Lumo Project Guide (AGENTS.md)

## Commands
- Run all unit & integration tests (Node 22 native TypeScript):
  `npm test`
- Run the full-day Korean visually impaired simulation (`UC-01` ~ `UC-13`):
  `npm run simulate`
- Start the Interactive Smart Glass Companion Web Server (`http://0.0.0.0:4310`):
  `npm start`
- Build the Android Pilot APK (`apps/android-glass-poc/build/outputs/apk/debug/lumo-android-glass-poc-debug.apk`):
  `npm run android:build`
- Install APK, bind `adb reverse tcp:4310 tcp:4310`, grant Camera/Mic/Location permissions, and launch on connected Emulator or Real Device:
  `npm run android:install`
- Launch the local Android Emulator (`Medium_Phone_API_36.1`):
  `npm run android:emulator`

## Secrets & Security
- Never hardcode API keys in source files or commit them to Git.
- The Gemini API Key is stored in the macOS Keychain under the service name `LUMO_GEMINI_API_KEY`:
  - Read via `packages/core/keychain.ts` (`security find-generic-password -s LUMO_GEMINI_API_KEY -w`) or `GEMINI_API_KEY` env var fallback.
  - Default low-latency model verified with this key: `gemini-3.5-flash-lite` on `generativelanguage.googleapis.com/v1beta`.
- Seoul/Metropolitan Public Transit & TMAP API keys (when issued) are stored in the macOS Keychain under:
  - `LUMO_SEOUL_SUBWAY_API_KEY` (Seoul Open Data Plaza `swopenAPI.seoul.go.kr` realtime subway arrival)
  - `LUMO_SEOUL_BUS_API_KEY` (Seoul/Metropolitan Bus `ws.bus.go.kr` / data.go.kr)
  - `LUMO_TMAP_API_KEY` (SKT TMAP POI, Pedestrian & Public Transit Routing)
