import type { BoundingBox } from "../hardware-adapters/interfaces.ts";
import { PriorityAudioArbiter } from "./audio-arbiter.ts";
import {
  coachFingertipToButtonKo,
  describeSpatialTargetKo,
  metersToSteps,
  type KioskFingerOffset,
} from "./spatial-language.ts";
import {
  guideTransferCorridorKo,
  verifyBusStopAndArrivalKo,
  verifySubwayPlatformAndTransferKo,
  type BusStopVerificationInput,
  type SubwayPlatformInput,
  type TransferCorridorSignObservation,
} from "./transit-engine.ts";

export type SotaOperatingMode =
  | "IDLE_COMPANION"
  | "WALKING_NAV"
  | "TRANSIT_HUB"
  | "KIOSK_COACH"
  | "SMART_READER";

export interface HazardEvent {
  hazardType: "ELECTRIC_SCOOTER" | "BOLLARD" | "OVERHEAD_SIGN" | "STEP_DROP";
  distanceMeters: number;
  avoidDirection: "왼쪽" | "오른쪽";
  onTactilePaving?: boolean;
}

export interface CrosswalkSignalEvent {
  state: "RED" | "GREEN";
  remainingSeconds?: number;
  alignmentClock: 11 | 12 | 1;
}

export interface PedestrianTurnEvent {
  distanceMeters: number;
  landmarkName: string;
  turnClock: 9 | 10 | 12 | 2 | 3;
  tactileContinues: boolean;
}

export class SotaOrchestrator {
  private mode: SotaOperatingMode = "IDLE_COMPANION";
  private readonly arbiter: PriorityAudioArbiter;

  constructor(arbiter: PriorityAudioArbiter) {
    this.arbiter = arbiter;
  }

  getMode(): SotaOperatingMode {
    return this.mode;
  }

  setMode(mode: SotaOperatingMode): void {
    this.mode = mode;
  }

  handleHazardReflex(event: HazardEvent): boolean {
    const labelMap: Record<HazardEvent["hazardType"], string> = {
      ELECTRIC_SCOOTER: "공유 킥보드",
      BOLLARD: "볼라드 기둥",
      OVERHEAD_SIGN: "머리 높이 돌출 간판",
      STEP_DROP: "단차",
    };
    const tactileText = event.onTactilePaving ? "점자블록 위 " : "";
    const msg = `전방 ${event.distanceMeters}미터 ${tactileText}${labelMap[event.hazardType]}, ${event.avoidDirection}으로 반 걸음 피하세요.`;
    return this.arbiter.emit(msg, "P0_SAFETY", "HAZARD_ALERT");
  }

  handleCrosswalkSignal(event: CrosswalkSignalEvent): boolean {
    if (event.state === "RED") {
      return this.arbiter.emit(
        "보행자 적색 신호입니다. 대기하세요.",
        "P0_SAFETY",
        "HAZARD_ALERT",
      );
    }
    const remain =
      event.remainingSeconds !== undefined
        ? `잔여 ${event.remainingSeconds}초, `
        : "";
    const align =
      event.alignmentClock === 12
        ? "정면 12시 방향으로 걸으세요."
        : `${event.alignmentClock}시 방향으로 몸을 맞춰 건너세요.`;
    return this.arbiter.emit(
      `녹색 신호로 바뀌었습니다. ${remain}${align}`,
      "P0_SAFETY",
      "SIGNAL_GREEN",
    );
  }

  handleVisualWayfindingTurn(event: PedestrianTurnEvent): boolean {
    this.mode = "WALKING_NAV";
    const steps = metersToSteps(event.distanceMeters);
    const turnDir =
      event.turnClock === 3 || event.turnClock === 2
        ? `${event.turnClock}시 방향으로 우회전하세요.`
        : event.turnClock === 9 || event.turnClock === 10
          ? `${event.turnClock}시 방향으로 좌회전하세요.`
          : "12시 방향으로 직진하세요.";
    const tactile = event.tactileContinues
      ? " 바닥 점자블록이 이어집니다."
      : "";
    return this.arbiter.emit(
      `${steps}걸음 앞 ${event.landmarkName} 모서리에서 ${turnDir}${tactile}`,
      "P1_NAVIGATION",
      "TARGET_FOUND",
    );
  }

  handleBusStopCheck(input: BusStopVerificationInput): string {
    this.mode = "TRANSIT_HUB";
    const res = verifyBusStopAndArrivalKo(input);
    this.arbiter.emit(
      res.spokenGuidance,
      "P1_NAVIGATION",
      res.isCorrectDirection ? "TRANSIT_ARRIVING" : "HAZARD_ALERT",
    );
    return res.spokenGuidance;
  }

  handleSubwayPlatformCheck(input: SubwayPlatformInput): string {
    this.mode = "TRANSIT_HUB";
    const res = verifySubwayPlatformAndTransferKo(input);
    this.arbiter.emit(
      res.spokenGuidance,
      "P1_NAVIGATION",
      res.isCorrectPlatform ? "TRANSIT_ARRIVING" : "HAZARD_ALERT",
    );
    return res.spokenGuidance;
  }

  handleTransferCorridorGuidance(obs: TransferCorridorSignObservation): string {
    this.mode = "TRANSIT_HUB";
    const msg = guideTransferCorridorKo(obs);
    this.arbiter.emit(msg, "P1_NAVIGATION", "TARGET_FOUND");
    return msg;
  }

  handleObjectFinder(
    targetName: string,
    box: BoundingBox,
    contextNote?: string,
  ): string {
    const msg = describeSpatialTargetKo(targetName, box, contextNote);
    this.arbiter.emit(msg, "P2_COMPANION", "TARGET_FOUND");
    return msg;
  }

  handleKioskHandCoach(offset: KioskFingerOffset, extraTip?: string): string {
    this.mode = "KIOSK_COACH";
    const base = coachFingertipToButtonKo(offset);
    const msg = extraTip ? `${base} ${extraTip}` : base;
    this.arbiter.emit(msg, "P1_NAVIGATION", "TARGET_FOUND");
    return msg;
  }

  handleSmartBriefing(summarySentence: string): string {
    this.mode = "SMART_READER";
    this.arbiter.emit(summarySentence, "P2_COMPANION", "SCANNING_TICK");
    return summarySentence;
  }
}
