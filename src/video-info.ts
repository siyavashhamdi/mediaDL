import type { InstagramContentType, MediaKind, MediaPlatform } from "./platform";
import { detectMediaLink } from "./media-url";
import { buildAnalyzeArgs, getYtDlp } from "./ytdlp";
import type { YtDlpFormat } from "./formats";

export type VideoInfo = {
  id: string;
  title: string;
  description?: string;
  thumbnail: string;
  duration: number;
  uploader?: string;
  channelUrl?: string;
  uploadDate?: string;
  viewCount?: number;
  likeCount?: number;
  webpageUrl: string;
  platform: MediaPlatform;
  instagramType?: InstagramContentType;
  mediaKind: MediaKind;
  carouselCount?: number;
};

export type VideoAnalysis = {
  info: VideoInfo;
  formats: YtDlpFormat[];
  mediaUrl: string;
};

type YtDlpJson = {
  id: string;
  title?: string;
  fulltitle?: string;
  track?: string;
  alt_title?: string;
  description?: string;
  caption?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url: string; height?: number }>;
  duration?: number;
  uploader?: string;
  channel?: string;
  channel_url?: string;
  uploader_url?: string;
  upload_date?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  webpage_url?: string;
  original_url?: string;
  formats?: YtDlpFormat[];
  extractor?: string;
  extractor_key?: string;
  playlist_count?: number;
  _type?: string;
};

function pickThumbnail(data: YtDlpJson): string {
  if (data.thumbnail) {
    return data.thumbnail;
  }

  const thumbnails = data.thumbnails ?? [];
  const best = thumbnails
    .filter((item) => item.url)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];

  return best?.url ?? "";
}

function formatUploadDate(value?: string): string | undefined {
  if (!value || value.length !== 8) {
    return undefined;
  }

  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  return `${year}-${month}-${day}`;
}

function hasVideoCodec(format: YtDlpFormat): boolean {
  return Boolean(format.vcodec && format.vcodec !== "none");
}

function hasAudioCodec(format: YtDlpFormat): boolean {
  return Boolean(format.acodec && format.acodec !== "none");
}

function isImageFormat(format: YtDlpFormat): boolean {
  const ext = format.ext?.toLowerCase();
  return (
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "png" ||
    ext === "webp" ||
    (!hasVideoCodec(format) &&
      !hasAudioCodec(format) &&
      Boolean(ext && ["jpg", "jpeg", "png", "webp"].includes(ext)))
  );
}

export function detectMediaKind(formats: YtDlpFormat[]): MediaKind {
  const available = formats ?? [];

  if (available.some(hasVideoCodec)) {
    return "video";
  }

  if (available.some(isImageFormat)) {
    return "image";
  }

  if (available.some(hasAudioCodec)) {
    return "audio";
  }

  return "video";
}

function resolveTitle(
  data: YtDlpJson,
  platform: MediaPlatform,
  uploader?: string
): string {
  const candidates = [
    data.title,
    data.fulltitle,
    data.track,
    data.alt_title,
    data.description,
    data.caption,
  ]
    .map((value) => value?.trim())
    .filter(Boolean) as string[];

  if (candidates.length > 0) {
    const title = candidates[0];
    if (platform === "instagram" && title.length > 120) {
      return `${title.slice(0, 117)}…`;
    }
    return title;
  }

  if (uploader) {
    return platform === "instagram" ? `Post by @${uploader}` : uploader;
  }

  return platform === "instagram" ? "Instagram media" : "Video";
}

function resolveDescription(data: YtDlpJson): string | undefined {
  const description = data.description?.trim() || data.caption?.trim();
  return description || undefined;
}

function resolveUploader(data: YtDlpJson): string | undefined {
  return data.uploader ?? data.channel ?? undefined;
}

function resolveChannelUrl(data: YtDlpJson, uploader?: string): string | undefined {
  if (data.channel_url) {
    return data.channel_url;
  }

  if (data.uploader_url) {
    return data.uploader_url;
  }

  if (uploader) {
    return `https://www.instagram.com/${uploader}/`;
  }

  return undefined;
}

function mapVideoInfo(
  data: YtDlpJson,
  url: string,
  platform: MediaPlatform,
  instagramType?: InstagramContentType
): VideoInfo {
  const formats = data.formats ?? [];
  const uploader = resolveUploader(data);
  const description = resolveDescription(data);
  const title = resolveTitle(data, platform, uploader);

  let carouselCount: number | undefined;
  if (
    platform === "instagram" &&
    data.playlist_count &&
    data.playlist_count > 1
  ) {
    carouselCount = data.playlist_count;
  }

  return {
    id: data.id,
    title,
    description:
      description && description !== title ? description : undefined,
    thumbnail: pickThumbnail(data),
    duration: data.duration ?? 0,
    uploader,
    channelUrl: resolveChannelUrl(data, uploader),
    uploadDate: formatUploadDate(data.upload_date),
    viewCount: data.view_count,
    likeCount: data.like_count,
    webpageUrl: data.webpage_url ?? data.original_url ?? url,
    platform,
    instagramType,
    mediaKind: detectMediaKind(formats),
    carouselCount,
  };
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatViewCount(count?: number): string {
  if (!count) {
    return "—";
  }

  if (count >= 1_000_000_000) {
    return `${(count / 1_000_000_000).toFixed(1)}B`;
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }

  return String(count);
}

export function formatLikeCount(count?: number): string {
  if (!count) {
    return "—";
  }

  return formatViewCount(count);
}

export function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function formatVideoSummary(info: VideoInfo): string {
  const parts = [
    info.title,
    info.duration ? formatDuration(info.duration) : undefined,
    info.uploader,
    info.viewCount ? `${formatViewCount(info.viewCount)} views` : undefined,
  ].filter(Boolean);

  return parts.join(" · ");
}

/**
 * Fetches public metadata and available formats only.
 * Does not download any media files to the server.
 */
export async function analyzeVideo(url: string): Promise<VideoAnalysis> {
  const mediaLink = detectMediaLink(url);
  if (!mediaLink) {
    throw new Error("Unsupported or unrecognized media link.");
  }

  const ytDlp = await getYtDlp();
  const args = buildAnalyzeArgs(mediaLink.normalizedUrl, mediaLink.platform);
  const stdout = await ytDlp.execPromise(args);
  const data = JSON.parse(stdout) as YtDlpJson;

  return {
    info: mapVideoInfo(
      data,
      mediaLink.normalizedUrl,
      mediaLink.platform,
      mediaLink.instagramType
    ),
    formats: data.formats ?? [],
    mediaUrl: mediaLink.normalizedUrl,
  };
}

/** @deprecated Use analyzeVideo */
export async function fetchVideoDetails(url: string): Promise<VideoAnalysis> {
  return analyzeVideo(url);
}

export async function fetchVideoInfo(url: string): Promise<VideoInfo> {
  const analysis = await analyzeVideo(url);
  return analysis.info;
}
