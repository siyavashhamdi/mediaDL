import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const YTDLP_BIN = path.join(ROOT, "bin", "yt-dlp");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const SERVER_DIR = path.join(ROOT, "vendor", "bgutil-ytdlp-pot-provider", "server");
const TEST_URL =
  process.argv[2] || "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const potUrl = process.env.YOUTUBE_POT_SERVER_URL?.trim() || "http://127.0.0.1:4416";

async function exists(filePath) {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function pingPot(retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${potUrl}/ping`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        console.log(`POT server OK: ${potUrl}`);
        return;
      }
    } catch {
      // retry
    }
    if (attempt < retries) {
      console.log(`Waiting for POT server (${attempt}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(
    `POT server not reachable at ${potUrl}. Run: npm run deploy`
  );
}

if (!(await exists(YTDLP_BIN))) {
  console.error("yt-dlp missing. Run: npm run setup:youtube");
  process.exit(1);
}

try {
  await pingPot();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

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

console.log(`Testing: ${TEST_URL}`);

try {
  const { stdout, stderr } = await execFileAsync(YTDLP_BIN, args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  const combined = `${stdout}\n${stderr}`;
  const pluginLine = combined
    .split("\n")
    .find((line) => line.includes("PO Token Providers"));
  if (pluginLine) {
    console.log(pluginLine.trim());
  }
  const data = JSON.parse(stdout);
  console.log(`OK: ${data.title || data.id}`);
} catch (error) {
  const stderr =
    error && typeof error === "object" && "stderr" in error
      ? String(error.stderr)
      : "";
  console.error("YouTube test failed.");
  if (stderr) {
    console.error(stderr.slice(-2000));
  }
  process.exit(1);
}
