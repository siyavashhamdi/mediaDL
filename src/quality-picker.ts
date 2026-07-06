import { Markup } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";
import {
  findQualityOption,
  formatQualityList,
  type QualityOption,
} from "./formats";
import { buildCallbackData, type PendingRequest } from "./pending-request";
import {
  getInstagramTypeLabel,
  getPlatformConfig,
  type MediaPlatform,
} from "./platform";
import { formatSplitSummary, type TimeRange } from "./time-range";
import {
  formatDuration,
  formatLikeCount,
  formatViewCount,
  truncateText,
  type VideoInfo,
} from "./video-info";

const TELEGRAM_CAPTION_LIMIT = 1024;

function mediaHeaderIcon(info: VideoInfo, audioOnly = false): string {
  if (audioOnly) {
    return "🎵";
  }

  if (info.platform === "instagram") {
    if (info.mediaKind === "image") {
      return "📸";
    }
    if (info.instagramType === "story" || info.instagramType === "highlight") {
      return "📱";
    }
    if (info.instagramType === "reel") {
      return "🎞";
    }
    return "📸";
  }

  return "🎬";
}

function platformBadge(info: VideoInfo): string {
  if (info.platform === "instagram" && info.instagramType) {
    return `📷 Instagram ${getInstagramTypeLabel(info.instagramType)}`;
  }

  return `▶️ ${getPlatformConfig(info.platform).name}`;
}

function videoMeta(info: VideoInfo, timeRange?: TimeRange): string {
  const durationLabel = timeRange
    ? `${formatDuration(timeRange.durationSeconds)} clip`
    : info.duration
      ? formatDuration(info.duration)
      : undefined;

  return [
    info.uploader ? `👤 ${info.uploader}` : undefined,
    durationLabel ? `⏱ ${durationLabel}` : undefined,
    info.viewCount ? `👁 ${formatViewCount(info.viewCount)} views` : undefined,
    info.likeCount ? `👍 ${formatLikeCount(info.likeCount)}` : undefined,
    info.uploadDate ? `📅 ${info.uploadDate}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function videoHeader(
  info: VideoInfo,
  audioOnly = false,
  timeRange?: TimeRange
): string {
  const icon = mediaHeaderIcon(info, audioOnly);
  const meta = videoMeta(info, timeRange);

  return [`${icon} ${info.title}`, meta].filter(Boolean).join("\n");
}

function formatDescriptionBlock(
  info: VideoInfo,
  maxLength = 280
): string | undefined {
  if (!info.description?.trim()) {
    return undefined;
  }

  return `📝 ${truncateText(info.description, maxLength)}`;
}

function formatCarouselNote(info: VideoInfo): string | undefined {
  if (!info.carouselCount || info.carouselCount <= 1) {
    return undefined;
  }

  return `📚 Carousel with ${info.carouselCount} items — downloading the first item.`;
}

function isSourceLinkLine(part: string): boolean {
  return part.startsWith("🔗 ");
}

function fitCaption(parts: string[]): string {
  let caption = parts.join("\n");

  if (caption.length <= TELEGRAM_CAPTION_LIMIT) {
    return caption;
  }

  const withoutDescription = parts.filter((part) => !part.startsWith("📝 "));
  caption = withoutDescription.join("\n");

  if (caption.length <= TELEGRAM_CAPTION_LIMIT) {
    return caption;
  }

  const linkLines = withoutDescription.filter(isSourceLinkLine);
  const rest = withoutDescription.filter((part) => !isSourceLinkLine(part));
  const linkBlock = linkLines.join("\n");
  const linkBudget = linkBlock ? linkBlock.length + 1 : 0;
  const restCaption = truncateText(
    rest.join("\n"),
    TELEGRAM_CAPTION_LIMIT - linkBudget
  );

  return [restCaption, linkBlock].filter(Boolean).join("\n");
}

function formatSourceLink(url?: string): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) {
    return undefined;
  }

  return `🔗 ${trimmed}`;
}

export function formatAnalyzingCaption(
  platform: MediaPlatform = "youtube",
  instagramType?: VideoInfo["instagramType"]
): string {
  const source =
    platform === "instagram" && instagramType
      ? `Instagram ${getInstagramTypeLabel(instagramType).toLowerCase()}`
      : getPlatformConfig(platform).name;

  return [
    "🔍 Analyzing link...",
    "",
    `Fetching ${source} info and available qualities.`,
  ].join("\n");
}

export function formatVideoPreviewCaption(info: VideoInfo): string {
  return fitCaption(
    [
      platformBadge(info),
      videoHeader(info),
      formatDescriptionBlock(info),
      formatCarouselNote(info),
      info.channelUrl ? `🔗 ${info.channelUrl}` : undefined,
      "",
      "ℹ️ Review the details above, then choose a quality below.",
      "No download has started yet.",
    ].filter((part): part is string => Boolean(part))
  );
}

function formatSplitBlock(timeRange: TimeRange): string {
  return [
    formatSplitSummary(timeRange),
    "Only this section will be downloaded from YouTube.",
  ].join("\n");
}

function qualitiesHeading(info: VideoInfo): string {
  const source = getPlatformConfig(info.platform).sourceLabel;
  return `📋 Available qualities on ${source}:`;
}

export function formatQualityPickerCaption(
  info: VideoInfo,
  options: QualityOption[],
  timeRange?: TimeRange
): string {
  const hasOversized = options.some((option) => option.exceedsTelegramLimit);

  return fitCaption(
    [
      platformBadge(info),
      videoHeader(info),
      formatDescriptionBlock(info),
      formatCarouselNote(info),
      timeRange ? "" : undefined,
      timeRange ? formatSplitBlock(timeRange) : undefined,
      "",
      qualitiesHeading(info),
      "",
      formatQualityList(options),
      "",
      hasOversized
        ? "⚠️ Items marked ⚠️ may be too large to send."
        : "✅ All listed qualities should send without issues.",
      "",
      "Tap a button to start downloading.",
    ].filter((part): part is string => Boolean(part))
  );
}

export function formatProcessingBaseCaption(
  info: VideoInfo,
  options: QualityOption[],
  selected: QualityOption,
  timeRange?: TimeRange
): string {
  const pickerCaption = formatQualityPickerCaption(info, options, timeRange)
    .split("\n")
    .filter((line) => line !== "Tap a button to start downloading.")
    .join("\n");

  const selectedIcon = selected.audioOnly
    ? "🎵"
    : selected.mediaKind === "image"
      ? "📸"
      : mediaHeaderIcon(info);

  return fitCaption([
    pickerCaption,
    "",
    `✅ Selected: ${selectedIcon} ${selected.label}`,
    selected.subtitle,
  ]);
}

export function formatQualityCancelledCaption(info: VideoInfo): string {
  return fitCaption([
    platformBadge(info),
    videoHeader(info),
    "",
    "❌ Cancelled. No download was started.",
  ]);
}

export function formatResultCaption(
  info: VideoInfo,
  options: {
    quality: QualityOption;
    timeRange?: TimeRange;
    sourceUrl?: string;
  }
): string {
  const { quality, timeRange, sourceUrl } = options;
  const resultIcon = quality.audioOnly
    ? "🎵"
    : quality.mediaKind === "image"
      ? "📸"
      : mediaHeaderIcon(info);
  const link = formatSourceLink(sourceUrl ?? info.webpageUrl);

  return fitCaption(
    [
      platformBadge(info),
      videoHeader(info, quality.audioOnly, timeRange),
      link,
      timeRange ? formatSplitSummary(timeRange) : undefined,
      formatDescriptionBlock(info, 500),
      `${resultIcon} ${quality.label} · ${quality.subtitle}`,
    ].filter((part): part is string => Boolean(part))
  );
}

export function formatAdminNotifyCaption(input: {
  userId: number;
  username?: string;
  userNote?: string;
  resultCaption: string;
}): string {
  const requester = input.username
    ? `@${input.username} (${input.userId})`
    : String(input.userId);

  return fitCaption([
    "📬 User download",
    "",
    `👤 Downloaded by: ${requester}`,
    input.userNote ? `📋 User note: ${input.userNote}` : undefined,
    "",
    input.resultCaption,
  ].filter((part): part is string => Boolean(part)));
}

function chunkOptions<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export function buildQualityKeyboard(
  request: PendingRequest
): InlineKeyboardMarkup {
  const videoOptions = request.options.filter(
    (option) => !option.audioOnly && option.mediaKind !== "image"
  );
  const imageOptions = request.options.filter(
    (option) => option.mediaKind === "image"
  );
  const audioOptions = request.options.filter((option) => option.audioOnly);

  const rows = chunkOptions([...imageOptions, ...videoOptions], 2).map((row) =>
    row.map((option) =>
      Markup.button.callback(
        buttonLabel(option),
        buildCallbackData(request.id, option.id)
      )
    )
  );

  if (audioOptions.length > 0) {
    rows.push(
      audioOptions.map((option) =>
        Markup.button.callback(
          buttonLabel(option),
          buildCallbackData(request.id, option.id)
        )
      )
    );
  }

  rows.push([
    Markup.button.callback("❌ Cancel", buildCallbackData(request.id, "cancel")),
  ]);

  return Markup.inlineKeyboard(rows).reply_markup;
}

function buttonLabel(option: QualityOption): string {
  const warning = option.exceedsTelegramLimit ? " ⚠️" : "";
  const prefix = option.audioOnly ? "🎵 " : option.mediaKind === "image" ? "📸 " : "🎬 ";
  const size = option.estimatedBytes
    ? ` · ${formatEstimatedSize(option.estimatedBytes)}`
    : "";

  return `${prefix}${option.label}${size}${warning}`;
}

function formatEstimatedSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  }

  return `${(bytes / 1024).toFixed(0)}KB`;
}

export function resolveQualityChoice(
  request: PendingRequest,
  action: string
): QualityOption | "cancel" | undefined {
  if (action === "cancel") {
    return "cancel";
  }

  return findQualityOption(request.options, action);
}
