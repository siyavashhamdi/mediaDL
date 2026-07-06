import {
  cleanupOldDownloads,
  DEFAULT_DOWNLOAD_CLEANUP_INTERVAL_MS,
} from "./cleanup-downloads";
import { logError, logInfo } from "./logger";

function getIntervalMs(): number {
  const fromEnv = process.env.DOWNLOAD_CLEANUP_INTERVAL_MS;
  if (!fromEnv) {
    return DEFAULT_DOWNLOAD_CLEANUP_INTERVAL_MS;
  }

  const parsed = Number(fromEnv);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error("DOWNLOAD_CLEANUP_INTERVAL_MS must be a positive number.");
  }

  return parsed;
}

async function runCleanupSafely(): Promise<void> {
  try {
    await cleanupOldDownloads();
  } catch (error) {
    logError(
      `[cleanup] failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function startDownloadCleanupScheduler(): () => void {
  const intervalMs = getIntervalMs();

  logInfo(
    `[cleanup] scheduler started, runs every ${Math.round(intervalMs / 60000)} minutes`
  );

  void runCleanupSafely();

  const timer = setInterval(() => {
    void runCleanupSafely();
  }, intervalMs);

  return () => {
    clearInterval(timer);
    logInfo("[cleanup] scheduler stopped");
  };
}
