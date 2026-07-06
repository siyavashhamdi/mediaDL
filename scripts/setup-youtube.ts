import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const PLUGIN_ZIP = path.join(PLUGINS_DIR, "bgutil-ytdlp-pot-provider.zip");
const PLUGIN_URL =
  "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip";
const BGUTIL_VERSION = "1.3.1";
const VENDOR_DIR = path.join(ROOT, "vendor", "bgutil-ytdlp-pot-provider");
const SERVER_DIR = path.join(VENDOR_DIR, "server");
const SERVER_MAIN = path.join(SERVER_DIR, "build", "main.js");

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function downloadPluginZip(): Promise<void> {
  await mkdir(PLUGINS_DIR, { recursive: true });

  if (await exists(PLUGIN_ZIP)) {
    console.log(`Plugin already present: ${PLUGIN_ZIP}`);
    return;
  }

  console.log("Downloading bgutil yt-dlp plugin...");
  const response = await fetch(PLUGIN_URL);

  if (!response.ok) {
    throw new Error(`Failed to download plugin (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(PLUGIN_ZIP, buffer);
  console.log(`Saved plugin to ${PLUGIN_ZIP}`);
}

async function setupPotServer(): Promise<void> {
  if (await exists(SERVER_MAIN)) {
    console.log(`POT server already built: ${SERVER_MAIN}`);
    return;
  }

  if (!(await exists(VENDOR_DIR))) {
    console.log("Cloning bgutil POT provider...");
    await execFileAsync(
      "git",
      [
        "clone",
        "--single-branch",
        "--branch",
        BGUTIL_VERSION,
        "--depth",
        "1",
        "https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git",
        VENDOR_DIR,
      ],
      { cwd: ROOT }
    );
  }

  console.log("Building POT server (npm ci + tsc)...");
  await execFileAsync("npm", ["ci"], { cwd: SERVER_DIR });
  await execFileAsync("npx", ["tsc"], { cwd: SERVER_DIR });
  console.log(`POT server ready: ${SERVER_MAIN}`);
}

async function main(): Promise<void> {
  await downloadPluginZip();
  await setupPotServer();
  console.log("");
  console.log("YouTube setup complete (no cookies).");
  console.log("Start with: npm run deploy");
  console.log("Or locally: npm run pot:start  (then npm run dev in another terminal)");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`YouTube setup failed: ${message}`);
  process.exitCode = 1;
});
