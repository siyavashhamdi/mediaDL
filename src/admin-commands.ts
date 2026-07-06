import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { Input, type Context, type Telegraf } from "telegraf";
import {
  addAccessAdmin,
  addAccessUser,
  ADMIN_COMMANDS_HELP,
  formatAccessListMessage,
  getAccessListDetails,
  removeAccessAdmin,
  removeAccessUser,
  type UserAccess,
} from "./access-control";
import { TELEGRAM_MAX_FILE_BYTES } from "./config";
import { getDailyLogFilePath, resolveLogDateArg } from "./logger";

function isAdmin(ctx: Context): boolean {
  const access = ctx.state.userAccess as UserAccess | undefined;
  return Boolean(access?.isAdmin);
}

function getMessageText(ctx: Context): string | undefined {
  const message = ctx.message;
  if (!message || !("text" in message) || !message.text) {
    return undefined;
  }

  return message.text;
}

function parseTargetId(args: string[]): number | null {
  const raw = args[0];
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

async function replyToCommand(ctx: Context, text: string): Promise<void> {
  const message = ctx.message;
  if (!message || !("message_id" in message)) {
    return;
  }

  await ctx.reply(text, {
    reply_parameters: { message_id: message.message_id },
  });
}

async function requireAdmin(ctx: Context): Promise<boolean> {
  return isAdmin(ctx);
}

export function registerAdminCommands(bot: Telegraf): void {
  bot.command("adminhelp", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    await replyToCommand(ctx, ADMIN_COMMANDS_HELP);
  });

  bot.command("list", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const details = await getAccessListDetails();
    await replyToCommand(ctx, formatAccessListMessage(details));
  });

  bot.command("logs", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const text = getMessageText(ctx);
    if (!text) {
      return;
    }

    const args = text.trim().split(/\s+/).slice(1);
    const date = resolveLogDateArg(args[0]);
    if (!date) {
      await replyToCommand(
        ctx,
        [
          "Usage: /logs <YYYY-MM-DD|today>",
          "",
          "Examples:",
          "/logs today",
          "/logs 2026-07-06",
        ].join("\n")
      );
      return;
    }

    const logPath = getDailyLogFilePath(date);

    try {
      await access(logPath, constants.R_OK);
    } catch {
      await replyToCommand(ctx, `No log file found for ${date}.`);
      return;
    }

    const fileStat = await stat(logPath);
    if (fileStat.size > TELEGRAM_MAX_FILE_BYTES) {
      await replyToCommand(
        ctx,
        `Log file for ${date} is ${formatBytes(fileStat.size)}. Telegram bots can only send files up to 50 MB.`
      );
      return;
    }

    if (fileStat.size === 0) {
      await replyToCommand(ctx, `Log file for ${date} is empty.`);
      return;
    }

    const message = ctx.message;
    await ctx.replyWithDocument(Input.fromLocalFile(logPath, `${date}.log`), {
      caption: `Log file for ${date}`,
      reply_parameters:
        message && "message_id" in message
          ? { message_id: message.message_id }
          : undefined,
    });
  });

  bot.command("useradd", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const text = getMessageText(ctx);
    if (!text) {
      return;
    }

    const args = text.trim().split(/\s+/).slice(1);
    const id = parseTargetId(args);
    if (id === null) {
      await replyToCommand(ctx, "Usage: /useradd <telegram-id> [note]");
      return;
    }

    const note = args.slice(1).join(" ").trim() || undefined;
    const result = await addAccessUser(id, note);

    if (result === "exists") {
      await replyToCommand(ctx, `User ${id} is already in the list.`);
      return;
    }

    await replyToCommand(ctx, `Added user ${id}${note ? ` (${note})` : ""}.`);
  });

  bot.command("userremove", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const text = getMessageText(ctx);
    if (!text) {
      return;
    }

    const id = parseTargetId(text.trim().split(/\s+/).slice(1));
    if (id === null) {
      await replyToCommand(ctx, "Usage: /userremove <telegram-id>");
      return;
    }

    const result = await removeAccessUser(id);
    if (result === "missing") {
      await replyToCommand(ctx, `User ${id} is not in the list.`);
      return;
    }

    await replyToCommand(ctx, `Removed user ${id}.`);
  });

  bot.command("adminadd", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const text = getMessageText(ctx);
    if (!text) {
      return;
    }

    const args = text.trim().split(/\s+/).slice(1);
    const id = parseTargetId(args);
    if (id === null) {
      await replyToCommand(ctx, "Usage: /adminadd <telegram-id> [note]");
      return;
    }

    const note = args.slice(1).join(" ").trim() || undefined;
    const result = await addAccessAdmin(id, note);

    if (result === "exists") {
      await replyToCommand(ctx, `Admin ${id} is already in the list.`);
      return;
    }

    await replyToCommand(ctx, `Added admin ${id}${note ? ` (${note})` : ""}.`);
  });

  bot.command("adminremove", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const text = getMessageText(ctx);
    if (!text) {
      return;
    }

    const id = parseTargetId(text.trim().split(/\s+/).slice(1));
    if (id === null) {
      await replyToCommand(ctx, "Usage: /adminremove <telegram-id>");
      return;
    }

    const result = await removeAccessAdmin(id);
    if (result === "missing") {
      await replyToCommand(ctx, `Admin ${id} is not in the list.`);
      return;
    }

    if (result === "last_admin") {
      await replyToCommand(ctx, "Cannot remove the last admin.");
      return;
    }

    await replyToCommand(ctx, `Removed admin ${id}.`);
  });
}
