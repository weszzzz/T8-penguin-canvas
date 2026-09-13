// Frontend polling counterpart of backend/src/providers/providerTimeoutPolicy.js.
// Provider network boundaries remain authoritative on the backend; this helper
// prevents a UI or persisted recovery recipe from ending media generation early.
export const MIN_PROVIDER_MEDIA_TIMEOUT_MS = 15 * 60 * 1000;

export function minimumProviderMediaPollCount(intervalMs: number, requestedPolls?: number): number {
  const rawInterval = Number(intervalMs);
  const rawRequested = Number(requestedPolls);
  const interval = Number.isFinite(rawInterval) && rawInterval > 0 ? Math.trunc(rawInterval) : 1;
  const requested = Number.isFinite(rawRequested) && rawRequested > 0 ? Math.trunc(rawRequested) : 1;
  return Math.max(Math.ceil(MIN_PROVIDER_MEDIA_TIMEOUT_MS / interval), requested);
}
