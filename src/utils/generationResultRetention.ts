/** Preview retention is not a generation receipt. Only an executor's explicit
 * successful completion may allow the run wrapper to collect new output. */
export function assertFreshGenerationCompleted(completed: unknown): asserts completed is true {
  if (completed === true) return;
  throw Object.assign(new Error('本次未完成新的生成，上一版结果已保留；请检查节点提示后重试。'), {
    code: 'GENERATION_NOT_COMPLETED',
  });
}

export function beginVideoRegeneration(data: { videoUrl?: unknown; videoUrls?: unknown }) {
  const hasPrevious = (typeof data.videoUrl === 'string' && Boolean(data.videoUrl.trim()))
    || (Array.isArray(data.videoUrls) && data.videoUrls.some(url => typeof url === 'string' && url.trim()));
  // Deliberately do not patch the prior result or its prompt while a new task
  // is pending. A failure/stop can then leave them intact without rollback.
  return { status: 'submitting', error: null, taskId: null, showingPreviousResult: hasPrevious };
}

export function completeVideoRegeneration(values: string[], prompt: string) {
  const videoUrls = [...new Set(values.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
  if (!videoUrls.length) throw new Error('本次生成没有返回可用的视频结果');
  return { status: 'success', videoUrl: videoUrls[0], videoUrls, lastPrompt: prompt, showingPreviousResult: false };
}
