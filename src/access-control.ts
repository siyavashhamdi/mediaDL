import { readFile, rename, writeFile } from "node:fs/promises";
import { config } from "./config";

export type UserAccess = {
  allowed: boolean;
  isAdmin: boolean;
};

export type AccessEntry = {
  id: number;
  note?: string;
};

type UserEntry = number | string | { id: number | string; note?: string };

type AccessListFile = {
  users?: UserEntry[];
  admins?: UserEntry[];
};

function parseUserId(entry: UserEntry): number | null {
  if (typeof entry === "number") {
    return Number.isInteger(entry) ? entry : null;
  }

  if (typeof entry === "string") {
    const parsed = Number(entry.trim());
    return Number.isInteger(parsed) ? parsed : null;
  }

  const rawId = entry.id;
  const parsed = typeof rawId === "string" ? Number(rawId.trim()) : rawId;
  return Number.isInteger(parsed) ? parsed : null;
}

function parseIdList(entries: UserEntry[] | undefined): Set<number> {
  const ids = new Set<number>();

  for (const entry of entries ?? []) {
    const id = parseUserId(entry);
    if (id !== null) {
      ids.add(id);
    }
  }

  return ids;
}

function toStoredEntry(entry: AccessEntry): { id: number; note?: string } {
  if (entry.note?.trim()) {
    return { id: entry.id, note: entry.note.trim() };
  }

  return { id: entry.id };
}

function normalizeEntries(entries: UserEntry[] | undefined): AccessEntry[] {
  const result: AccessEntry[] = [];
  const seen = new Set<number>();

  for (const entry of entries ?? []) {
    const id = parseUserId(entry);
    if (id === null || seen.has(id)) {
      continue;
    }

    seen.add(id);
    const note =
      typeof entry === "object" && entry !== null && "note" in entry
        ? entry.note?.trim() || undefined
        : undefined;

    result.push({ id, note });
  }

  return result;
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

const EMPTY_ACCESS_LIST: AccessListFile = {
  admins: [],
  users: [],
};

async function createDefaultAccessListFile(): Promise<void> {
  const content = `${JSON.stringify(EMPTY_ACCESS_LIST, null, 2)}\n`;
  await writeFile(config.accessListFile, content, "utf8");
}

async function readAccessListFile(): Promise<AccessListFile> {
  let raw: string;

  try {
    raw = await readFile(config.accessListFile, "utf8");
  } catch (error) {
    if (isENOENT(error)) {
      await createDefaultAccessListFile();
      return { ...EMPTY_ACCESS_LIST };
    }
    throw error;
  }

  const data = JSON.parse(raw) as AccessListFile;

  if (!data || typeof data !== "object") {
    throw new Error("Access list must be a JSON object.");
  }

  return data;
}

async function saveAccessListFile(data: AccessListFile): Promise<void> {
  const admins = normalizeEntries(data.admins).map(toStoredEntry);
  const users = normalizeEntries(data.users).map(toStoredEntry);

  if (admins.length === 0) {
    throw new Error("At least one admin is required.");
  }

  const normalized: AccessListFile = { admins, users };

  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const tempFile = `${config.accessListFile}.tmp`;

  await writeFile(tempFile, content, "utf8");
  await rename(tempFile, config.accessListFile);
}

/**
 * Reads users.json from disk on every call so edits take effect immediately.
 */
export async function loadAccessList(): Promise<{
  users: Set<number>;
  admins: Set<number>;
}> {
  const data = await readAccessListFile();
  const admins = parseIdList(data.admins);
  const users = parseIdList(data.users);

  for (const adminId of admins) {
    users.add(adminId);
  }

  return { users, admins };
}

export async function getUserAccess(userId: number): Promise<UserAccess> {
  const { users, admins } = await loadAccessList();

  return {
    allowed: users.has(userId),
    isAdmin: admins.has(userId),
  };
}

export async function getAccessListDetails(): Promise<{
  admins: AccessEntry[];
  users: AccessEntry[];
}> {
  const data = await readAccessListFile();

  return {
    admins: normalizeEntries(data.admins),
    users: normalizeEntries(data.users),
  };
}

export function formatAccessListMessage(details: {
  admins: AccessEntry[];
  users: AccessEntry[];
}): string {
  const formatLine = (entry: AccessEntry) =>
    entry.note ? `• ${entry.id} — ${entry.note}` : `• ${entry.id}`;

  const adminLines = details.admins.map(formatLine);
  const userLines = details.users.map(formatLine);

  return [
    "🛡 Admins",
    adminLines.length > 0 ? adminLines.join("\n") : "• (none)",
    "",
    "👤 Users",
    userLines.length > 0 ? userLines.join("\n") : "• (none)",
  ].join("\n");
}

export async function findAccessEntry(
  userId: number
): Promise<{ note?: string; isAdmin: boolean } | undefined> {
  const { admins, users } = await getAccessListDetails();
  const admin = admins.find((entry) => entry.id === userId);
  if (admin) {
    return { note: admin.note, isAdmin: true };
  }

  const user = users.find((entry) => entry.id === userId);
  if (user) {
    return { note: user.note, isAdmin: false };
  }

  return undefined;
}

export async function getAdminChatIds(): Promise<number[]> {
  const { admins } = await getAccessListDetails();
  return admins.map((admin) => admin.id);
}

export async function addAccessUser(
  id: number,
  note?: string
): Promise<"added" | "exists"> {
  const data = await readAccessListFile();
  const users = normalizeEntries(data.users);

  if (users.some((entry) => entry.id === id)) {
    return "exists";
  }

  users.push({ id, note: note?.trim() || undefined });
  data.users = users.map(toStoredEntry);
  await saveAccessListFile(data);
  return "added";
}

export async function removeAccessUser(id: number): Promise<"removed" | "missing"> {
  const data = await readAccessListFile();
  const users = normalizeEntries(data.users);
  const nextUsers = users.filter((entry) => entry.id !== id);

  if (nextUsers.length === users.length) {
    return "missing";
  }

  data.users = nextUsers.map(toStoredEntry);
  await saveAccessListFile(data);
  return "removed";
}

export async function addAccessAdmin(
  id: number,
  note?: string
): Promise<"added" | "exists"> {
  const data = await readAccessListFile();
  const admins = normalizeEntries(data.admins);

  if (admins.some((entry) => entry.id === id)) {
    return "exists";
  }

  admins.push({ id, note: note?.trim() || undefined });
  data.admins = admins.map(toStoredEntry);
  await saveAccessListFile(data);
  return "added";
}

export async function removeAccessAdmin(
  id: number
): Promise<"removed" | "missing" | "last_admin"> {
  const data = await readAccessListFile();
  const admins = normalizeEntries(data.admins);

  if (!admins.some((entry) => entry.id === id)) {
    return "missing";
  }

  if (admins.length <= 1) {
    return "last_admin";
  }

  data.admins = admins.filter((entry) => entry.id !== id).map(toStoredEntry);
  await saveAccessListFile(data);
  return "removed";
}

export async function validateAccessListFile(): Promise<{
  userCount: number;
  adminCount: number;
}> {
  const { users, admins } = await loadAccessList();

  return {
    userCount: users.size,
    adminCount: admins.size,
  };
}

export function formatAccessSummary(counts: {
  userCount: number;
  adminCount: number;
}): string {
  return `${counts.userCount} allowed user(s), ${counts.adminCount} admin(s)`;
}

export const ADMIN_COMMAND_NAMES = new Set([
  "adminhelp",
  "list",
  "logs",
  "useradd",
  "userremove",
  "adminadd",
  "adminremove",
]);

export const USER_COMMAND_NAMES = new Set(["start", "whoami", "audio", "split"]);

export const ADMIN_COMMANDS_HELP = [
  "Admin commands:",
  "/list — show admins and users",
  "/logs <YYYY-MM-DD|today> — send that day's log file",
  "/useradd <id> [note] — add a user",
  "/userremove <id> — remove a user",
  "/adminadd <id> [note] — add an admin",
  "/adminremove <id> — remove an admin",
].join("\n");
