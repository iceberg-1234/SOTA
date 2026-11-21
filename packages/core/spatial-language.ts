import type { BoundingBox } from "../hardware-adapters/interfaces.ts";

const STEP_LENGTH_METERS = 0.7;

export type ClockHour = 10 | 11 | 12 | 1 | 2 | 3 | 9;

export function toClockHour(centerX: number): ClockHour {
  const clamped = Math.max(0, Math.min(1, centerX));
  if (clamped < 0.15) return 10;
  if (clamped < 0.38) return 11;
  if (clamped <= 0.62) return 12;
  if (clamped <= 0.85) return 1;
  return 2;
}

export function metersToSteps(meters: number): number {
  return Math.max(1, Math.round(meters / STEP_LENGTH_METERS));
}

export function describeSpatialTargetKo(
  label: string,
  box: BoundingBox,
  referenceHint?: string,
): string {
  const clock = toClockHour(box.centerX);
  const directionText = clock === 12 ? "정면 12시 방향" : `${clock}시 방향`;
  const distanceText =
    box.distanceMeters !== undefined
      ? box.distanceMeters < 1.0
        ? `팔 뻗을 거리(${Math.round(box.distanceMeters * 100)}cm) 앞`
        : `${metersToSteps(box.distanceMeters)}걸음 앞`
      : "";

  const prefix = referenceHint ? `${referenceHint}, ` : "";
  return [prefix + directionText, distanceText, `${label} 있습니다.`]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface KioskFingerOffset {
  /** Target minus fingertip X in centimeters (positive = move right, negative = move left) */
  deltaXCm: number;
  /** Target minus fingertip Y in centimeters (positive = move down, negative = move up) */
  deltaYCm: number;
  targetLabel: string;
}

export function coachFingertipToButtonKo(offset: KioskFingerOffset): string {
  const { deltaXCm, deltaYCm, targetLabel } = offset;
  if (Math.abs(deltaXCm) <= 0.8 && Math.abs(deltaYCm) <= 0.8) {
    return `${targetLabel} 버튼 바로 위입니다. 그대로 누르세요.`;
  }

  const moves: string[] = [];
  if (Math.abs(deltaXCm) > 0.8) {
    const dir = deltaXCm > 0 ? "오른쪽" : "왼쪽";
    moves.push(`${dir}으로 ${Math.round(Math.abs(deltaXCm))}cm`);
  }
  if (Math.abs(deltaYCm) > 0.8) {
    const dir = deltaYCm > 0 ? "아래" : "위";
    moves.push(`${dir}로 ${Math.round(Math.abs(deltaYCm))}cm`);
  }

  return `${targetLabel} 버튼까지 지금 손가락에서 ${moves.join(", ")} 이동해 누르세요.`;
}
