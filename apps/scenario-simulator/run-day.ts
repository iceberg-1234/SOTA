import type {
  AudioSink,
  EarconType,
  SpeechPriority,
} from "../../packages/hardware-adapters/interfaces.ts";
import { PriorityAudioArbiter } from "../../packages/core/audio-arbiter.ts";
import { LumoOrchestrator } from "../../packages/core/orchestrator.ts";
import { KOREAN_DAILY_SIMULATION_STEPS } from "../../packages/locale-ko-kr/index.ts";

class ConsoleGlassAudioSink implements AudioSink {
  public lastEarcon: EarconType | null = null;
  public lastSpoken: { text: string; priority: SpeechPriority } | null = null;

  playEarcon(earcon: EarconType): void {
    this.lastEarcon = earcon;
  }

  speak(text: string, priority: SpeechPriority): void {
    this.lastSpoken = { text, priority };
  }

  stopSpeaking(): void {
    // Immediate TTS cut-off on bone-conduction speaker
  }
}

export function runFullDaySimulation(): Array<{
  useCaseId: string;
  time: string;
  title: string;
  earcon: EarconType | null;
  priority: SpeechPriority | null;
  spoken: string;
}> {
  const sink = new ConsoleGlassAudioSink();
  const arbiter = new PriorityAudioArbiter(sink);
  const orchestrator = new LumoOrchestrator(arbiter);

  return KOREAN_DAILY_SIMULATION_STEPS.map((step) => {
    sink.lastEarcon = null;
    sink.lastSpoken = null;
    step.execute(orchestrator);
    const spoken = sink.lastSpoken?.text ?? "";
    const priority = sink.lastSpoken?.priority ?? null;
    const earcon = sink.lastEarcon;
    arbiter.completeActiveUtterance();
    return {
      useCaseId: step.useCaseId,
      time: step.time,
      title: step.title,
      earcon,
      priority,
      spoken,
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const logs = runFullDaySimulation();
  console.log("====================================================================");
  console.log(" Lumo (Google AI Glass) - 한국 시각장애인 하루 일과 시뮬레이션 (UC-01 ~ UC-13)");
  console.log("====================================================================\n");
  for (const entry of logs) {
    console.log(
      `[${entry.time}] (${entry.useCaseId}) ${entry.title}\n  • Earcon/Priority : [${entry.earcon}] (${entry.priority})\n  • Lumo 음성 안내  : "${entry.spoken}"\n`,
    );
  }
}
