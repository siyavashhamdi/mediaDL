import { cleanupOldDownloads } from "./cleanup-downloads";

cleanupOldDownloads().catch((error) => {
  console.error(
    `[cleanup] failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
