import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
  downloadDir: path.resolve(process.env.DOWNLOAD_DIR ?? "downloads"),
  accessListFile: path.resolve(process.env.ACCESS_LIST_FILE ?? "users.json"),
  logDir: path.resolve(process.env.LOG_DIR ?? "logs"),
  youtubePotServerUrl:
    process.env.YOUTUBE_POT_SERVER_URL?.trim() || "http://127.0.0.1:4416",
};

export const TELEGRAM_MAX_FILE_BYTES = 50 * 1024 * 1024;
