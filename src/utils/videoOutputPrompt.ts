/** A video's generation prompt is not the node's currently edited input.
 * null means this is not a video-generator result; an empty recorded prompt
 * or missing legacy attribution must not fall back to a new draft prompt. */
export function getVideoOutputPrompt(nodeType: unknown, data: Record<string, unknown>): { prompt: string } | null {
  if (nodeType !== 'seedance' && nodeType !== 'video') return null;
  const nonempty = (value: unknown) => typeof value === 'string' && Boolean(value.trim());
  if (!nonempty(data.videoUrl) && !(Array.isArray(data.videoUrls) && data.videoUrls.some(nonempty))) return null;
  return { prompt: typeof data.lastPrompt === 'string' ? data.lastPrompt : '' };
}
