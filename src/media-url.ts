import type { InstagramContentType, MediaPlatform } from "./platform";

export type MediaLink = {
  url: string;
  normalizedUrl: string;
  platform: MediaPlatform;
  instagramType?: InstagramContentType;
};

const YOUTUBE_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=[\w-]+|shorts\/[\w-]+|live\/[\w-]+)|youtu\.be\/[\w-]+(?:\?[^\s]*)?)/i;

const INSTAGRAM_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s]+/i;

const TRAILING_URL_PUNCTUATION = /[),.!?;:]+$/;

function cleanExtractedUrl(url: string): string {
  return url.replace(TRAILING_URL_PUNCTUATION, "");
}

function classifyInstagramPath(pathname: string): InstagramContentType | undefined {
  const path = pathname.replace(/\/+$/, "");

  if (/\/stories\/highlights\/\d+/i.test(path)) {
    return "highlight";
  }

  if (/\/stories\/[^/]+\/\d+/i.test(path)) {
    return "story";
  }

  if (/\/reels?\/[\w-]+/i.test(path)) {
    return "reel";
  }

  if (/\/p\/[\w-]+/i.test(path)) {
    return "post";
  }

  if (/^\/[\w.]+\/p\/[\w-]+/i.test(path)) {
    return "post";
  }

  if (/\/tv\/[\w-]+/i.test(path)) {
    return "tv";
  }

  if (/\/share\/reel\//i.test(path)) {
    return "reel";
  }

  if (/\/share\/p\//i.test(path)) {
    return "post";
  }

  if (/^\/[\w.]+\/reel\/[\w-]+/i.test(path)) {
    return "reel";
  }

  return undefined;
}

function normalizeInstagramUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";

  if (parsed.hostname === "instagr.am") {
    parsed.hostname = "www.instagram.com";
  }

  return parsed.toString();
}

function buildYoutubeLink(url: string): MediaLink {
  return {
    url,
    normalizedUrl: url,
    platform: "youtube",
  };
}

function buildInstagramLink(url: string): MediaLink | null {
  const normalizedUrl = normalizeInstagramUrl(url);
  const pathname = new URL(normalizedUrl).pathname;
  const instagramType = classifyInstagramPath(pathname);

  if (!instagramType) {
    return null;
  }

  return {
    url,
    normalizedUrl,
    platform: "instagram",
    instagramType,
  };
}

function findEarliestMatch(
  text: string,
  pattern: RegExp,
  build: (url: string) => MediaLink | null
): MediaLink | null {
  const match = text.match(pattern);
  if (!match?.[0]) {
    return null;
  }

  const url = cleanExtractedUrl(match[0]);
  return build(url);
}

export function detectMediaLink(url: string): MediaLink | null {
  const cleaned = cleanExtractedUrl(url.trim());

  if (YOUTUBE_URL_PATTERN.test(cleaned)) {
    return buildYoutubeLink(cleaned);
  }

  if (INSTAGRAM_URL_PATTERN.test(cleaned)) {
    return buildInstagramLink(cleaned);
  }

  return null;
}

export function extractMediaUrl(text: string): MediaLink | null {
  const candidates: Array<{ index: number; link: MediaLink }> = [];

  const youtubeMatch = text.match(YOUTUBE_URL_PATTERN);
  if (youtubeMatch?.index !== undefined) {
    const url = cleanExtractedUrl(youtubeMatch[0]);
    candidates.push({ index: youtubeMatch.index, link: buildYoutubeLink(url) });
  }

  const instagramMatch = text.match(INSTAGRAM_URL_PATTERN);
  if (instagramMatch?.index !== undefined) {
    const url = cleanExtractedUrl(instagramMatch[0]);
    const link = buildInstagramLink(url);
    if (link) {
      candidates.push({ index: instagramMatch.index, link });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => a.index - b.index);
  return candidates[0].link;
}

/** @deprecated Use extractMediaUrl */
export function extractYoutubeUrl(text: string): string | null {
  const link = extractMediaUrl(text);
  return link?.platform === "youtube" ? link.url : null;
}

export function isInstagramStoryLink(link: MediaLink): boolean {
  return (
    link.platform === "instagram" &&
    (link.instagramType === "story" || link.instagramType === "highlight")
  );
}
