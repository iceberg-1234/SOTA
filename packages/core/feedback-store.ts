import fs from "node:fs";
import path from "node:path";

export type FeedbackVote = "UP" | "DOWN" | "NONE";

export interface InferenceFeedbackRecord {
  id: string;
  timestampIso: string;
  deviceSource: "ANDROID_GLASS_APK" | "WEB_COMPANION";
  model: string;
  latencyMs: number;
  detectedMode: string;
  detectedModeLabelKo: string;
  activeCandidateSkills?: string[];
  extractedSlots?: Record<string, string>;
  spokenKorean: string;
  /** Base64 JPEG snapshot captured at the exact moment of inference */
  imageBase64?: string;
  vote: FeedbackVote;
  feedbackText: string;
  updatedAtIso?: string;
  /** Populated once converted into a Linear improvement ticket so it is never processed twice */
  linearIssueId?: string;
  linearIssueUrl?: string;
  processedAtIso?: string;
}

const DEFAULT_LOG_FILE = path.resolve(
  "feedback-logs/inference-feedback.json",
);

export class InferenceFeedbackStore {
  private readonly filePath: string;
  private records: InferenceFeedbackRecord[] = [];

  constructor(filePath = DEFAULT_LOG_FILE) {
    this.filePath = filePath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.records = parsed;
        }
      }
    } catch {
      this.records = [];
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.records, null, 2),
        "utf8",
      );
    } catch {
      // Non-fatal in read-only environments
    }
  }

  addInferenceRecord(
    entry: Omit<InferenceFeedbackRecord, "vote" | "feedbackText"> & {
      vote?: FeedbackVote;
      feedbackText?: string;
    },
  ): InferenceFeedbackRecord {
    const existingIdx = this.records.findIndex((r) => r.id === entry.id);
    if (existingIdx >= 0) {
      const prev = this.records[existingIdx];
      const nextVote =
        entry.vote && entry.vote !== "NONE" ? entry.vote : prev.vote;
      const nextText =
        entry.feedbackText && entry.feedbackText.trim() !== ""
          ? entry.feedbackText
          : prev.feedbackText;

      this.records[existingIdx] = {
        ...prev,
        ...entry,
        vote: nextVote,
        feedbackText: nextText,
        // Always preserve existing Linear ticket linkage so already-processed feedback is never re-queued
        linearIssueId: entry.linearIssueId ?? prev.linearIssueId,
        linearIssueUrl: entry.linearIssueUrl ?? prev.linearIssueUrl,
        processedAtIso: entry.processedAtIso ?? prev.processedAtIso,
      };
      this.saveToDisk();
      return this.records[existingIdx];
    }

    const fullRecord: InferenceFeedbackRecord = {
      ...entry,
      vote: entry.vote ?? "NONE",
      feedbackText: entry.feedbackText ?? "",
    };
    this.records.unshift(fullRecord);
    this.saveToDisk();
    return fullRecord;
  }

  updateFeedback(params: {
    id: string;
    vote?: FeedbackVote;
    feedbackText?: string;
  }): InferenceFeedbackRecord | null {
    const rec = this.records.find((r) => r.id === params.id);
    if (!rec) return null;
    if (params.vote !== undefined) rec.vote = params.vote;
    if (params.feedbackText !== undefined) rec.feedbackText = params.feedbackText;
    rec.updatedAtIso = new Date().toISOString();
    this.saveToDisk();
    return rec;
  }

  /**
   * Returns only actionable feedback records (`vote === "DOWN"` or non-empty `feedbackText`)
   * that have NOT yet been converted into a Linear improvement ticket (`!linearIssueId`).
   */
  getUnprocessedActionableFeedback(): InferenceFeedbackRecord[] {
    this.loadFromDisk();
    return this.records.filter(
      (r) =>
        !r.linearIssueId &&
        (r.vote === "DOWN" || (r.feedbackText && r.feedbackText.trim().length > 0)),
    );
  }

  markFeedbackProcessed(params: {
    id: string;
    linearIssueId: string;
    linearIssueUrl: string;
  }): InferenceFeedbackRecord | null {
    const rec = this.records.find((r) => r.id === params.id);
    if (!rec) return null;
    rec.linearIssueId = params.linearIssueId;
    rec.linearIssueUrl = params.linearIssueUrl;
    rec.processedAtIso = new Date().toISOString();
    this.saveToDisk();
    return rec;
  }

  mergeDeviceRecords(
    deviceRecords: InferenceFeedbackRecord[],
  ): { totalCount: number; mergedCount: number } {
    this.loadFromDisk();
    let mergedCount = 0;
    for (const item of deviceRecords) {
      if (!item?.id) continue;
      this.addInferenceRecord(item);
      mergedCount += 1;
    }
    this.records.sort((a, b) =>
      b.timestampIso.localeCompare(a.timestampIso),
    );
    this.saveToDisk();
    return { totalCount: this.records.length, mergedCount };
  }

  listRecords(limit = 100): InferenceFeedbackRecord[] {
    this.loadFromDisk();
    return this.records.slice(0, limit);
  }
}
