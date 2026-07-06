import { Telegram } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";
import type { DownloadProgress } from "./download";

const MIN_UPDATE_MS = 1000;

export function formatDownloadProgressLine(
  progress: DownloadProgress,
  options?: { isClip?: boolean; sourceLabel?: string }
): string {
  if (progress.phase === "merge") {
    return "🔀 Merging video and audio...";
  }

  if (progress.phase === "extract") {
    return "🎵 Extracting audio...";
  }

  const percent = progress.percent ?? 0;
  const source = options?.sourceLabel ?? "source";
  const prefix = options?.isClip
    ? `⬇️ Downloading clip from ${source}`
    : `⬇️ Downloading from ${source}`;
  return `${prefix} (${percent.toFixed(1)}%)`;
}

export function formatUploadProgressLine(percent: number): string {
  return `⬆️ Uploading to Telegram (${percent.toFixed(1)}%)`;
}

export function formatPreparingProgressLine(options?: {
  isClip?: boolean;
  sourceLabel?: string;
}): string {
  if (options?.isClip) {
    return "⏳ Preparing clip download...";
  }

  const source = options?.sourceLabel ?? "source";
  return `⏳ Preparing download from ${source}...`;
}

export class TelegramStatus {
  private lastText = "";
  private lastUpdateAt = 0;
  private pendingText: string | undefined;
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly hasPhoto: boolean;
  private baseCaption = "";

  private constructor(
    private readonly telegram: Telegram,
    private readonly chatId: number,
    private readonly messageId: number,
    hasPhoto: boolean
  ) {
    this.hasPhoto = hasPhoto;
  }

  getMessageId(): number {
    return this.messageId;
  }

  getBaseCaption(): string {
    return this.baseCaption;
  }

  static fromExisting(
    telegram: Telegram,
    chatId: number,
    messageId: number,
    hasPhoto: boolean,
    baseCaption = ""
  ): TelegramStatus {
    const status = new TelegramStatus(telegram, chatId, messageId, hasPhoto);
    status.baseCaption = baseCaption;
    return status;
  }

  static async create(
    telegram: Telegram,
    chatId: number,
    thumbnail: string | undefined,
    caption: string,
    replyMarkup?: InlineKeyboardMarkup,
    replyToMessageId?: number
  ): Promise<TelegramStatus> {
    const replyOptions = replyToMessageId
      ? { reply_parameters: { message_id: replyToMessageId } }
      : {};

    if (thumbnail) {
      const message = await telegram.sendPhoto(chatId, thumbnail, {
        caption,
        reply_markup: replyMarkup,
        ...replyOptions,
      });
      const status = new TelegramStatus(
        telegram,
        chatId,
        message.message_id,
        true
      );
      status.baseCaption = caption;
      return status;
    }

    const message = await telegram.sendMessage(chatId, caption, {
      reply_markup: replyMarkup,
      ...replyOptions,
    });
    const status = new TelegramStatus(
      telegram,
      chatId,
      message.message_id,
      false
    );
    status.baseCaption = caption;
    return status;
  }

  async clearKeyboard(): Promise<void> {
    await this.telegram
      .editMessageReplyMarkup(this.chatId, this.messageId, undefined, {
        inline_keyboard: [],
      })
      .catch(() => undefined);
  }

  async setBaseCaption(caption: string, force = true): Promise<void> {
    this.baseCaption = caption;
    await this.set(caption, force);
  }

  async updateProgressLine(line: string): Promise<void> {
    if (!this.baseCaption) {
      await this.set(line);
      return;
    }

    await this.set(`${this.baseCaption}\n\n${line}`);
  }

  async set(text: string, force = false): Promise<void> {
    if (!force && text === this.lastText) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastUpdateAt < MIN_UPDATE_MS) {
      this.pendingText = text;
      this.scheduleFlush();
      return;
    }

    await this.flush(text);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    const delay = Math.max(0, MIN_UPDATE_MS - (Date.now() - this.lastUpdateAt));
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (this.pendingText) {
        void this.flush(this.pendingText);
      }
    }, delay);
  }

  private async flush(text: string): Promise<void> {
    this.pendingText = undefined;
    this.lastText = text;
    this.lastUpdateAt = Date.now();

    if (this.hasPhoto) {
      await this.telegram
        .editMessageCaption(this.chatId, this.messageId, undefined, text)
        .catch(() => undefined);
      return;
    }

    await this.telegram
      .editMessageText(this.chatId, this.messageId, undefined, text)
      .catch(() => undefined);
  }

  async delete(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    await this.telegram
      .deleteMessage(this.chatId, this.messageId)
      .catch(() => undefined);
  }
}
