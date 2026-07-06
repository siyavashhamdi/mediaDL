import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ytDlpBinaryPath } from "./ytdlp";

const execFileAsync = promisify(execFile);
const TEMP_PREFIX = "yt-dl-";

export async function cleanupStaleDownloads(): Promise<void> {
  await killStaleYtDlpProcesses();
  await cleanupTempDirs();
}

async function killStaleYtDlpProcesses(): Promise<void> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", ytDlpBinaryPath]);
    const pids = stdout
      .trim()
      .split("\n")
      .map((pid) => Number(pid.trim()))
      .filter((pid) => !Number.isNaN(pid) && pid !== process.pid);

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may already be gone.
      }
    }

    if (pids.length > 0) {
      console.log(`Cancelled ${pids.length} stale download process(es).`);
    }
  } catch {
    // pgrep exits with code 1 when no processes match.
  }
}

async function cleanupTempDirs(): Promise<void> {
  let entries: string[];

  try {
    entries = await readdir(tmpdir());
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith(TEMP_PREFIX)) {
      continue;
    }

    await rm(path.join(tmpdir(), entry), { recursive: true, force: true });
  }
}
