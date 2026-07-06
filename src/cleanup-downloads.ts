import { readdir, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { logError, logInfo } from "./logger";

export const DEFAULT_DOWNLOAD_MAX_AGE_MS = 60 * 60 * 1000;
export const DEFAULT_DOWNLOAD_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function getMaxAgeMs(): number {
  const fromEnv = process.env.DOWNLOAD_CLEANUP_MAX_AGE_MS;
  if (!fromEnv) {
    return DEFAULT_DOWNLOAD_MAX_AGE_MS;
  }

  const parsed = Number(fromEnv);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error("DOWNLOAD_CLEANUP_MAX_AGE_MS must be a positive number.");
  }

  return parsed;
}

async function removeOldFiles(
  dir: string,
  maxAgeMs: number,
  now: number
): Promise<number> {
  let removed = 0;
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      removed += await removeOldFiles(fullPath, maxAgeMs, now);

      try {
        const remaining = await readdir(fullPath);
        if (remaining.length === 0) {
          await rmdir(fullPath);
          logInfo(`[cleanup] removed empty dir: ${fullPath}`);
        }
      } catch {
        // Directory may already be gone.
      }

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(fullPath);
    if (now - fileStat.mtimeMs > maxAgeMs) {
      await unlink(fullPath);
      removed += 1;
      logInfo(`[cleanup] removed file: ${fullPath}`);
    }
  }

  return removed;
}

export async function cleanupOldDownloads(): Promise<number> {
  const maxAgeMs = getMaxAgeMs();
  const downloadDir = config.downloadDir;
  const now = Date.now();

  logInfo(
    `[cleanup] scanning ${downloadDir} for files older than ${Math.round(maxAgeMs / 60000)} minutes`
  );

  const removed = await removeOldFiles(downloadDir, maxAgeMs, now);
  logInfo(`[cleanup] done, removed ${removed} file(s)`);
  return removed;
}
