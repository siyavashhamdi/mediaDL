export type MediaPlatform = "youtube" | "instagram";

export type InstagramContentType =
  | "post"
  | "reel"
  | "story"
  | "highlight"
  | "tv";

export type MediaKind = "video" | "audio" | "image";

export type PlatformConfig = {
  name: string;
  sourceLabel: string;
  supportsSplit: boolean;
  supportsAudioOnly: boolean;
};

const PLATFORM_CONFIGS: Record<MediaPlatform, PlatformConfig> = {
  youtube: {
    name: "YouTube",
    sourceLabel: "YouTube",
    supportsSplit: true,
    supportsAudioOnly: true,
  },
  instagram: {
    name: "Instagram",
    sourceLabel: "Instagram",
    supportsSplit: false,
    supportsAudioOnly: true,
  },
};

const INSTAGRAM_TYPE_LABELS: Record<InstagramContentType, string> = {
  post: "Post",
  reel: "Reel",
  story: "Story",
  highlight: "Highlight",
  tv: "IGTV",
};

export function getPlatformConfig(platform: MediaPlatform): PlatformConfig {
  return PLATFORM_CONFIGS[platform];
}

export function getInstagramTypeLabel(type: InstagramContentType): string {
  return INSTAGRAM_TYPE_LABELS[type];
}

export function platformSupportsSplit(platform: MediaPlatform): boolean {
  return PLATFORM_CONFIGS[platform].supportsSplit;
}

export function platformSupportsAudioOnly(platform: MediaPlatform): boolean {
  return PLATFORM_CONFIGS[platform].supportsAudioOnly;
}
