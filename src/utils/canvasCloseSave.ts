export type CanvasCloseResult = { ok: boolean; reason?: 'running' | 'conflict' | 'save' };

// Observe the existing CAS queue; never introduce a second write path or treat
// a drained (error-swallowing) queue as proof that the current graph was saved.
export async function waitForCanvasCloseSave(options: {
  read: () => { dirty: boolean; queued: boolean; blocked?: 'running' | 'conflict' };
  flush: () => void;
  cancelled: () => boolean;
  turn?: () => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<CanvasCloseResult> {
  const now = options.now || Date.now;
  const turn = options.turn || (() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  const deadline = now() + (options.timeoutMs ?? 8_000);
  let cleanTurns = 0;
  let lastFlushAt = -Infinity;
  // Let blur handlers and React effects publish their final draft first.
  await turn();
  while (!options.cancelled() && now() < deadline) {
    const state = options.read();
    if (state.blocked) return { ok: false, reason: state.blocked };
    if (!state.dirty && !state.queued) {
      if (++cleanTurns >= 2) return { ok: true };
    } else {
      cleanTurns = 0;
      // Observe frequently, but do not accelerate failed-save retries beyond
      // the existing 800ms autosave cadence.
      if (now() - lastFlushAt >= 800) {
        lastFlushAt = now();
        options.flush();
      }
    }
    await turn();
  }
  return { ok: false, reason: 'save' };
}
