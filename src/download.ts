import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Progress } from "yt-dlp-wrap-plus/dist/index";
import type { QualityOption } from "./formats";
import type { LogContext } from "./logger";
import { logDownloadComplete, logDownloadProgress } from "./logger";
import type { MediaPlatform } from "./platform";
import { toYtDlpDownloadSections, type TimeRange } from "./time-range";
import { getYtDlp } from "./ytdlp";

export type DownloadPhase = "download" | "merge" | "extract";

export type DownloadProgress = {
  phase: DownloadPhase;
  percent?: number;
  totalSize?: string;
  speed?: string;
  eta?: string;
  detail?: string;
};

export type DownloadOptions = {
  url: string;
  outputDir: string;
  quality: QualityOption;
  platform?: MediaPlatform;
  timeRange?: TimeRange;
  logContext?: LogContext;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
};

const DOWNLOAD_PROGRESS_PATTERN =
  /\[download\]\s+([\d.]+%)\s+of\s+([\d.]+\s*\S+)(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/;

function parseDownloadLine(line: string): DownloadProgress | null {
  const match = line.match(DOWNLOAD_PROGRESS_PATTERN);
  if (!match) {
    return null;
  }

  return {
    phase: "download",
    percent: parseFloat(match[1].replace("%", "")),
    totalSize: match[2].trim(),
    speed: match[3],
    eta: match[4],
  };
}

function emitProgress(
  progress: DownloadProgress,
  lastPercent: { value: number },
  onProgress: ((progress: DownloadProgress) => void) | undefined,
  logContext?: LogContext
): void {
  const percent = progress.percent ?? 0;

  if (
    progress.phase !== "download" ||
    percent >= lastPercent.value + 0.5 ||
    percent >= 99.9
  ) {
    if (progress.phase === "download") {
      lastPercent.value = percent;
      logDownloadProgress(percent, logContext);
    }

    onProgress?.(progress);
  }
}

function consumeStderrChunk(
  chunk: string,
  buffer: { value: string },
  lastPercent: { value: number },
  onProgress: ((progress: DownloadProgress) => void) | undefined,
  logContext?: LogContext
): void {
  buffer.value += chunk;
  const parts = buffer.value.split(/\r|\n/);
  buffer.value = parts.pop() ?? "";

  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const progress = parseDownloadLine(trimmed);
    if (progress) {
      emitProgress(progress, lastPercent, onProgress, logContext);
      continue;
    }

    if (trimmed.startsWith("[Merger]")) {
      emitProgress(
        { phase: "merge", detail: trimmed.replace("[Merger]", "").trim() },
        lastPercent,
        onProgress,
        logContext
      );
      continue;
    }

    if (trimmed.startsWith("[ExtractAudio]")) {
      emitProgress(
        { phase: "extract", detail: trimmed.replace("[ExtractAudio]", "").trim() },
        lastPercent,
        onProgress,
        logContext
      );
    }
  }
}

function appendFormatArgs(
  args: string[],
  quality: QualityOption,
  platform: MediaPlatform
): void {
  if (quality.audioOnly) {
    args.push(
      "-f",
      quality.formatSelector,
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0"
    );
    return;
  }

  if (quality.mediaKind === "image" || platform === "instagram") {
    args.push("-f", quality.formatSelector);
    return;
  }

  args.push("-f", quality.formatSelector, "--merge-output-format", "mp4");
}

export async function downloadVideo(options: DownloadOptions): Promise<string> {
  const {
    url,
    outputDir,
    quality,
    platform = "youtube",
    timeRange,
    logContext,
    signal,
    onProgress,
  } = options;
  const ytDlp = await getYtDlp();

  await mkdir(outputDir, { recursive: true });

  const outputTemplate = path.join(outputDir, "video.%(ext)s");

  const args = [
    url,
    "--no-playlist",
    "--restrict-filenames",
    "--newline",
    "--no-colors",
    "--progress",
    "-o",
    outputTemplate,
    "--print",
    "after_move:filepath",
  ];

  if (timeRange && platform === "youtube") {
    args.push(
      "--download-sections",
      toYtDlpDownloadSections(timeRange),
      "--force-keyframes-at-cuts"
    );
  }

  appendFormatArgs(args, quality, platform);

  return new Promise((resolve, reject) => {
    const emitter = ytDlp.exec(args, {}, signal ?? null);
    const lastPercent = { value: -1 };
    const stderrBuffer = { value: "" };
    let filepath = "";

    emitter.on("progress", (progress: Progress) => {
      emitProgress(
        {
          phase: "download",
          percent: progress.percent,
          totalSize: progress.totalSize,
          speed: progress.currentSpeed,
          eta: progress.eta,
        },
        lastPercent,
        onProgress,
        logContext
      );
    });

    emitter.on("ytDlpEvent", (eventType, eventData) => {
      if (eventType === "Merger") {
        emitProgress(
          {
            phase: "merge",
            detail: eventData.trim(),
          },
          lastPercent,
          onProgress,
          logContext
        );
        return;
      }

      if (eventType === "ExtractAudio") {
        emitProgress(
          {
            phase: "extract",
            detail: eventData.trim(),
          },
          lastPercent,
          onProgress,
          logContext
        );
      }
    });

    emitter.ytDlpProcess?.stderr.on("data", (data: Buffer) => {
      consumeStderrChunk(
        data.toString(),
        stderrBuffer,
        lastPercent,
        onProgress,
        logContext
      );
    });

    emitter.ytDlpProcess?.stdout.on("data", (data: Buffer) => {
      for (const line of data.toString().split(/\r|\n/g)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("[")) {
          filepath = trimmed;
        }
      }
    });

    emitter.on("error", (error) => {
      if (signal?.aborted) {
        reject(new Error("Download cancelled."));
        return;
      }
      reject(error);
    });

    emitter.on("close", (code) => {
      if (signal?.aborted) {
        reject(new Error("Download cancelled."));
        return;
      }

      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code ?? "unknown"}.`));
        return;
      }

      if (!filepath) {
        reject(new Error("Download finished but no file path was returned."));
        return;
      }

      logDownloadComplete(filepath, logContext);
      resolve(filepath);
    });
  });
}
