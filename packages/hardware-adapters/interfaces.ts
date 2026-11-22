export type EarconType =
  | "SCANNING_TICK"
  | "HAZARD_ALERT"
  | "SIGNAL_GREEN"
  | "TARGET_FOUND"
  | "TRANSIT_ARRIVING"
  | "BARGE_IN_ACK";

export type SpeechPriority = "P0_SAFETY" | "P1_NAVIGATION" | "P2_COMPANION";

export type GestureEvent =
  | "TEMPLE_SINGLE_TAP"
  | "TEMPLE_DOUBLE_TAP"
  | "HEAD_SHAKE"
  | "HEAD_NOD";

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracyMeters: number;
  headingDegrees?: number;
}

export interface BoundingBox {
  /** Normalized center X in camera frame (0.0 = far left, 0.5 = center, 1.0 = far right) */
  centerX: number;
  /** Normalized center Y in camera frame (0.0 = top, 0.5 = middle, 1.0 = bottom) */
  centerY: number;
  /** Estimated distance in meters if available */
  distanceMeters?: number;
}

export interface CameraSource {
  captureKeyframe(): Promise<Uint8Array>;
}

export interface AudioSink {
  playEarcon(earcon: EarconType): void;
  speak(text: string, priority: SpeechPriority): void;
  stopSpeaking(): void;
}

export interface LocationSensor {
  getCurrentLocation(): Promise<GeoPoint>;
}
