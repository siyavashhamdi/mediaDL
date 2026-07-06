const activeDownloads = new Map<number, AbortController>();

export function beginDownload(chatId: number): AbortSignal {
  cancelDownload(chatId);

  const controller = new AbortController();
  activeDownloads.set(chatId, controller);
  return controller.signal;
}

export function cancelDownload(chatId: number): void {
  activeDownloads.get(chatId)?.abort();
  activeDownloads.delete(chatId);
}

export function cancelAllDownloads(): void {
  for (const controller of activeDownloads.values()) {
    controller.abort();
  }
  activeDownloads.clear();
}

export function finishDownload(chatId: number, signal: AbortSignal): void {
  if (activeDownloads.get(chatId)?.signal === signal) {
    activeDownloads.delete(chatId);
  }
}

export function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
