import type {
  AudioSink,
  EarconType,
  GestureEvent,
  SpeechPriority,
} from "../hardware-adapters/interfaces.ts";

const PRIORITY_RANK: Record<SpeechPriority, number> = {
  P0_SAFETY: 0,
  P1_NAVIGATION: 1,
  P2_COMPANION: 2,
};

const BARGE_IN_KEYWORDS = ["됐어", "그만", "멈춰", "조용", "스톱", "다음"];

export interface UtteranceRecord {
  text: string;
  priority: SpeechPriority;
  interrupted: boolean;
}

export class PriorityAudioArbiter {
  private readonly sink: AudioSink;
  private activePriority: SpeechPriority | null = null;
  private readonly history: UtteranceRecord[] = [];

  constructor(sink: AudioSink) {
    this.sink = sink;
  }

  emit(text: string, priority: SpeechPriority, earcon?: EarconType): boolean {
    if (
      this.activePriority !== null &&
      PRIORITY_RANK[priority] > PRIORITY_RANK[this.activePriority]
    ) {
      return false;
    }

    if (
      this.activePriority !== null &&
      PRIORITY_RANK[priority] <= PRIORITY_RANK[this.activePriority] &&
      this.history.length > 0
    ) {
      const prev = this.history[this.history.length - 1];
      if (!prev.interrupted) {
        prev.interrupted = true;
        this.sink.stopSpeaking();
      }
    }

    if (earcon) {
      this.sink.playEarcon(earcon);
    }

    this.activePriority = priority;
    this.history.push({ text, priority, interrupted: false });
    this.sink.speak(text, priority);
    return true;
  }

  completeActiveUtterance(): void {
    this.activePriority = null;
  }

  bargeIn(trigger: GestureEvent | string): boolean {
    if (typeof trigger === "string") {
      const normalized = trigger.trim();
      const isGesture =
        normalized === "TEMPLE_SINGLE_TAP" || normalized === "HEAD_SHAKE";
      const isVoiceStop = BARGE_IN_KEYWORDS.some((kw) =>
        normalized.includes(kw),
      );
      if (!isGesture && !isVoiceStop) {
        return false;
      }
    }

    if (this.activePriority !== null && this.history.length > 0) {
      this.history[this.history.length - 1].interrupted = true;
    }
    this.activePriority = null;
    this.sink.stopSpeaking();
    this.sink.playEarcon("BARGE_IN_ACK");
    return true;
  }

  getHistory(): readonly UtteranceRecord[] {
    return this.history;
  }
}
