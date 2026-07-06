const url = process.env.YOUTUBE_POT_SERVER_URL?.trim() || "http://127.0.0.1:4416";
const retries = 8;
const delayMs = 2000;

for (let attempt = 1; attempt <= retries; attempt++) {
  try {
    const response = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json();
    console.log(`POT server OK at ${url}`, body);
    process.exit(0);
  } catch (error) {
    if (attempt < retries) {
      console.log(`Waiting for POT server (${attempt}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`POT server not reachable at ${url}: ${message}`);
    console.error("");
    console.error("Fix:");
    console.error("  1. npm run setup:youtube");
    console.error("  2. npm run deploy");
    console.error("  3. npx pm2 status   (bgutil-pot-server should be online)");
    console.error("  4. npx pm2 logs bgutil-pot-server --lines 50");
    process.exit(1);
  }
}
