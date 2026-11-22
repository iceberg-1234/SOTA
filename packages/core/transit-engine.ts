import { metersToSteps } from "./spatial-language.ts";

export interface ScreenDoorCode {
  car: number;
  door: number;
}

const DOORS_PER_SUBWAY_CAR = 4;
const METERS_PER_SUBWAY_DOOR = 5;

export function parseScreenDoorCode(raw: string): ScreenDoorCode | null {
  const match = raw.trim().match(/^(\d{1,2})\s*-\s*(\d)$/);
  if (!match) return null;
  const car = Number(match[1]);
  const door = Number(match[2]);
  if (car < 1 || car > 12 || door < 1 || door > DOORS_PER_SUBWAY_CAR) {
    return null;
  }
  return { car, door };
}

export interface BusStopVerificationInput {
  targetRouteNumber: string;
  intendedDirectionKeyword: string;
  observedArsId?: string;
  observedStopName: string;
  observedDirectionSign: string;
  nextArrivalMinutes: number;
  stopsAway: number;
  approachingBuses?: Array<{
    order: number;
    routeNumber: string;
    doorDistanceMeters?: number;
    isDoorOpen?: boolean;
  }>;
}

export interface BusStopGuidanceResult {
  isCorrectDirection: boolean;
  spokenGuidance: string;
}

export function verifyBusStopAndArrivalKo(
  input: BusStopVerificationInput,
): BusStopGuidanceResult {
  const isCorrectDirection = input.observedDirectionSign.includes(
    input.intendedDirectionKeyword,
  );

  if (!isCorrectDirection) {
    return {
      isCorrectDirection: false,
      spokenGuidance: `주의하세요. 현재 서 계신 ${input.observedStopName} 정류장은 ${input.observedDirectionSign} 방면입니다. ${input.intendedDirectionKeyword} 방면으로 가시려면 건너편 정류장으로 이동해야 합니다.`,
    };
  }

  const baseInfo = `${input.intendedDirectionKeyword} 방면 ${input.observedStopName} 정류장 맞습니다. ${input.targetRouteNumber}번 버스는 약 ${input.nextArrivalMinutes}분 뒤(${input.stopsAway}정거장 전) 도착합니다.`;

  if (!input.approachingBuses || input.approachingBuses.length === 0) {
    return { isCorrectDirection: true, spokenGuidance: baseInfo };
  }

  const orderNames = ["첫 번째", "두 번째", "세 번째", "네 번째"];
  const descriptions = input.approachingBuses.map((bus) => {
    const ord = orderNames[bus.order - 1] ?? `${bus.order}번째`;
    if (bus.routeNumber === input.targetRouteNumber) {
      const dist =
        bus.doorDistanceMeters !== undefined
          ? ` 전방 ${bus.doorDistanceMeters}미터`
          : "";
      const doorState = bus.isDoorOpen ? " 앞문 열렸습니다." : " 진입 중입니다.";
      return `지금 진입한 ${ord} 버스가 타실 ${bus.routeNumber}번입니다.${dist}${doorState}`;
    }
    return `${ord} 버스는 ${bus.routeNumber}번`;
  });

  return {
    isCorrectDirection: true,
    spokenGuidance: `${baseInfo} ${descriptions.join(", ")}`,
  };
}

export interface SubwayPlatformInput {
  lineName: string;
  intendedDirectionStation: string;
  /** Screen door arrow sign showing next station on the platform */
  observedNextStationOnSign: string;
  /** Screen door code in front of user, e.g. "3-2" */
  observedScreenDoor: string;
  /** Target screen door for fastest transfer or exit at destination, e.g. "5-3" */
  fastTransferTargetDoor?: string;
  transferStationName?: string;
  transferTargetLine?: string;
  /** Direction train moves when facing the screen door ("LEFT" means car 1 is on the left, or right depending on line) */
  higherCarDirectionWhenFacingDoor: "LEFT" | "RIGHT";
  nextTrainArrivalMinutes: number;
}

export interface SubwayPlatformGuidanceResult {
  isCorrectPlatform: boolean;
  doorOffsetCount: number;
  estimatedSteps: number;
  moveDirectionKo: "왼쪽(9시 방향)" | "오른쪽(3시 방향)" | "현재 위치";
  spokenGuidance: string;
}

export function verifySubwayPlatformAndTransferKo(
  input: SubwayPlatformInput,
): SubwayPlatformGuidanceResult {
  const isCorrectPlatform =
    input.observedNextStationOnSign.trim() ===
    input.intendedDirectionStation.trim();

  if (!isCorrectPlatform) {
    return {
      isCorrectPlatform: false,
      doorOffsetCount: 0,
      estimatedSteps: 0,
      moveDirectionKo: "현재 위치",
      spokenGuidance: `주의하세요. 이 승강장은 ${input.observedNextStationOnSign} 방면입니다. ${input.intendedDirectionStation} 방면 열차를 타시려면 반대편 승강장으로 이동하세요.`,
    };
  }

  const current = parseScreenDoorCode(input.observedScreenDoor);
  const target = input.fastTransferTargetDoor
    ? parseScreenDoorCode(input.fastTransferTargetDoor)
    : null;

  const platformConfirm = `${input.lineName} ${input.intendedDirectionStation} 방면 승강장 맞습니다. 다음 열차는 ${input.nextTrainArrivalMinutes}분 뒤 도착합니다.`;

  if (!current || !target) {
    return {
      isCorrectPlatform: true,
      doorOffsetCount: 0,
      estimatedSteps: 0,
      moveDirectionKo: "현재 위치",
      spokenGuidance: `${platformConfirm} 현재 위치에서 바로 탑승하시면 됩니다.`,
    };
  }

  const doorDelta =
    (target.car - current.car) * DOORS_PER_SUBWAY_CAR +
    (target.door - current.door);

  if (doorDelta === 0) {
    return {
      isCorrectPlatform: true,
      doorOffsetCount: 0,
      estimatedSteps: 0,
      moveDirectionKo: "현재 위치",
      spokenGuidance: `${platformConfirm} 현재 서 계신 ${input.observedScreenDoor}번 문이 ${input.transferStationName ?? "목적지"} ${input.transferTargetLine ?? ""} 빠른 환승 위치입니다. 여기서 바로 타세요.`.replace(
        /\s+/g,
        " ",
      ),
    };
  }

  const absDoors = Math.abs(doorDelta);
  const distanceMeters = absDoors * METERS_PER_SUBWAY_DOOR;
  const estimatedSteps = metersToSteps(distanceMeters);

  const moveRightForHigher =
    input.higherCarDirectionWhenFacingDoor === "RIGHT";
  const moveRight = doorDelta > 0 ? moveRightForHigher : !moveRightForHigher;
  const moveDirectionKo = moveRight
    ? "오른쪽(3시 방향)"
    : "왼쪽(9시 방향)";

  const transferReason =
    input.transferStationName && input.transferTargetLine
      ? `${input.transferStationName}에서 ${input.transferTargetLine} 빠른 환승(${input.fastTransferTargetDoor}번 문)을 원하시면`
      : `빠른 하차 위치(${input.fastTransferTargetDoor}번 문)로 가시려면`;

  const spokenGuidance = `${platformConfirm} 현재 ${input.observedScreenDoor}번 문 앞입니다. 여기서 타셔도 되지만, ${transferReason} ${moveDirectionKo}으로 문 ${absDoors}개, 약 ${estimatedSteps}걸음 이동하세요.`;

  return {
    isCorrectPlatform: true,
    doorOffsetCount: absDoors,
    estimatedSteps,
    moveDirectionKo,
    spokenGuidance,
  };
}

export interface TransferCorridorSignObservation {
  targetLineName: string;
  arrowDirection: "STRAIGHT" | "LEFT" | "RIGHT" | "SLIGHT_LEFT" | "SLIGHT_RIGHT";
  remainingMeters?: number;
  hasTactileJunctionAhead: boolean;
  verticalTransitionAhead?: {
    type: "STAIRS_DOWN" | "STAIRS_UP" | "ESCALATOR" | "ELEVATOR";
    distanceMeters: number;
    handrailSide?: "LEFT" | "RIGHT";
  };
}

export function guideTransferCorridorKo(
  obs: TransferCorridorSignObservation,
): string {
  const arrowMap: Record<
    TransferCorridorSignObservation["arrowDirection"],
    string
  > = {
    STRAIGHT: "정면 12시 방향으로 직진하세요",
    LEFT: "왼쪽 9시 방향으로 꺾으세요",
    RIGHT: "오른쪽 3시 방향으로 꺾으세요",
    SLIGHT_LEFT: "왼쪽 대각선 10시 방향으로 이동하세요",
    SLIGHT_RIGHT: "오른쪽 대각선 2시 방향으로 이동하세요",
  };

  const junctionPrefix = obs.hasTactileJunctionAhead
    ? "전방 점자블록 갈림길에서 "
    : "";
  const remainSuffix =
    obs.remainingMeters !== undefined
      ? ` (환승 승강장까지 약 ${obs.remainingMeters}m)`
      : "";

  let guidance = `${junctionPrefix}${obs.targetLineName} 환승 표지판을 따라 ${arrowMap[obs.arrowDirection]}.${remainSuffix}`;

  if (obs.verticalTransitionAhead) {
    const vt = obs.verticalTransitionAhead;
    const steps = metersToSteps(vt.distanceMeters);
    const typeLabel: Record<typeof vt.type, string> = {
      STAIRS_DOWN: "내려가는 계단",
      STAIRS_UP: "올라가는 계단",
      ESCALATOR: "에스컬레이터",
      ELEVATOR: "엘리베이터",
    };
    const rail =
      vt.handrailSide === "RIGHT"
        ? " 오른쪽 손잡이를 잡으세요."
        : vt.handrailSide === "LEFT"
          ? " 왼쪽 손잡이를 잡으세요."
          : "";
    guidance += ` ${steps}걸음 앞에 ${typeLabel[vt.type]}이 있습니다.${rail}`;
  }

  return guidance;
}

export interface TaxiVerificationInput {
  expectedPlateNumber?: string;
  observedPlateNumber: string;
  vehicleColorKo: string;
  vehicleModelKo: string;
  isWheelchairCallTaxi?: boolean;
  doorDistanceMeters: number;
}

/**
 * UC-15: Verifies a called taxi or wheelchair-accessible call taxi (장애인 콜택시)
 * by matching the observed license plate, color, and model, and guiding to the passenger door handle.
 */
export function verifyCalledTaxiOrRideKo(input: TaxiVerificationInput): {
  isMatch: boolean;
  spokenGuidance: string;
} {
  const cleanObs = input.observedPlateNumber.replace(/\s+/g, "");
  const cleanExp = input.expectedPlateNumber?.replace(/\s+/g, "");
  const isMatch = !cleanExp || cleanObs.endsWith(cleanExp.slice(-4));
  const steps = metersToSteps(input.doorDistanceMeters);
  const rideLabel = input.isWheelchairCallTaxi ? "장애인 콜택시" : "호출하신 택시";

  if (!isMatch) {
    return {
      isMatch: false,
      spokenGuidance: `앞에 멈춘 ${input.vehicleColorKo} ${input.vehicleModelKo} 차량은 번호가 ${input.observedPlateNumber}번이라 호출하신 차량(${input.expectedPlateNumber})이 아니에요. 잠시 더 기다려 주세요.`,
    };
  }

  return {
    isMatch: true,
    spokenGuidance: `네, ${rideLabel} ${input.vehicleColorKo} ${input.vehicleModelKo} ${input.observedPlateNumber}번 차량 맞아요. 지금 걸어가시는 정면으로 ${steps}걸음 앞에 뒷좌석 오른쪽 문 손잡이가 있어요.`,
  };
}
