import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const ADB = path.join(HOME, "Library/Android/sdk/platform-tools/adb");
const EMULATOR = path.join(HOME, "Library/Android/sdk/emulator/emulator");
const APK_PATH = path.resolve(
  "apps/android-glass-poc/build/outputs/apk/debug/lumo-android-glass-poc-debug.apk",
);

interface AdbDeviceEntry {
  serial: string;
  state: "device" | "unauthorized" | "offline" | string;
  details: string;
}

function listAdbDevices(): AdbDeviceEntry[] {
  const out = execFileSync(ADB, ["devices", "-l"], { encoding: "utf8" });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices") && !line.startsWith("*"))
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        serial: parts[0],
        state: parts[1] ?? "unknown",
        details: parts.slice(2).join(" "),
      };
    });
}

function detectUsbAndroidHardware(): { isSamsungPluggedIn: boolean; serial?: string } {
  if (process.platform !== "darwin") return { isSamsungPluggedIn: false };
  try {
    const usbOut = execFileSync("system_profiler", ["SPUSBDataType"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (usbOut.includes("SAMSUNG_Android") || usbOut.includes("0x04e8")) {
      const serialMatch = usbOut.match(/SAMSUNG_Android:[\s\S]{1,300}?Serial Number:\s*(\S+)/);
      return {
        isSamsungPluggedIn: true,
        serial: serialMatch?.[1],
      };
    }
  } catch {}
  return { isSamsungPluggedIn: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const useEmulatorFallback = process.argv.includes("--emulator");
  let devices = listAdbDevices();

  if (devices.length === 0) {
    const usbCheck = detectUsbAndroidHardware();
    if (usbCheck.isSamsungPluggedIn && !useEmulatorFallback) {
      console.log("====================================================================");
      console.log(
        `📱 삼성 갤럭시 기기(Serial: ${usbCheck.serial ?? "확인됨"})가 맥 USB에 연결되어 있으나,`,
      );
      console.log("   현재 휴대폰에서 'USB 디버깅(ADB)' 신호가 차단되어 있습니다.");
      console.log("====================================================================\n");
      console.log("👉 휴대폰에서 아래 3가지를 순서대로 켜주세요 (30초 동안 연결을 자동 감지합니다):\n");
      console.log("  1️⃣ [삼성 One UI 필수] 휴대폰 [설정] → [보안 및 개인정보 보호] → [보안 위험 자동 차단]을 '사용 안 함(끄기)'으로 변경");
      console.log("     (* 이 기능이 켜져 있으면 USB 디버깅 자체가 비활성화됩니다)");
      console.log("  2️⃣ 휴대폰 [설정] → [휴대전화 정보] → [소프트웨어 정보] → [빌드번호] 7번 연타하여 개발자 옵션 활성화");
      console.log("  3️⃣ 휴대폰 [설정] → 맨 아래 [개발자 옵션] → [USB 디버깅] 켜기 → 화면 팝업에서 [허용] 터치\n");
      console.log("⏳ 휴대폰에서 설정을 켜시면 자동으로 설치가 시작됩니다 (대기 중...)");

      for (let i = 0; i < 15; i++) {
        await sleep(2000);
        devices = listAdbDevices();
        if (devices.length > 0) break;
      }
    }
  }

  if (devices.some((d) => d.state === "unauthorized")) {
    console.log(
      "\n🔒 휴대폰 화면에 표시된 ['USB 디버깅을 허용하시겠습니까?'] 팝업에서 [항상 허용] 체크 후 [허용]을 눌러주세요!",
    );
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      devices = listAdbDevices();
      if (devices.some((d) => d.state === "device")) break;
    }
  }

  let readyDevice = devices.find((d) => d.state === "device");

  if (!readyDevice && useEmulatorFallback) {
    console.log("\n🚀 연결된 실기기가 없어 Android 에뮬레이터(Medium_Phone_API_36.1)를 자동으로 띄웁니다...");
    const child = spawn(EMULATOR, ["-avd", "Medium_Phone_API_36.1", "-no-snapshot-load"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    execFileSync(ADB, ["wait-for-device"], { stdio: "inherit" });
    while (true) {
      const boot = execFileSync(ADB, ["shell", "getprop", "sys.boot_completed"], {
        encoding: "utf8",
      }).trim();
      if (boot === "1") break;
      await sleep(2000);
    }
    devices = listAdbDevices();
    readyDevice = devices.find((d) => d.state === "device");
  }

  if (!readyDevice) {
    console.error(
      "\n❌ 아직 ADB로 승인된 기기를 찾지 못했습니다. 위 휴대폰 [USB 디버깅] 설정을 켠 뒤 다시 `npm run android:install`을 실행해 주세요.",
    );
    console.error(
      "💡 만약 실기기 대신 맥 화면 에뮬레이터로 바로 띄우시려면 `npm run android:install -- --emulator`를 실행하세요.",
    );
    process.exit(1);
  }

  console.log(`\n✅ 대상 디바이스 연결 확인됨: ${readyDevice.serial} (${readyDevice.details})`);
  console.log("1. 로컬 Lumo 서버 포트 포워딩 설정 (adb reverse tcp:4310 tcp:4310)...");
  execFileSync(ADB, ["-s", readyDevice.serial, "reverse", "tcp:4310", "tcp:4310"], {
    stdio: "inherit",
  });

  console.log("2. Lumo APK 설치 및 카메라/마이크/위치 권한 자동 승인...");
  execFileSync(ADB, ["-s", readyDevice.serial, "install", "-r", "-g", APK_PATH], {
    stdio: "inherit",
  });

  console.log("3. 기기에서 Lumo (루모) AI Glass 앱 실행...");
  execFileSync(
    ADB,
    ["-s", readyDevice.serial, "shell", "am", "start", "-n", "ai.lumo.glass/.MainActivity"],
    { stdio: "inherit" },
  );

  console.log("\n🎉 설치 및 앱 실행이 완료되었습니다!");
}

main();
