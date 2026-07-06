import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const TEMP_PREFIX = "yt-dl-";

export async function createTempDownloadDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), TEMP_PREFIX));
}

export async function removeTempDownloadDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export function isTempDownloadDir(dir: string): boolean {
  return path.basename(dir).startsWith(TEMP_PREFIX);
}

export function getTempDirPattern(): string {
  return path.join(tmpdir(), `${TEMP_PREFIX}*`);
}
