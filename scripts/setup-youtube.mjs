import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const YTDlpWrap = require("yt-dlp-wrap-plus").default;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const PLUGIN_ZIP = path.join(PLUGINS_DIR, "bgutil-ytdlp-pot-provider.zip");
const PLUGIN_URL =
  "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip";
const BGUTIL_VERSION = "1.3.1";
const VENDOR_DIR = path.join(ROOT, "vendor", "bgutil-ytdlp-pot-provider");
const SERVER_DIR = path.join(VENDOR_DIR, "server");
const SERVER_MAIN = path.join(SERVER_DIR, "build", "main.js");
const YTDLP_BIN = path.join(ROOT, "bin", "yt-dlp");
const TEST_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function downloadPluginZip() {
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

async function setupPotServer() {
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
  console.log(
    "If this fails, install build deps: apt install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev"
  );
  await execFileAsync("npm", ["ci"], { cwd: SERVER_DIR });
  await execFileAsync("npx", ["tsc"], { cwd: SERVER_DIR });

  if (!(await exists(SERVER_MAIN))) {
    throw new Error(`POT server build missing: ${SERVER_MAIN}`);
  }

  console.log(`POT server ready: ${SERVER_MAIN}`);
}

async function updateYtDlpBinary() {
  await mkdir(path.dirname(YTDLP_BIN), { recursive: true });
  console.log("Updating yt-dlp binary...");
  await YTDlpWrap.downloadFromGithub(YTDLP_BIN);
  await chmod(YTDLP_BIN, 0o755);
  const { stdout } = await execFileAsync(YTDLP_BIN, ["--version"]);
  console.log(`yt-dlp version: ${stdout.trim()}`);
}

async function smokeTestYoutube() {
  if (!(await exists(PLUGIN_ZIP))) {
    throw new Error(`Missing plugin zip: ${PLUGIN_ZIP}`);
  }

  const potUrl = process.env.YOUTUBE_POT_SERVER_URL?.trim() || "http://127.0.0.1:4416";
  const args = [
    TEST_URL,
    "--no-playlist",
    "--skip-download",
    "--dump-single-json",
    "--js-runtimes",
    `node:${process.execPath}`,
    "--remote-components",
    "ejs:github",
    "--plugin-dirs",
    PLUGINS_DIR,
    "--extractor-args",
    [
      "youtube:player_client=mweb,android_vr,web",
      `youtubepot-bgutilhttp:base_url=${potUrl}`,
      `youtubepot-bgutilscript:server_home=${SERVER_DIR}`,
    ].join(";"),
    "-v",
  ];

  console.log("Running YouTube smoke test...");
  try {
    const { stdout, stderr } = await execFileAsync(YTDLP_BIN, args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    const combined = `${stdout}\n${stderr}`;
    if (!combined.includes("bgutil")) {
      console.warn("Warning: bgutil plugin not detected in verbose output.");
    }
    if (!stdout.trim().startsWith("{")) {
      throw new Error("yt-dlp did not return JSON metadata.");
    }
    console.log("YouTube smoke test passed.");
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : "";
    const hint = stderr.includes("not a bot")
      ? "YouTube is blocking this server IP. Ensure POT server is running (curl http://127.0.0.1:4416/ping)."
      : "Check POT server logs: npx pm2 logs bgutil-pot-server";
    throw new Error(`${hint}\n${stderr.slice(-1200)}`);
  }
}

try {
  await downloadPluginZip();
  await setupPotServer();
  await updateYtDlpBinary();
  console.log("");
  console.log("YouTube setup complete (no cookies).");
  console.log("Next: npm run deploy");
  console.log("(After deploy) run: npm run youtube:test");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`YouTube setup failed: ${message}`);
  process.exit(1);
}
