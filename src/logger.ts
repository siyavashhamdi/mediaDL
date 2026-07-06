import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export type LogContext = {
  userId?: number;
  chatId?: number;
  messageId?: number;
  replyToMessageId?: number;
  statusMessageId?: number;
  username?: string;
  platform?: string;
  url?: string;
  requestId?: string;
};

type LogLevel = "INFO" | "ERROR" | "WARN";

let activeLabel: string | undefined;
let activePercent = -1;
let activeFilePercent = -1;
let logDirReady: Promise<void> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

function ensureLogDir(): Promise<void> {
  if (!logDirReady) {
    logDirReady = mkdir(config.logDir, { recursive: true }).then(() => undefined);
  }

  return logDirReady;
}

function dailyLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(config.logDir, `${date}.log`);
}

const LOG_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidLogDate(date: string): boolean {
  if (!LOG_DATE_PATTERN.test(date)) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function resolveLogDateArg(arg?: string): string | null {
  if (!arg?.trim()) {
    return null;
  }

  const trimmed = arg.trim();
  if (trimmed.toLowerCase() === "today") {
    return new Date().toISOString().slice(0, 10);
  }

  return isValidLogDate(trimmed) ? trimmed : null;
}

export function getDailyLogFilePath(date: string): string {
  return path.join(config.logDir, `${date}.log`);
}

function formatContext(ctx?: LogContext): string {
  if (!ctx) {
    return "";
  }

  const parts: string[] = [];

  if (ctx.userId !== undefined) {
    parts.push(`user=${ctx.userId}`);
  }
  if (ctx.username) {
    parts.push(`@${ctx.username}`);
  }
  if (ctx.chatId !== undefined && ctx.chatId !== ctx.userId) {
    parts.push(`chat=${ctx.chatId}`);
  }
  if (ctx.messageId !== undefined) {
    parts.push(`msg=${ctx.messageId}`);
  }
  if (ctx.replyToMessageId !== undefined) {
    parts.push(`reply=${ctx.replyToMessageId}`);
  }
  if (ctx.statusMessageId !== undefined) {
    parts.push(`status=${ctx.statusMessageId}`);
  }
  if (ctx.requestId) {
    parts.push(`req=${ctx.requestId}`);
  }
  if (ctx.platform) {
    parts.push(`platform=${ctx.platform}`);
  }
  if (ctx.url) {
    parts.push(`url=${ctx.url}`);
  }

  return parts.join(" ");
}

function formatDetails(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) {
    return "";
  }

  return ` ${JSON.stringify(details)}`;
}

function formatTerminalLine(
  level: LogLevel,
  category: string,
  message: string,
  ctx?: LogContext,
  details?: Record<string, unknown>
): string {
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const context = formatContext(ctx);
  const suffix = formatDetails(details);

  return `${time} ${level.padEnd(5)} ${category.padEnd(12)} ${context}${context ? " | " : ""}${message}${suffix}`;
}

function formatFileLine(
  level: LogLevel,
  category: string,
  message: string,
  ctx?: LogContext,
  details?: Record<string, unknown>
): string {
  const context = formatContext(ctx);
  const suffix = formatDetails(details);

  return `[${level}] [${category}] ${context}${context ? " | " : ""}${message}${suffix}`;
}

function appendToLogFile(line: string): void {
  writeQueue = writeQueue
    .then(async () => {
      await ensureLogDir();
      await appendFile(dailyLogPath(), `${new Date().toISOString()} ${line}\n`, "utf8");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[logger] failed to write log file: ${message}`);
    });
}

function writeLog(
  level: LogLevel,
  category: string,
  message: string,
  ctx?: LogContext,
  details?: Record<string, unknown>
): void {
  finishProgress();

  const terminalLine = formatTerminalLine(level, category, message, ctx, details);
  const fileLine = formatFileLine(level, category, message, ctx, details);

  if (level === "ERROR") {
    console.error(terminalLine);
  } else {
    console.log(terminalLine);
  }

  appendToLogFile(fileLine);
}

function renderProgress(label: string, percent: number): void {
  process.stdout.write(`\r[${label}] (${percent.toFixed(1)}%)`.padEnd(48));
}

export function finishProgress(): void {
  if (activeLabel) {
    process.stdout.write("\n");
    activeLabel = undefined;
    activePercent = -1;
    activeFilePercent = -1;
  }
}

function logProgress(
  label: "download" | "telegram",
  percent: number,
  ctx?: LogContext
): void {
  if (percent < activePercent + 0.5 && activeLabel === label) {
    return;
  }

  activeLabel = label;
  activePercent = percent;
  renderProgress(label, percent);

  if (percent >= activeFilePercent + 10 || percent >= 99.9) {
    activeFilePercent = Math.floor(percent / 10) * 10;
    appendToLogFile(
      `${new Date().toISOString()} [INFO] [${label}] ${formatContext(ctx)} | progress=${percent.toFixed(1)}%`
    );
  }
}

export function logInfo(
  message: string,
  ctx?: LogContext,
  details?: Record<string, unknown>
): void {
  writeLog("INFO", "app", message, ctx, details);
}

export function logWarn(
  message: string,
  ctx?: LogContext,
  details?: Record<string, unknown>
): void {
  writeLog("WARN", "app", message, ctx, details);
}

export function logError(
  message: string,
  ctx?: LogContext,
  details?: Record<string, unknown>
): void {
  writeLog("ERROR", "app", message, ctx, details);
}

export function logAccessDenied(ctx: LogContext): void {
  writeLog("WARN", "access", "denied", ctx);
}

export function logAnalyzeStart(ctx: LogContext): void {
  writeLog("INFO", "analyze", "started", ctx);
}

export function logAnalyzeComplete(
  title: string,
  formatCount: number,
  ctx?: LogContext
): void {
  writeLog("INFO", "analyze", "complete", ctx, { title, formats: formatCount });
}

export function logVideoInfo(
  title: string,
  uploader: string | undefined,
  duration: string,
  views: string,
  thumbnail: string,
  ctx?: LogContext,
  description?: string
): void {
  writeLog("INFO", "media", "metadata", ctx, {
    title,
    uploader,
    duration,
    views,
    thumbnail,
    description,
  });
}

export function logQualityOptions(
  options: { label: string; subtitle: string; warning: boolean }[],
  ctx?: LogContext
): void {
  writeLog("INFO", "qualities", `listed ${options.length} option(s)`, ctx, {
    options,
  });
}

export function logDownloadSelected(
  ctx: LogContext,
  details: {
    quality: string;
    subtitle: string;
    audioOnly: boolean;
    mediaKind: string;
    clip?: string;
  }
): void {
  writeLog("INFO", "download", "quality selected", ctx, details);
}

export function logDownloadPhase(
  phase: string,
  ctx?: LogContext,
  detail?: string
): void {
  writeLog("INFO", "download", phase, ctx, detail ? { detail } : undefined);
}

export function logDownloadProgress(percent: number, ctx?: LogContext): void {
  logProgress("download", percent, ctx);
}

/** @deprecated Use logDownloadProgress */
export function logYoutubeProgress(percent: number): void {
  logDownloadProgress(percent);
}

export function logDownloadComplete(filepath: string, ctx?: LogContext): void {
  writeLog("INFO", "download", "complete", ctx, { filepath });
}

/** @deprecated Use logDownloadComplete */
export function logYoutubeComplete(filepath: string): void {
  logDownloadComplete(filepath);
}

export function logTelegramUploadProgress(percent: number, ctx?: LogContext): void {
  logProgress("telegram", percent, ctx);
}

export function logTelegramComplete(
  kind: "video" | "audio" | "photo",
  ctx?: LogContext,
  details?: Record<string, unknown>
): void {
  writeLog("INFO", "telegram", `${kind} upload complete`, ctx, details);
}

export function logRequest(
  chatId: number,
  url: string,
  audioOnly: boolean,
  username?: string
): void {
  logDownloadSelected(
    {
      chatId,
      userId: chatId,
      username,
      url,
    },
    {
      quality: audioOnly ? "audio" : "video",
      subtitle: "",
      audioOnly,
      mediaKind: audioOnly ? "audio" : "video",
    }
  );
}

/** @deprecated Use logAnalyzeStart with LogContext */
export function logAnalyzeStartLegacy(
  chatId: number,
  url: string,
  username?: string
): void {
  logAnalyzeStart({
    chatId,
    userId: chatId,
    username,
    url,
  });
}

export async function initLogger(): Promise<void> {
  await ensureLogDir();
  writeLog("INFO", "system", `logging to ${config.logDir}`);
}
