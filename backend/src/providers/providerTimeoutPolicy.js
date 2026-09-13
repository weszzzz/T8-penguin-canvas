'use strict';

// Production contract for every current and future AI Provider/model:
// - media generation and generated-output transfer must never expire before 15 minutes;
// - LLM calls must never run longer than 3 minutes.
// Connection probes, retry delays, UI debounce, and local media tools are intentionally
// outside this policy so genuine connectivity failures still surface quickly.
const MIN_PROVIDER_MEDIA_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_PROVIDER_MEDIA_TIMEOUT_MS = MIN_PROVIDER_MEDIA_TIMEOUT_MS;
const DEFAULT_PROVIDER_LLM_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_PROVIDER_LLM_TIMEOUT_MS = DEFAULT_PROVIDER_LLM_TIMEOUT_MS;
const MAX_PROVIDER_MEDIA_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.trunc(fallback);
  return Math.trunc(parsed);
}

function normalizeProviderMediaTimeoutMs(value, options = {}) {
  const fallback = positiveInteger(options.fallback, DEFAULT_PROVIDER_MEDIA_TIMEOUT_MS);
  const maximum = Math.max(
    MIN_PROVIDER_MEDIA_TIMEOUT_MS,
    positiveInteger(options.maximum, MAX_PROVIDER_MEDIA_TIMEOUT_MS),
  );
  const requested = positiveInteger(value, fallback);
  if (options.allowShortForTests === true) return Math.max(1, Math.min(maximum, requested));
  return Math.max(MIN_PROVIDER_MEDIA_TIMEOUT_MS, Math.min(maximum, requested));
}

function normalizeProviderLlmTimeoutMs(value, options = {}) {
  const fallback = positiveInteger(options.fallback, DEFAULT_PROVIDER_LLM_TIMEOUT_MS);
  const requested = positiveInteger(value, fallback);
  return Math.max(1, Math.min(MAX_PROVIDER_LLM_TIMEOUT_MS, requested));
}

function minimumProviderMediaPollCount(intervalMs, requestedPolls) {
  const interval = positiveInteger(intervalMs, 1);
  const requested = positiveInteger(requestedPolls, 1);
  return Math.max(Math.ceil(MIN_PROVIDER_MEDIA_TIMEOUT_MS / interval), requested);
}

function providerMediaGenerationOptions(options = {}, policyOptions = {}) {
  return {
    ...options,
    timeoutMs: normalizeProviderMediaTimeoutMs(options.timeoutMs, policyOptions),
  };
}

function providerLlmGenerationOptions(options = {}, policyOptions = {}) {
  return {
    ...options,
    timeoutMs: normalizeProviderLlmTimeoutMs(options.timeoutMs, policyOptions),
  };
}

module.exports = Object.freeze({
  DEFAULT_PROVIDER_LLM_TIMEOUT_MS,
  DEFAULT_PROVIDER_MEDIA_TIMEOUT_MS,
  MAX_PROVIDER_LLM_TIMEOUT_MS,
  MAX_PROVIDER_MEDIA_TIMEOUT_MS,
  MIN_PROVIDER_MEDIA_TIMEOUT_MS,
  minimumProviderMediaPollCount,
  normalizeProviderLlmTimeoutMs,
  normalizeProviderMediaTimeoutMs,
  providerLlmGenerationOptions,
  providerMediaGenerationOptions,
});
