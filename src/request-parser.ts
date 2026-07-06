import { extractMediaUrl } from "./media-url";
import type { InstagramContentType, MediaPlatform } from "./platform";
import { platformSupportsAudioOnly, platformSupportsSplit } from "./platform";
import {
  createTimeRange,
  parseInlineTimeRange,
  parseSplitCommand,
  type TimeRange,
} from "./time-range";

export type ParsedUserRequest = {
  url: string;
  normalizedUrl: string;
  platform: MediaPlatform;
  instagramType?: InstagramContentType;
  audioOnly: boolean;
  timeRange?: TimeRange;
};

function assertSplitSupported(
  platform: MediaPlatform,
  timeRange: TimeRange | undefined
): void {
  if (timeRange && !platformSupportsSplit(platform)) {
    throw new Error("Clips are only supported for YouTube links.");
  }
}

export function parseUserRequest(
  text: string,
  audioOnly = false
): ParsedUserRequest | null {
  const splitCommand = parseSplitCommand(text);
  if (splitCommand) {
    return {
      url: splitCommand.url,
      normalizedUrl: splitCommand.normalizedUrl,
      platform: splitCommand.platform,
      instagramType: splitCommand.instagramType,
      audioOnly,
      timeRange: splitCommand.timeRange,
    };
  }

  const link = extractMediaUrl(text);
  if (!link) {
    return null;
  }

  const timeRange = parseInlineTimeRange(text);
  assertSplitSupported(link.platform, timeRange);

  return {
    url: link.url,
    normalizedUrl: link.normalizedUrl,
    platform: link.platform,
    instagramType: link.instagramType,
    audioOnly,
    timeRange,
  };
}

export function parseAudioRequest(text: string): ParsedUserRequest | null {
  const withoutCommand = text.replace(/^\/audio(?:@\w+)?\s*/i, "");
  const parsed = parseUserRequest(withoutCommand, true);
  if (!parsed) {
    return null;
  }

  if (!platformSupportsAudioOnly(parsed.platform)) {
    throw new Error("Audio-only mode is not supported for this link.");
  }

  return parsed;
}

export function parseSplitRequest(text: string): ParsedUserRequest | null {
  const parsed = parseSplitCommand(text);
  if (!parsed) {
    return null;
  }

  return {
    url: parsed.url,
    normalizedUrl: parsed.normalizedUrl,
    platform: parsed.platform,
    instagramType: parsed.instagramType,
    audioOnly: false,
    timeRange: parsed.timeRange,
  };
}

export { createTimeRange };
