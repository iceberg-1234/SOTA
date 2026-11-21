import type { BoundingBox } from "../hardware-adapters/interfaces.ts";
import { describeSpatialTargetKo } from "./spatial-language.ts";

export interface RememberedObjectEntry {
  objectName: string;
  aliases: string[];
  box: BoundingBox;
  landmarkHint: string;
  observedAtIso: string;
}

export class VisualMemoryStore {
  private readonly items = new Map<string, RememberedObjectEntry>();

  remember(entry: RememberedObjectEntry): void {
    this.items.set(entry.objectName, entry);
  }

  seedDefaultHomeMemory(): void {
    this.remember({
      objectName: "에어팟 케이스",
      aliases: ["에어팟", "이어폰", "무선 이어폰"],
      box: { centerX: 0.88, centerY: 0.72, distanceMeters: 0.7 },
      landmarkHint: "소파 오른쪽 쿠션 아래",
      observedAtIso: "2026-11-15T07:55:00Z",
    });
    this.remember({
      objectName: "식후 아침 약 봉지",
      aliases: ["아침 약", "약봉지", "알약"],
      box: { centerX: 0.22, centerY: 0.6, distanceMeters: 0.45 },
      landmarkHint: "식탁 왼쪽 끝 물컵 옆",
      observedAtIso: "2026-11-15T07:00:00Z",
    });
    this.remember({
      objectName: "흰지팡이",
      aliases: ["지팡이", "케인"],
      box: { centerX: 0.5, centerY: 0.65, distanceMeters: 1.4 },
      landmarkHint: "현관 신발장 오른쪽 벽면 우산꽂이 옆",
      observedAtIso: "2026-11-15T07:58:00Z",
    });
  }

  findObjectKo(query: string): {
    found: boolean;
    entry?: RememberedObjectEntry;
    spokenKorean: string;
  } {
    const normalized = query.trim();
    for (const entry of this.items.values()) {
      if (
        normalized.includes(entry.objectName) ||
        entry.objectName.includes(normalized) ||
        entry.aliases.some((a) => normalized.includes(a))
      ) {
        return {
          found: true,
          entry,
          spokenKorean: describeSpatialTargetKo(
            entry.objectName,
            entry.box,
            entry.landmarkHint,
          ),
        };
      }
    }

    return {
      found: false,
      spokenKorean: `최근 시야에서 '${normalized}'을(를) 찾지 못했습니다. 고개를 천천히 좌우로 돌려 스캔해 주세요.`,
    };
  }
}
