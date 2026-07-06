import { extractMediaUrl } from "./media-url";
import type { InstagramContentType, MediaPlatform } from "./platform";
import { platformSupportsSplit } from "./platform";

export type TimeRange = {
  startSeconds: number;
  endSeconds: number;
  startLabel: string;
  endLabel: string;
  durationSeconds: number;
};

const TIME_TOKEN_PATTERN = /\d{1,2}(?::\d{2}){1,2}/g;
const INLINE_RANGE_PATTERN =
  /(\d{1,2}(?::\d{2}){1,2})\s*(?:-|–|—|\bto\b)\s*(\d{1,2}(?::\d{2}){1,2})/i;

export function formatTimeLabel(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatYtDlpTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function parseTimeToken(token: string): number {
  const parts = token.trim().split(":").map((part) => Number(part));

  if (parts.some((part) => Number.isNaN(part) || part < 0)) {
    throw new Error(`Invalid time: ${token}`);
  }

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (seconds >= 60) {
      throw new Error(`Invalid time: ${token}`);
    }
    return minutes * 60 + seconds;
  }

  const [hours, minutes, seconds] = parts;
  if (minutes >= 60 || seconds >= 60) {
    throw new Error(`Invalid time: ${token}`);
  }

  return hours * 3600 + minutes * 60 + seconds;
}

export function createTimeRange(startToken: string, endToken: string): TimeRange {
  const startSeconds = parseTimeToken(startToken);
  const endSeconds = parseTimeToken(endToken);

  if (endSeconds <= startSeconds) {
    throw new Error("End time must be after start time.");
  }

  return {
    startSeconds,
    endSeconds,
    startLabel: formatTimeLabel(startSeconds),
    endLabel: formatTimeLabel(endSeconds),
    durationSeconds: endSeconds - startSeconds,
  };
}

export function extractTimeRange(text: string): TimeRange | null {
  const match = text.match(INLINE_RANGE_PATTERN);
  if (!match) {
    return null;
  }

  try {
    return createTimeRange(match[1], match[2]);
  } catch {
    return null;
  }
}

export function parseInlineTimeRange(text: string): TimeRange | undefined {
  const match = text.match(INLINE_RANGE_PATTERN);
  if (!match) {
    return undefined;
  }

  return createTimeRange(match[1], match[2]);
}

export function parseSplitCommand(text: string): {
  url: string;
  normalizedUrl: string;
  platform: MediaPlatform;
  instagramType?: InstagramContentType;
  timeRange: TimeRange;
} | null {
  if (!text.trim().startsWith("/split")) {
    return null;
  }

  const link = extractMediaUrl(text);
  if (!link || !platformSupportsSplit(link.platform)) {
    return null;
  }

  const withoutUrl = text
    .replace(link.url, "")
    .replace(/^\/split(?:@\w+)?/i, "");
  const tokens = withoutUrl.match(TIME_TOKEN_PATTERN);
  if (!tokens || tokens.length < 2) {
    return null;
  }

  return {
    url: link.url,
    normalizedUrl: link.normalizedUrl,
    platform: link.platform,
    instagramType: link.instagramType,
    timeRange: createTimeRange(tokens[0], tokens[1]),
  };
}

export function validateTimeRange(
  range: TimeRange,
  videoDurationSeconds: number
): void {
  if (range.startSeconds < 0) {
    throw new Error("Start time cannot be negative.");
  }

  if (range.endSeconds > videoDurationSeconds) {
    throw new Error(
      `End time ${range.endLabel} exceeds video duration ${formatTimeLabel(videoDurationSeconds)}.`
    );
  }

  if (range.durationSeconds <= 0) {
    throw new Error("Clip duration must be greater than zero.");
  }
}

export function toYtDlpDownloadSections(range: TimeRange): string {
  return `*${formatYtDlpTime(range.startSeconds)}-${formatYtDlpTime(range.endSeconds)}`;
}

export function formatSplitSummary(range: TimeRange): string {
  return `✂️ Clip: ${range.startLabel} → ${range.endLabel} (${formatTimeLabel(range.durationSeconds)})`;
}
