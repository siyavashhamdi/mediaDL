import { createReadStream } from "node:fs";
import path from "node:path";
import axios from "axios";
import FormData from "form-data";
import { config } from "./config";
import {
  logTelegramComplete,
  logTelegramUploadProgress,
  type LogContext,
} from "./logger";

type UploadProgressHandler = (
  percent: number,
  uploadedBytes: number,
  totalBytes: number
) => void;

const API_ROOT = "https://api.telegram.org";

async function uploadMedia(
  method: "sendVideo" | "sendAudio" | "sendPhoto",
  chatId: number,
  filepath: string,
  fileSize: number,
  replyToMessageId?: number,
  caption?: string,
  onProgress?: UploadProgressHandler,
  logContext?: LogContext
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));

  if (replyToMessageId) {
    form.append("reply_to_message_id", String(replyToMessageId));
  }

  if (caption) {
    form.append("caption", caption);
  }

  const fieldName =
    method === "sendVideo" ? "video" : method === "sendAudio" ? "audio" : "photo";
  form.append(fieldName, createReadStream(filepath), {
    filename: path.basename(filepath),
    knownLength: fileSize,
  });

  let lastLoggedPercent = -1;

  await axios.post(`${API_ROOT}/bot${config.telegramBotToken}/${method}`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    onUploadProgress: (event) => {
      const total = event.total ?? fileSize;
      const loaded = event.loaded;
      const percent = total > 0 ? (loaded / total) * 100 : 0;

      if (percent >= lastLoggedPercent + 0.5 || loaded >= total) {
        lastLoggedPercent = Math.floor(percent);
        logTelegramUploadProgress(percent, logContext);
        onProgress?.(percent, loaded, total);
      }
    },
  });
}

export async function sendVideoWithProgress(
  chatId: number,
  filepath: string,
  fileSize: number,
  replyToMessageId?: number,
  caption?: string,
  onProgress?: UploadProgressHandler,
  logContext?: LogContext
): Promise<void> {
  await uploadMedia(
    "sendVideo",
    chatId,
    filepath,
    fileSize,
    replyToMessageId,
    caption,
    onProgress,
    logContext
  );
  logTelegramComplete("video", logContext, { chatId, fileSize });
}

export async function sendAudioWithProgress(
  chatId: number,
  filepath: string,
  fileSize: number,
  replyToMessageId?: number,
  caption?: string,
  onProgress?: UploadProgressHandler,
  logContext?: LogContext
): Promise<void> {
  await uploadMedia(
    "sendAudio",
    chatId,
    filepath,
    fileSize,
    replyToMessageId,
    caption,
    onProgress,
    logContext
  );
  logTelegramComplete("audio", logContext, { chatId, fileSize });
}

export async function sendPhotoWithProgress(
  chatId: number,
  filepath: string,
  fileSize: number,
  replyToMessageId?: number,
  caption?: string,
  onProgress?: UploadProgressHandler,
  logContext?: LogContext
): Promise<void> {
  await uploadMedia(
    "sendPhoto",
    chatId,
    filepath,
    fileSize,
    replyToMessageId,
    caption,
    onProgress,
    logContext
  );
  logTelegramComplete("photo", logContext, { chatId, fileSize });
}

export async function sendMediaCopy(
  method: "sendVideo" | "sendAudio" | "sendPhoto",
  chatId: number,
  filepath: string,
  fileSize: number,
  caption?: string,
  logContext?: LogContext
): Promise<void> {
  await uploadMedia(
    method,
    chatId,
    filepath,
    fileSize,
    undefined,
    caption,
    undefined,
    logContext
  );
  logTelegramComplete(method === "sendVideo" ? "video" : method === "sendAudio" ? "audio" : "photo", logContext, {
    chatId,
    fileSize,
    copy: true,
  });
}
