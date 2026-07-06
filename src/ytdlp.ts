import { access, chmod, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import YTDlpWrap from "yt-dlp-wrap-plus";
import { config } from "./config";
import type { MediaPlatform } from "./platform";

const projectRoot = path.resolve(__dirname, "..");
export const ytDlpBinaryPath = path.join(projectRoot, "bin", "yt-dlp");
export const ytDlpPluginDir = path.join(projectRoot, "plugins");
export const bgutilServerHome = path.join(
  projectRoot,
  "vendor",
  "bgutil-ytdlp-pot-provider",
  "server"
);
const binaryPath = ytDlpBinaryPath;

let instance: YTDlpWrap | null = null;

function buildYoutubeExtractorArgs(): string {
  const parts = [
    "youtube:player_client=mweb,android_vr,web",
    `youtubepot-bgutilhttp:base_url=${config.youtubePotServerUrl}`,
    `youtubepot-bgutilscript:server_home=${bgutilServerHome}`,
  ];

  return parts.join(";");
}

/** YouTube on servers needs a JS runtime + PO tokens (no browser cookies). */
export function appendYtDlpPlatformArgs(
  args: string[],
  platform: MediaPlatform
): void {
  if (platform !== "youtube") {
    return;
  }

  args.push("--js-runtimes", `node:${process.execPath}`);
  args.push("--plugin-dirs", ytDlpPluginDir);
  args.push("--extractor-args", buildYoutubeExtractorArgs());
}

export function buildAnalyzeArgs(url: string, platform: MediaPlatform): string[] {
  const args = [url, "--no-playlist", "--skip-download", "--dump-single-json"];
  appendYtDlpPlatformArgs(args, platform);
  return args;
}

export async function isPotServerReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.youtubePotServerUrl}/ping`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureBinary(): Promise<void> {
  try {
    await access(binaryPath, constants.X_OK);
    return;
  } catch {
    // Binary missing; download below.
  }

  await mkdir(path.dirname(binaryPath), { recursive: true });
  console.log("Downloading yt-dlp binary (first run only)...");
  await YTDlpWrap.downloadFromGithub(binaryPath);
  await chmod(binaryPath, 0o755);
}

export async function getYtDlp(): Promise<YTDlpWrap> {
  await ensureBinary();

  if (!instance) {
    instance = new YTDlpWrap(binaryPath);
  }

  return instance;
}
