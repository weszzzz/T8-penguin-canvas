export const HISTORY_QUERY_TIMEOUT = '历史记录读取超时，请重试。';
export const HISTORY_RECOVERY_TIMEOUT = '等待找回结果超时，结果尚未确认，本批已暂停。请先查看历史记录，不要连续重复找回或删除原文件。';

export class HistoryRequestTimeoutError extends Error {
  constructor(message: string) { super(message); this.name = 'HistoryRequestTimeoutError'; }
}

/** Bound both request and response-body reads. Aborting HTTP is not proof that
 * a server-side write stopped or rolled back; callers must treat it as unknown. */
export async function withHistoryRequestDeadline<T>(milliseconds: number, parent: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>, message: string): Promise<T> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new Error('Invalid history request deadline');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      const error = new DOMException('Request cancelled', 'AbortError');
      reject(error); controller.abort(error);
    };
    if (parent?.aborted) { cancel(); return; }
    parent?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      const error = new HistoryRequestTimeoutError(message);
      reject(error); controller.abort(error);
    }, milliseconds);
  });
  try {
    // Already-cancelled requests must not start an upload or query.
    const result = controller.signal.aborted ? interrupted : Promise.resolve().then(() => {
      if (controller.signal.aborted) return interrupted;
      return operation(controller.signal);
    });
    return await Promise.race([interrupted, result]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) parent?.removeEventListener('abort', cancel);
  }
}
