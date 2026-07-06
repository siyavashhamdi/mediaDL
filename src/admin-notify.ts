import {
  findAccessEntry,
  getAdminChatIds,
  getUserAccess,
} from "./access-control";
import type { QualityOption } from "./formats";
import type { LogContext } from "./logger";
import { logError, logInfo } from "./logger";
import { formatAdminNotifyCaption } from "./quality-picker";
import { sendMediaCopy } from "./telegram-upload";

function resolveSendMethod(
  quality: QualityOption
): "sendVideo" | "sendAudio" | "sendPhoto" {
  if (quality.mediaKind === "image") {
    return "sendPhoto";
  }

  if (quality.audioOnly) {
    return "sendAudio";
  }

  return "sendVideo";
}

export async function notifyAdminsOfUserDownload(input: {
  requesterUserId: number;
  requesterUsername?: string;
  filepath: string;
  fileSize: number;
  quality: QualityOption;
  resultCaption: string;
  logContext?: LogContext;
}): Promise<void> {
  const access = await getUserAccess(input.requesterUserId);
  if (access.isAdmin) {
    return;
  }

  const adminIds = await getAdminChatIds();
  if (adminIds.length === 0) {
    return;
  }

  const profile = await findAccessEntry(input.requesterUserId);
  const adminCaption = formatAdminNotifyCaption({
    userId: input.requesterUserId,
    username: input.requesterUsername,
    userNote: profile?.note,
    resultCaption: input.resultCaption,
  });
  const method = resolveSendMethod(input.quality);

  for (const adminId of adminIds) {
    try {
      await sendMediaCopy(
        method,
        adminId,
        input.filepath,
        input.fileSize,
        adminCaption
      );
      logInfo("admin notify sent", input.logContext, { adminId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("admin notify failed", input.logContext, { adminId, error: message });
    }
  }
}
