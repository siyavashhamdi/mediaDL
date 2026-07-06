import { randomBytes } from "node:crypto";
import type { QualityOption } from "./formats";
import type { TimeRange } from "./time-range";
import type { VideoInfo } from "./video-info";

const REQUEST_TTL_MS = 30 * 60 * 1000;

export type PendingRequest = {
  id: string;
  chatId: number;
  messageId: number;
  replyToMessageId: number;
  requesterUserId: number;
  url: string;
  username?: string;
  videoInfo: VideoInfo;
  options: QualityOption[];
  timeRange?: TimeRange;
  createdAt: number;
};

const requestsById = new Map<string, PendingRequest>();
const requestIdByChat = new Map<number, string>();

function createRequestId(): string {
  return randomBytes(4).toString("hex");
}

export function reservePendingRequest(input: {
  chatId: number;
  replyToMessageId: number;
  requesterUserId: number;
  url: string;
  username?: string;
  videoInfo: VideoInfo;
  options: QualityOption[];
  timeRange?: TimeRange;
}): PendingRequest {
  const existingId = requestIdByChat.get(input.chatId);
  if (existingId) {
    requestsById.delete(existingId);
  }

  const request: PendingRequest = {
    id: createRequestId(),
    chatId: input.chatId,
    messageId: 0,
    replyToMessageId: input.replyToMessageId,
    requesterUserId: input.requesterUserId,
    url: input.url,
    username: input.username,
    videoInfo: input.videoInfo,
    options: input.options,
    timeRange: input.timeRange,
    createdAt: Date.now(),
  };

  requestsById.set(request.id, request);
  requestIdByChat.set(input.chatId, request.id);
  return request;
}

export function attachPendingMessage(
  requestId: string,
  messageId: number
): void {
  const request = requestsById.get(requestId);
  if (request) {
    request.messageId = messageId;
  }
}

export function createPendingRequest(input: {
  chatId: number;
  messageId: number;
  replyToMessageId: number;
  requesterUserId: number;
  url: string;
  username?: string;
  videoInfo: VideoInfo;
  options: QualityOption[];
  timeRange?: TimeRange;
}): PendingRequest {
  return reservePendingRequest(input);
}

export function getPendingRequest(requestId: string): PendingRequest | undefined {
  const request = requestsById.get(requestId);
  if (!request) {
    return undefined;
  }

  if (Date.now() - request.createdAt > REQUEST_TTL_MS) {
    deletePendingRequest(requestId);
    return undefined;
  }

  return request;
}

export function deletePendingRequest(requestId: string): void {
  const request = requestsById.get(requestId);
  if (!request) {
    return;
  }

  requestsById.delete(requestId);
  if (requestIdByChat.get(request.chatId) === requestId) {
    requestIdByChat.delete(request.chatId);
  }
}

export function buildCallbackData(
  requestId: string,
  action: string
): string {
  return `dl:${requestId}:${action}`;
}

export function parseCallbackData(
  data: string
): { requestId: string; action: string } | undefined {
  if (!data.startsWith("dl:")) {
    return undefined;
  }

  const [, requestId, action] = data.split(":");
  if (!requestId || !action) {
    return undefined;
  }

  return { requestId, action };
}
