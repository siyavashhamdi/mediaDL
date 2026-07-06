import type { MediaKind, MediaPlatform } from "./platform";

export type YtDlpFormat = {
  format_id: string;
  ext?: string;
  height?: number;
  width?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
  tbr?: number;
  abr?: number;
};

export type QualityOption = {
  id: string;
  label: string;
  subtitle: string;
  formatSelector: string;
  audioOnly: boolean;
  mediaKind: MediaKind;
  estimatedBytes?: number;
  height?: number;
  exceedsTelegramLimit: boolean;
};

export type QualityMode = "video" | "audio";

function formatBytes(bytes?: number): string {
  if (!bytes) {
    return "unknown size";
  }

  if (bytes >= 1024 * 1024 * 1024) {
    return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `~${(bytes / 1024).toFixed(0)} KB`;
}

function estimateFormatBytes(
  format: YtDlpFormat,
  durationSec: number
): number | undefined {
  if (format.filesize) {
    return format.filesize;
  }

  if (format.filesize_approx) {
    return format.filesize_approx;
  }

  const bitrate = format.tbr ?? format.abr;
  if (bitrate && durationSec > 0) {
    return Math.round((bitrate * 1000 * durationSec) / 8);
  }

  return undefined;
}

function hasVideo(format: YtDlpFormat): boolean {
  return Boolean(format.vcodec && format.vcodec !== "none");
}

function hasAudio(format: YtDlpFormat): boolean {
  return Boolean(format.acodec && format.acodec !== "none");
}

function isAudioOnly(format: YtDlpFormat): boolean {
  return hasAudio(format) && !hasVideo(format);
}

function isImageFormat(format: YtDlpFormat): boolean {
  const ext = format.ext?.toLowerCase();
  return (
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "png" ||
    ext === "webp" ||
    (!hasVideo(format) && !hasAudio(format) && Boolean(ext))
  );
}

function pickBestAudioFormat(formats: YtDlpFormat[]): YtDlpFormat | undefined {
  return formats
    .filter(isAudioOnly)
    .sort((a, b) => {
      const aSize = a.filesize ?? a.filesize_approx ?? a.abr ?? 0;
      const bSize = b.filesize ?? b.filesize_approx ?? b.abr ?? 0;
      return bSize - aSize;
    })[0];
}

function pickBestImageFormat(formats: YtDlpFormat[]): YtDlpFormat | undefined {
  return formats
    .filter(isImageFormat)
    .sort((a, b) => {
      const aPixels = (a.width ?? 0) * (a.height ?? 0);
      const bPixels = (b.width ?? 0) * (b.height ?? 0);
      if (aPixels !== bPixels) {
        return bPixels - aPixels;
      }

      return (b.filesize ?? b.filesize_approx ?? 0) - (a.filesize ?? a.filesize_approx ?? 0);
    })[0];
}

function pickBestVideoForHeight(
  formats: YtDlpFormat[],
  height: number
): YtDlpFormat | undefined {
  return formats
    .filter((format) => hasVideo(format) && format.height === height)
    .sort((a, b) => {
      const extScore = (ext?: string) => (ext === "mp4" ? 2 : ext === "webm" ? 1 : 0);
      const extDiff = extScore(b.ext) - extScore(a.ext);
      if (extDiff !== 0) {
        return extDiff;
      }

      return (b.fps ?? 0) - (a.fps ?? 0);
    })[0];
}

function pickBestVideoFormat(formats: YtDlpFormat[]): YtDlpFormat | undefined {
  return formats
    .filter(hasVideo)
    .sort((a, b) => {
      const heightDiff = (b.height ?? 0) - (a.height ?? 0);
      if (heightDiff !== 0) {
        return heightDiff;
      }

      return (b.filesize ?? b.filesize_approx ?? 0) - (a.filesize ?? a.filesize_approx ?? 0);
    })[0];
}

function buildVideoOption(
  height: number,
  videoFormat: YtDlpFormat,
  audioFormat: YtDlpFormat | undefined,
  durationSec: number,
  telegramLimit: number,
  platform: MediaPlatform
): QualityOption {
  const videoBytes = estimateFormatBytes(videoFormat, durationSec) ?? 0;
  const audioBytes = audioFormat
    ? estimateFormatBytes(audioFormat, durationSec) ?? 0
    : 0;
  const estimatedBytes =
    hasAudio(videoFormat) && hasVideo(videoFormat)
      ? estimateFormatBytes(videoFormat, durationSec)
      : videoBytes + audioBytes;

  const fps = videoFormat.fps ? `${Math.round(videoFormat.fps)}fps` : undefined;
  const ext = (videoFormat.ext ?? "mp4").toUpperCase();
  const subtitle = [ext, formatBytes(estimatedBytes), fps].filter(Boolean).join(" · ");

  const formatSelector =
    platform === "instagram"
      ? videoFormat.format_id
      : `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;

  return {
    id: `h${height}`,
    label: `${height}p`,
    subtitle,
    formatSelector,
    audioOnly: false,
    mediaKind: "video",
    estimatedBytes,
    height,
    exceedsTelegramLimit: Boolean(estimatedBytes && estimatedBytes > telegramLimit),
  };
}

function buildGenericVideoOption(
  videoFormat: YtDlpFormat,
  durationSec: number,
  telegramLimit: number,
  platform: MediaPlatform
): QualityOption {
  const estimatedBytes = estimateFormatBytes(videoFormat, durationSec);
  const resolution =
    videoFormat.height && videoFormat.width
      ? `${videoFormat.width}×${videoFormat.height}`
      : videoFormat.height
        ? `${videoFormat.height}p`
        : undefined;
  const ext = (videoFormat.ext ?? "mp4").toUpperCase();
  const subtitle = [ext, resolution, formatBytes(estimatedBytes)]
    .filter(Boolean)
    .join(" · ");

  return {
    id: `fmt-${videoFormat.format_id}`,
    label: platform === "instagram" ? "Best" : `Best · ${resolution ?? ext}`,
    subtitle,
    formatSelector:
      platform === "instagram" ? videoFormat.format_id : "bestvideo+bestaudio/best",
    audioOnly: false,
    mediaKind: "video",
    estimatedBytes,
    height: videoFormat.height,
    exceedsTelegramLimit: Boolean(estimatedBytes && estimatedBytes > telegramLimit),
  };
}

function buildImageOption(
  imageFormat: YtDlpFormat,
  telegramLimit: number
): QualityOption {
  const estimatedBytes =
    imageFormat.filesize ?? imageFormat.filesize_approx ?? undefined;
  const resolution =
    imageFormat.width && imageFormat.height
      ? `${imageFormat.width}×${imageFormat.height}`
      : undefined;
  const ext = (imageFormat.ext ?? "jpg").toUpperCase();
  const subtitle = [ext, resolution, formatBytes(estimatedBytes)]
    .filter(Boolean)
    .join(" · ");

  return {
    id: `img-${imageFormat.format_id}`,
    label: resolution ? `Photo · ${resolution}` : "Photo",
    subtitle,
    formatSelector: imageFormat.format_id,
    audioOnly: false,
    mediaKind: "image",
    estimatedBytes,
    exceedsTelegramLimit: Boolean(estimatedBytes && estimatedBytes > telegramLimit),
  };
}

function buildAudioOption(
  audioFormat: YtDlpFormat | undefined,
  durationSec: number,
  telegramLimit: number,
  platform: MediaPlatform
): QualityOption {
  const estimatedBytes = audioFormat
    ? estimateFormatBytes(audioFormat, durationSec)
    : undefined;
  const bitrate = audioFormat?.abr ? `${Math.round(audioFormat.abr)}k` : undefined;

  return {
    id: "audio",
    label: "Audio only",
    subtitle: ["MP3", formatBytes(estimatedBytes), bitrate].filter(Boolean).join(" · "),
    formatSelector: platform === "instagram" ? "bestaudio/best" : "bestaudio/best",
    audioOnly: true,
    mediaKind: "audio",
    estimatedBytes,
    exceedsTelegramLimit: Boolean(estimatedBytes && estimatedBytes > telegramLimit),
  };
}

function effectiveDuration(durationSec: number, clipDurationSec?: number): number {
  if (!clipDurationSec || clipDurationSec <= 0 || durationSec <= 0) {
    return durationSec;
  }

  return Math.min(clipDurationSec, durationSec);
}

function buildInstagramQualityOptions(
  formats: YtDlpFormat[],
  durationSec: number,
  mode: QualityMode,
  telegramLimit: number,
  mediaKind: MediaKind
): QualityOption[] {
  const estimateDuration = durationSec;

  if (mediaKind === "image" || mode === "video" && !formats.some(hasVideo)) {
    const imageFormat = pickBestImageFormat(formats);
    if (!imageFormat) {
      return [];
    }

    return [buildImageOption(imageFormat, telegramLimit)];
  }

  const options: QualityOption[] = [];
  const heights = [
    ...new Set(
      formats
        .filter((format) => hasVideo(format) && format.height)
        .map((format) => format.height as number)
    ),
  ].sort((a, b) => b - a);

  if (heights.length > 0) {
    const audioFormat = pickBestAudioFormat(formats);

    for (const height of heights) {
      const videoFormat = pickBestVideoForHeight(formats, height);
      if (!videoFormat) {
        continue;
      }

      options.push(
        buildVideoOption(
          height,
          videoFormat,
          audioFormat,
          estimateDuration,
          telegramLimit,
          "instagram"
        )
      );
    }

    if (options.length > 0) {
      options[0] = {
        ...options[0],
        label: `Best · ${options[0].height}p`,
      };
    }
  } else {
    const bestVideo = pickBestVideoFormat(formats);
    if (bestVideo) {
      options.push(
        buildGenericVideoOption(bestVideo, estimateDuration, telegramLimit, "instagram")
      );
    }
  }

  if (mode === "audio" && formats.some(hasAudio)) {
    return [buildAudioOption(pickBestAudioFormat(formats), estimateDuration, telegramLimit, "instagram")];
  }

  if (formats.some(hasAudio) && mediaKind === "video") {
    options.push(
      buildAudioOption(pickBestAudioFormat(formats), estimateDuration, telegramLimit, "instagram")
    );
  }

  return options;
}

export function buildQualityOptions(
  formats: YtDlpFormat[] | undefined,
  durationSec: number,
  mode: QualityMode,
  telegramLimit: number,
  clipDurationSec?: number,
  platform: MediaPlatform = "youtube",
  mediaKind: MediaKind = "video"
): QualityOption[] {
  const availableFormats = formats ?? [];
  const estimateDuration = effectiveDuration(durationSec, clipDurationSec);

  if (platform === "instagram") {
    return buildInstagramQualityOptions(
      availableFormats,
      estimateDuration,
      mode,
      telegramLimit,
      mediaKind
    );
  }

  const audioFormat = pickBestAudioFormat(availableFormats);
  const options: QualityOption[] = [];

  if (mode === "audio") {
    options.push(
      buildAudioOption(audioFormat, estimateDuration, telegramLimit, platform)
    );
    return options;
  }

  const heights = [
    ...new Set(
      availableFormats
        .filter((format) => hasVideo(format) && format.height)
        .map((format) => format.height as number)
    ),
  ].sort((a, b) => b - a);

  for (const height of heights) {
    const videoFormat = pickBestVideoForHeight(availableFormats, height);
    if (!videoFormat) {
      continue;
    }

    options.push(
      buildVideoOption(
        height,
        videoFormat,
        audioFormat,
        estimateDuration,
        telegramLimit,
        platform
      )
    );
  }

  if (options.length > 0) {
    const best = options[0];
    options[0] = {
      ...best,
      label: `Best · ${best.height}p`,
    };
  }

  options.push(
    buildAudioOption(audioFormat, estimateDuration, telegramLimit, platform)
  );
  return options;
}

export function findQualityOption(
  options: QualityOption[],
  optionId: string
): QualityOption | undefined {
  return options.find((option) => option.id === optionId);
}

export function formatQualityList(options: QualityOption[]): string {
  return options
    .map((option) => {
      const warning = option.exceedsTelegramLimit ? " ⚠️" : "";
      const icon = option.audioOnly ? "🎵" : option.mediaKind === "image" ? "📸" : "🎬";
      return `${icon} ${option.label} — ${option.subtitle}${warning}`;
    })
    .join("\n");
}
