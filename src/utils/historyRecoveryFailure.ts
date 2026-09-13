// Recognize only our explicit terminal recovery contract. Do not interpret an
// arbitrary server/provider error as evidence that a file was committed.
export function terminalHistoryRecoveryFailure(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (result.success !== false || result.retryable !== false || result.stopBatch !== true) return null;
  if (result.code === 'HISTORY_RECOVERY_COMMIT_UNCONFIRMED' && result.committed === true) {
    return '部分数据已提交，但保存确认失败。本批找回已暂停，请先查看历史记录，不要重复找回或删除数据。重启客户端后如有恢复提示，请按提示处理。';
  }
  if (result.code === 'HISTORY_RECOVERY_WRITES_STOPPED') {
    return '数据库已暂停写入，本批找回已停止。请先查看历史记录；重启客户端后如有恢复提示，请按提示处理，不要删除数据。';
  }
  return null;
}

export class HistoryRecoveryStoppedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryRecoveryStoppedError';
  }
}

// Use the same explicit contract for individual reference recovery and batches.
// Never infer that a timed-out/ordinary failed upload committed successfully.
export function assertHistoryRecoveryMayContinue(value: unknown): void {
  const message = terminalHistoryRecoveryFailure(value);
  if (message) throw new HistoryRecoveryStoppedError(message);
}
