#!/usr/bin/env node

import path from "node:path";
import { downloadVideo } from "./download";
import { buildQualityOptions } from "./formats";
import { extractMediaUrl } from "./media-url";
import { analyzeVideo } from "./video-info";

function printUsage(): void {
  console.log(`
YouTube & Instagram downloader

Usage: npm run download -- <media-url> [options]

Supported links:
  YouTube   — videos, Shorts, live streams
  Instagram — public posts, reels, and stories

Options:
  -o, --output <dir>   Output directory (default: ./downloads)
  -a, --audio          Download audio only (mp3)
  -h, --help           Show this help

Examples:
  npm run download -- "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  npm run download -- "https://www.instagram.com/reel/SHORTCODE/"
  npm run download -- "https://youtu.be/dQw4w9WgXcQ" -o ~/Videos
  npm run download -- "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --audio
`);
}

function parseArgs(argv: string[]): {
  url?: string;
  outputDir: string;
  audioOnly: boolean;
  help: boolean;
} {
  let url: string | undefined;
  let outputDir = path.resolve("downloads");
  let audioOnly = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }

    if (arg === "-a" || arg === "--audio") {
      audioOnly = true;
      continue;
    }

    if (arg === "-o" || arg === "--output") {
      const next = argv[++i];
      if (!next) {
        throw new Error("Missing value for --output");
      }
      outputDir = path.resolve(next);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    url = arg;
  }

  return { url, outputDir, audioOnly, help };
}

async function main(): Promise<void> {
  try {
    const { url, outputDir, audioOnly, help } = parseArgs(process.argv.slice(2));

    if (help) {
      printUsage();
      return;
    }

    if (!url) {
      printUsage();
      process.exitCode = 1;
      return;
    }

    const link = extractMediaUrl(url);
    if (!link) {
      throw new Error("Unsupported or unrecognized media link.");
    }

    console.log(`Downloading: ${link.normalizedUrl}`);
    console.log(`Platform:    ${link.platform}`);
    console.log(`Output dir:  ${outputDir}`);
    if (audioOnly) {
      console.log("Mode:        audio only (mp3)");
    }

    const analysis = await analyzeVideo(link.normalizedUrl);
    const options = buildQualityOptions(
      analysis.formats,
      analysis.info.duration,
      audioOnly ? "audio" : "video",
      Number.POSITIVE_INFINITY,
      undefined,
      analysis.info.platform,
      analysis.info.mediaKind
    );

    if (options.length === 0) {
      throw new Error("No downloadable formats were found for this link.");
    }

    const filepath = await downloadVideo({
      url: analysis.mediaUrl,
      outputDir,
      quality: options[0],
      platform: analysis.info.platform,
    });
    console.log(`Done: ${filepath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

main();
