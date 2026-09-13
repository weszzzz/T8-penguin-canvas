// Versioned, prefill-only frontend request inputs. This is not evidence of
// backend defaults, auto-provider selection, or the Provider's resolved seed.
import contract from '../../backend/src/shared/generationHistoryInputContract.json';
export const HISTORY_SEEDANCE_INPUT_SCHEMA = contract.seedanceResolvedInputSchema;
export function historyResolvedSeedanceInput(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = data.historyResolvedInput;
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('历史实际输入结构不完整');
  const input = value as Record<string, unknown>;
  if (input.schema !== HISTORY_SEEDANCE_INPUT_SCHEMA || input.origin !== 'frontend-request'
    || typeof input.prompt !== 'string'
    || ['duration', 'seed', 'maxPoll', 'pollInt'].some(key => typeof input[key] !== 'number' || !Number.isFinite(input[key]))
    || ['model', 'seedanceNzModel', 'seedanceApiSource', 'ratio', 'resolution', 'frameMode'].some(key => typeof input[key] !== 'string')
    || ['generateAudio', 'returnLastFrame', 'watermark', 'webSearch'].some(key => typeof input[key] !== 'boolean')
    || ['localRefImages', 'localRefVideos', 'localRefAudios'].some(key => !Array.isArray(input[key]) || (input[key] as unknown[]).some(item => typeof item !== 'string'))
    || !input.providerParams || typeof input.providerParams !== 'object' || Array.isArray(input.providerParams)) throw new Error('历史实际输入版本或字段不完整，未套用当前默认值');
  return input;
}

/** Capture the input adapter and executor from the same render synchronously.
 * Callers without an adapter keep the existing latest-callback behavior. */
export function captureHistoryExecution<T>(run: T, capture?: () => Record<string, unknown>) {
  return capture ? { run, resolvedInput: capture() } : undefined;
}
