import { stat } from "node:fs/promises";
import { Telegraf, type Context, type MiddlewareFn } from "telegraf";
import {
  formatAccessSummary,
  getUserAccess,
  validateAccessListFile,
  ADMIN_COMMANDS_HELP,
  ADMIN_COMMAND_NAMES,
  USER_COMMAND_NAMES,
  type UserAccess,
} from "./access-control";
import { registerAdminCommands } from "./admin-commands";
import { notifyAdminsOfAccessRequest, notifyAdminsOfUserDownload } from "./admin-notify";
import {
  beginDownload,
  cancelDownload,
  finishDownload,
  isAborted,
} from "./active-downloads";
import { cleanupStaleDownloads } from "./cleanup";
import { config, TELEGRAM_MAX_FILE_BYTES } from "./config";
import { downloadVideo } from "./download";
import { startDownloadCleanupScheduler } from "./download-cleanup-scheduler";
import { buildQualityOptions, type QualityOption } from "./formats";
import {
  initLogger,
  logAccessDenied,
  logAnalyzeComplete,
  logAnalyzeStart,
  logDownloadPhase,
  logDownloadProgress,
  logDownloadSelected,
  logError,
  logInfo,
  logWarn,
  logQualityOptions,
  logTelegramUploadProgress,
  logVideoInfo,
  type LogContext,
} from "./logger";
import { getPlatformConfig } from "./platform";
import {
  attachPendingMessage,
  deletePendingRequest,
  getPendingRequest,
  parseCallbackData,
  reservePendingRequest,
  type PendingRequest,
} from "./pending-request";
import {
  buildQualityKeyboard,
  formatAnalyzingCaption,
  formatProcessingBaseCaption,
  formatQualityCancelledCaption,
  formatQualityPickerCaption,
  formatResultCaption,
  resolveQualityChoice,
} from "./quality-picker";
import {
  parseAudioRequest,
  parseSplitRequest,
  parseUserRequest,
  type ParsedUserRequest,
} from "./request-parser";
import { createTempDownloadDir, removeTempDownloadDir } from "./temp-dir";
import {
  sendAudioWithProgress,
  sendPhotoWithProgress,
  sendVideoWithProgress,
} from "./telegram-upload";
import {
  formatDownloadProgressLine,
  formatPreparingProgressLine,
  formatUploadProgressLine,
  TelegramStatus,
} from "./telegram-status";
import { formatSplitSummary, validateTimeRange, type TimeRange } from "./time-range";
import type { InstagramContentType, MediaPlatform } from "./platform";
import { isPotServerReachable } from "./ytdlp";
import {
  analyzeVideo,
  formatDuration,
  formatViewCount,
  truncateText,
  type VideoInfo,
} from "./video-info";

const bot = new Telegraf(config.telegramBotToken);

function buildLogContext(input: {
  userId: number;
  chatId: number;
  replyToMessageId: number;
  statusMessageId?: number;
  username?: string;
  platform?: string;
  url?: string;
  requestId?: string;
}): LogContext {
  return {
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.replyToMessageId,
    replyToMessageId: input.replyToMessageId,
    statusMessageId: input.statusMessageId,
    username: input.username,
    platform: input.platform,
    url: input.url,
    requestId: input.requestId,
  };
}

function logContextFromAnalysis(
  chatId: number,
  input: AnalysisInput,
  username?: string,
  statusMessageId?: number,
  requestId?: string
): LogContext {
  return buildLogContext({
    userId: input.requesterUserId,
    chatId,
    replyToMessageId: input.replyToMessageId,
    statusMessageId,
    username,
    platform: input.platform,
    url: input.normalizedUrl,
    requestId,
  });
}

function logContextFromRequest(request: PendingRequest): LogContext {
  return buildLogContext({
    userId: request.requesterUserId,
    chatId: request.chatId,
    replyToMessageId: request.replyToMessageId,
    statusMessageId: request.messageId || undefined,
    username: request.username,
    platform: request.videoInfo.platform,
    url: request.url,
    requestId: request.id,
  });
}

function logContextFromCtx(ctx: Context): LogContext | undefined {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (!userId || !chatId) {
    return undefined;
  }

  const messageId =
    ctx.message && "message_id" in ctx.message ? ctx.message.message_id : undefined;

  return buildLogContext({
    userId,
    chatId,
    replyToMessageId: messageId ?? chatId,
    username: ctx.from?.username,
  });
}

function getAccessAttemptText(ctx: Context): string | undefined {
  const message = ctx.message;
  if (message && "text" in message && message.text) {
    return message.text;
  }

  const callback = ctx.callbackQuery;
  if (callback && "data" in callback && callback.data) {
    return `Button: ${callback.data}`;
  }

  return undefined;
}

const accessMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) {
    return next();
  }

  try {
    const access = await getUserAccess(userId);
    if (!access.allowed) {
      logAccessDenied(
        buildLogContext({
          userId,
          chatId: ctx.chat?.id ?? userId,
          replyToMessageId:
            ctx.message && "message_id" in ctx.message
              ? ctx.message.message_id
              : userId,
          username: ctx.from?.username,
        })
      );

      void notifyAdminsOfAccessRequest({
        telegram: ctx.telegram,
        userId,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        messageText: getAccessAttemptText(ctx),
        logContext: logContextFromCtx(ctx),
      });

      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(
          `This bot is private. Your ID: ${userId}`,
          { show_alert: true }
        );
        return;
      }

      if (ctx.message) {
        await ctx.reply(
          [
            "⛔ This bot is private.",
            "",
            "You don't have access. Ask the bot owner for an invitation.",
            "",
            `Your ID: ${userId}`,
          ].join("\n"),
          { reply_parameters: { message_id: ctx.message.message_id } }
        );
      }
      return;
    }

    ctx.state.userAccess = access;
    return next();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`[access] failed to read access list: ${message}`);

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("This bot isn't available right now.", {
        show_alert: true,
      });
      return;
    }

    if (ctx.message) {
      await ctx.reply(
        "This bot isn't available right now. Please try again later.",
        { reply_parameters: { message_id: ctx.message.message_id } }
      );
    }
  }
};

bot.use(accessMiddleware);

type ReplyContext = {
  chat: { id: number };
  message: { message_id: number; text: string };
  from?: { id: number; username?: string };
  reply: (
    text: string,
    extra?: { reply_parameters?: { message_id: number } }
  ) => Promise<unknown>;
};

function replyToUser(ctx: ReplyContext, text: string): Promise<unknown> {
  return ctx.reply(text, {
    reply_parameters: { message_id: ctx.message.message_id },
  });
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatAnalyzeError(error: unknown, platform: MediaPlatform): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/unsupported|unrecognized/i.test(message)) {
    return "That link isn't supported. Send a YouTube or Instagram URL.";
  }

  if (platform === "instagram" && /login|private|not available/i.test(message)) {
    return "Couldn't open this Instagram content. Only public posts, reels, and stories are supported.";
  }

  if (
    platform === "youtube" &&
    /sign in|not a bot|confirm you.re not a bot|login_required/i.test(message)
  ) {
    return "YouTube isn't allowing this download right now. Try again later.";
  }

  if (platform === "youtube" && /PO Token|bgutil|4416/i.test(message)) {
    return "YouTube downloads aren't set up on the server yet. Ask the bot owner.";
  }

  return "Couldn't analyze this link. Check the URL and try again.";
}

function formatTimeRangeError(): string {
  return "That time range isn't valid for this video. Try a different start and end.";
}

function formatDownloadError(): string {
  return "Download failed. Please try again.";
}

async function replyFailure(
  status: TelegramStatus,
  message: string
): Promise<void> {
  await status.clearKeyboard();
  await status.set(message, true);
}

/**
 * Phase 2: runs only after the user picks a quality.
 * Downloads media, then uploads to Telegram.
 */
async function processSelectedQuality(
  chatId: number,
  url: string,
  videoInfo: VideoInfo,
  quality: QualityOption,
  requesterUserId: number,
  username: string | undefined,
  replyToMessageId: number,
  status: TelegramStatus,
  timeRange?: TimeRange,
  requestId?: string
): Promise<void> {
  const sourceLabel = getPlatformConfig(videoInfo.platform).sourceLabel;
  const logCtx = buildLogContext({
    userId: requesterUserId,
    chatId,
    replyToMessageId,
    statusMessageId: status.getMessageId(),
    username,
    platform: videoInfo.platform,
    url,
    requestId,
  });

  logDownloadSelected(logCtx, {
    quality: quality.label,
    subtitle: quality.subtitle,
    audioOnly: quality.audioOnly,
    mediaKind: quality.mediaKind,
    clip: timeRange ? `${timeRange.startLabel}-${timeRange.endLabel}` : undefined,
  });

  const signal = beginDownload(chatId);
  let tempDir: string | undefined;

  try {
    tempDir = await createTempDownloadDir();

    const filepath = await downloadVideo({
      url,
      outputDir: tempDir,
      quality,
      platform: videoInfo.platform,
      timeRange,
      signal,
      logContext: logCtx,
      onProgress: (progress) => {
        if (progress.phase === "merge") {
          logDownloadPhase("merging", logCtx, progress.detail);
        } else if (progress.phase === "extract") {
          logDownloadPhase("extracting", logCtx, progress.detail);
        } else {
          logDownloadProgress(progress.percent ?? 0, logCtx);
        }

        void status.updateProgressLine(
          formatDownloadProgressLine(progress, {
            isClip: Boolean(timeRange),
            sourceLabel,
          })
        );
      },
    });

    if (isAborted(signal)) {
      logInfo("download cancelled", logCtx);
      await replyFailure(status, "Cancelled.");
      return;
    }

    const fileStat = await stat(filepath);
    logInfo("file ready for upload", logCtx, { sizeBytes: fileStat.size, size: formatBytes(fileStat.size) });

    if (fileStat.size > TELEGRAM_MAX_FILE_BYTES) {
      await status.set(
        [
          status.getBaseCaption(),
          "",
          "Downloaded, but this file is too large to send here.",
          "Try a lower quality.",
        ].join("\n"),
        true
      );
      return;
    }

    await status.updateProgressLine(formatUploadProgressLine(0));

    const onUploadProgress = (percent: number) => {
      logTelegramUploadProgress(percent, logCtx);
      void status.updateProgressLine(formatUploadProgressLine(percent));
    };

    const resultCaption = formatResultCaption(videoInfo, {
      quality,
      timeRange,
      sourceUrl: url,
    });

    if (quality.mediaKind === "image") {
      await sendPhotoWithProgress(
        chatId,
        filepath,
        fileStat.size,
        replyToMessageId,
        resultCaption,
        onUploadProgress,
        logCtx
      );
    } else if (quality.audioOnly) {
      await sendAudioWithProgress(
        chatId,
        filepath,
        fileStat.size,
        replyToMessageId,
        resultCaption,
        onUploadProgress,
        logCtx
      );
    } else {
      await sendVideoWithProgress(
        chatId,
        filepath,
        fileStat.size,
        replyToMessageId,
        resultCaption,
        onUploadProgress,
        logCtx
      );
    }

    await notifyAdminsOfUserDownload({
      requesterUserId,
      requesterUsername: username,
      filepath,
      fileSize: fileStat.size,
      quality,
      resultCaption,
      logContext: logCtx,
    });

    logInfo("request complete", logCtx);
    await status.delete();
  } catch (error) {
    if (isAborted(signal)) {
      logInfo("download cancelled", logCtx);
      await replyFailure(status, "Cancelled.");
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    logError("download failed", logCtx, { error: message });
    await replyFailure(status, formatDownloadError());
  } finally {
    finishDownload(chatId, signal);

    if (tempDir) {
      await removeTempDownloadDir(tempDir);
    }
  }
}

type AnalysisInput = {
  url: string;
  normalizedUrl: string;
  platform: MediaPlatform;
  instagramType?: InstagramContentType;
  audioOnly: boolean;
  replyToMessageId: number;
  requesterUserId: number;
  timeRange?: TimeRange;
};

/**
 * Phase 1: analyze metadata and show quality choices.
 * No media is downloaded during this step.
 */
async function analyzeAndPresentQualities(
  chatId: number,
  input: AnalysisInput,
  username?: string
): Promise<void> {
  const {
    normalizedUrl,
    platform,
    instagramType,
    audioOnly,
    replyToMessageId,
    timeRange,
  } = input;
  cancelDownload(chatId);
  const logCtx = logContextFromAnalysis(chatId, input, username);
  logAnalyzeStart(logCtx);

  let analyzingStatus: TelegramStatus | undefined;

  try {
    const analyzingCaptionParts = [
      formatAnalyzingCaption(platform, instagramType),
    ];

    if (timeRange) {
      analyzingCaptionParts.push("", formatSplitSummary(timeRange));
    }

    analyzingStatus = await TelegramStatus.create(
      bot.telegram,
      chatId,
      undefined,
      analyzingCaptionParts.join("\n"),
      undefined,
      replyToMessageId
    );

    const analysis = await analyzeVideo(normalizedUrl);
    const { info, formats } = analysis;

    if (timeRange) {
      validateTimeRange(timeRange, info.duration);
    }

    logAnalyzeComplete(info.title, formats.length, logCtx);
    logVideoInfo(
      info.title,
      info.uploader,
      formatDuration(info.duration),
      formatViewCount(info.viewCount),
      info.thumbnail,
      logCtx,
      info.description ? truncateText(info.description, 160) : undefined
    );

    const options = buildQualityOptions(
      formats,
      info.duration,
      audioOnly ? "audio" : "video",
      TELEGRAM_MAX_FILE_BYTES,
      timeRange?.durationSeconds,
      info.platform,
      info.mediaKind
    );

    if (options.length === 0) {
      const emptyMessage =
        audioOnly && info.platform === "instagram" && info.mediaKind === "image"
          ? "This Instagram post is a photo only — no audio is available."
          : "No downloadable formats were found for this link.";
      await analyzingStatus.set(emptyMessage, true);
      return;
    }

    const pending = reservePendingRequest({
      chatId,
      replyToMessageId,
      requesterUserId: input.requesterUserId,
      url: analysis.mediaUrl,
      username,
      videoInfo: info,
      options,
      timeRange,
    });

    await analyzingStatus.delete();

    const pickerStatus = await TelegramStatus.create(
      bot.telegram,
      chatId,
      info.thumbnail,
      formatQualityPickerCaption(info, options, timeRange),
      buildQualityKeyboard(pending),
      replyToMessageId
    );

    attachPendingMessage(pending.id, pickerStatus.getMessageId());

    logQualityOptions(
      options.map((option) => ({
        label: option.label,
        subtitle: option.subtitle,
        warning: option.exceedsTelegramLimit,
      })),
      logContextFromAnalysis(
        chatId,
        input,
        username,
        pickerStatus.getMessageId(),
        pending.id
      )
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError("analyze failed", logContextFromAnalysis(chatId, input, username), {
      error: errorMessage,
    });

    const message = formatAnalyzeError(error, platform);

    if (analyzingStatus) {
      await analyzingStatus.set(message, true);
      return;
    }

    await bot.telegram.sendMessage(chatId, message, {
      reply_parameters: { message_id: replyToMessageId },
    });
  }
}

function queueAnalysis(
  chatId: number,
  input: AnalysisInput,
  username?: string
): void {
  void analyzeAndPresentQualities(chatId, input, username);
}

function requireRequesterId(fromId: number | undefined): number | null {
  if (!fromId) {
    return null;
  }

  return fromId;
}

async function handleAnalysisCommand(
  ctx: ReplyContext,
  parse: (text: string) => ParsedUserRequest | null,
  helpText?: string
): Promise<void> {
  try {
    const parsed = parse(ctx.message.text);
    if (!parsed) {
      if (helpText) {
        await replyToUser(ctx, helpText);
      }
      return;
    }

    const requesterUserId = requireRequesterId(ctx.from?.id);
    if (!requesterUserId) {
      return;
    }

    queueAnalysis(
      ctx.chat.id,
      {
        url: parsed.url,
        normalizedUrl: parsed.normalizedUrl,
        platform: parsed.platform,
        instagramType: parsed.instagramType,
        audioOnly: parsed.audioOnly,
        replyToMessageId: ctx.message.message_id,
        requesterUserId,
        timeRange: parsed.timeRange,
      },
      ctx.from?.username
    );
  } catch {
    await replyToUser(ctx, formatTimeRangeError());
  }
}

const WELCOME_MESSAGE = [
  "👋 Welcome!",
  "",
  "I'm a media downloader for YouTube and Instagram — send me a link and I'll bring the video, photo, reel, story, or audio to you here in chat.",
  "",
  "Supported links:",
  "• YouTube videos and Shorts",
  "• Instagram posts, reels, and stories",
  "",
  "How to use:",
  "1. Send a link",
  "2. Pick a quality",
  "3. I'll download and send it back to you",
  "",
  "Nothing downloads until you choose a quality.",
  "",
  "Extras:",
  "• YouTube clip — add a time range: https://youtu.be/... 0:10-0:12",
  "• Audio — /audio <link>",
  "• YouTube clip — /split <link> 0:10 0:12",
  "",
  "Only public Instagram content is supported.",
  "",
  "For personal use. Please respect creators and copyright.",
].join("\n");

const SPLIT_HELP = [
  "Send a YouTube link with a time range:",
  "",
  "https://youtu.be/... 0:10-0:12",
  "https://youtu.be/... 00:00:10 to 00:00:12",
  "",
  "Or use:",
  "/split <url> <start> <end>",
  "",
  "Example:",
  "/split https://youtu.be/abc 0:10 0:12",
].join("\n");

function parseCommandName(text: string): string {
  return text.trim().split(/\s+/)[0].replace(/^\/+/, "").split("@")[0].toLowerCase();
}

function formatUnrecognizedInput(isAdmin: boolean): string {
  const lines = [
    "I didn't recognize that.",
    "",
    "Send a YouTube or Instagram link, for example:",
    "• https://youtu.be/...",
    "• https://www.instagram.com/reel/...",
    "",
    "Commands:",
    "/audio <link> — audio only",
    "/split <youtube-link> <start> <end> — YouTube clip",
    "/start — full help",
  ];

  if (isAdmin) {
    lines.push("/adminhelp — manage users");
  }

  return lines.join("\n");
}

bot.start((ctx) => {
  const logCtx = logContextFromCtx(ctx);
  logInfo("user started bot", logCtx);
  const access = ctx.state.userAccess as UserAccess | undefined;
  const lines = [WELCOME_MESSAGE];

  if (access?.isAdmin) {
    lines.push("", "🛡 You are an admin.", "", ADMIN_COMMANDS_HELP);
  }

  void replyToUser(ctx, lines.join("\n"));
});

bot.command("whoami", (ctx) => {
  const access = ctx.state.userAccess as UserAccess | undefined;

  if (access?.isAdmin) {
    void replyToUser(
      ctx,
      [
        `Your Telegram user ID: ${ctx.from?.id ?? "unknown"}`,
        "Role: admin",
        "",
        ADMIN_COMMANDS_HELP,
      ].join("\n")
    );
    return;
  }

  void replyToUser(ctx, "You're set up to use this bot.");
});

registerAdminCommands(bot);

bot.command("audio", (ctx) => {
  void handleAnalysisCommand(
    ctx,
    parseAudioRequest,
    "Send a YouTube or Instagram link after /audio."
  );
});

bot.command("split", (ctx) => {
  void handleAnalysisCommand(ctx, parseSplitRequest, SPLIT_HELP);
});

bot.on("text", (ctx) => {
  const text = ctx.message.text;
  const isAdmin = Boolean((ctx.state.userAccess as UserAccess | undefined)?.isAdmin);

  if (text.startsWith("/")) {
    const command = parseCommandName(text);
    if (ADMIN_COMMAND_NAMES.has(command) || USER_COMMAND_NAMES.has(command)) {
      return;
    }

    void replyToUser(ctx, formatUnrecognizedInput(isAdmin));
    return;
  }

  try {
    const parsed = parseUserRequest(text, false);
    if (!parsed) {
      void replyToUser(ctx, formatUnrecognizedInput(isAdmin));
      return;
    }

    const requesterUserId = requireRequesterId(ctx.from?.id);
    if (!requesterUserId) {
      return;
    }

    queueAnalysis(
      ctx.chat.id,
      {
        url: parsed.url,
        normalizedUrl: parsed.normalizedUrl,
        platform: parsed.platform,
        instagramType: parsed.instagramType,
        audioOnly: false,
        replyToMessageId: ctx.message.message_id,
        requesterUserId,
        timeRange: parsed.timeRange,
      },
      ctx.from?.username
    );
  } catch {
    void replyToUser(ctx, formatTimeRangeError());
  }
});

bot.on("callback_query", async (ctx) => {
  const callback = ctx.callbackQuery;
  if (!("data" in callback) || !callback.data) {
    return;
  }

  const parsed = parseCallbackData(callback.data);
  if (!parsed) {
    return;
  }

  const request = getPendingRequest(parsed.requestId);
  if (!request || !ctx.chat || request.chatId !== ctx.chat.id) {
    await ctx.answerCbQuery("This selection expired. Send the link again.", {
      show_alert: true,
    });
    return;
  }

  const choice = resolveQualityChoice(request, parsed.action);
  if (!choice) {
    await ctx.answerCbQuery("Unknown quality option.", { show_alert: true });
    return;
  }

  if (choice === "cancel") {
    const status = TelegramStatus.fromExisting(
      bot.telegram,
      request.chatId,
      request.messageId,
      Boolean(request.videoInfo.thumbnail)
    );
    await ctx.answerCbQuery("Cancelled");
    await status.clearKeyboard();
    await status.set(formatQualityCancelledCaption(request.videoInfo), true);
    deletePendingRequest(request.id);
    return;
  }

  const baseCaption = formatProcessingBaseCaption(
    request.videoInfo,
    request.options,
    choice,
    request.timeRange
  );

  const status = TelegramStatus.fromExisting(
    bot.telegram,
    request.chatId,
    request.messageId,
    Boolean(request.videoInfo.thumbnail),
    baseCaption
  );

  if (choice.exceedsTelegramLimit) {
    await ctx.answerCbQuery(
      "This quality may be too large to send. Continuing anyway.",
      { show_alert: true }
    );
  } else {
    await ctx.answerCbQuery(`Selected ${choice.label}`);
  }

  await status.clearKeyboard();
  await status.setBaseCaption(baseCaption);
  await status.updateProgressLine(
    formatPreparingProgressLine({
      isClip: Boolean(request.timeRange),
      sourceLabel: getPlatformConfig(request.videoInfo.platform).sourceLabel,
    })
  );
  deletePendingRequest(request.id);

  void processSelectedQuality(
    request.chatId,
    request.url,
    request.videoInfo,
    choice,
    request.requesterUserId,
    request.username,
    request.replyToMessageId,
    status,
    request.timeRange,
    request.id
  );
});

bot.catch((error, ctx) => {
  const message = error instanceof Error ? error.message : String(error);
  logError("unhandled bot error", logContextFromCtx(ctx), { error: message });
});

if (!config.telegramBotToken) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env and add your bot token.");
  process.exit(1);
}

async function startBot(): Promise<void> {
  await initLogger();
  await cleanupStaleDownloads();

  const accessCounts = await validateAccessListFile();
  logInfo("access list loaded", undefined, {
    summary: formatAccessSummary(accessCounts),
    file: config.accessListFile,
  });

  if (accessCounts.adminCount === 0) {
    logWarn(
      "access list has no admins — edit users.json or use /adminadd after adding your ID manually"
    );
  }

  if (await isPotServerReachable()) {
    logInfo("YouTube POT server reachable", undefined, {
      url: config.youtubePotServerUrl,
    });
  } else {
    logWarn(
      "YouTube POT server not reachable — run npm run setup:youtube && npm run pot:start (or npm run deploy)",
      undefined,
      { url: config.youtubePotServerUrl }
    );
  }

  const stopCleanupScheduler = startDownloadCleanupScheduler();
  await bot.launch();
  logInfo("Telegram bot is running");

  const shutdown = () => {
    stopCleanupScheduler();
    void bot.stop("shutdown");
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

startBot().catch((error) => {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
