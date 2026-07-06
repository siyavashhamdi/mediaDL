import { access, chmod, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import YTDlpWrap from "yt-dlp-wrap-plus";

const projectRoot = path.resolve(__dirname, "..");
export const ytDlpBinaryPath = path.join(projectRoot, "bin", "yt-dlp");
const binaryPath = ytDlpBinaryPath;

let instance: YTDlpWrap | null = null;

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
