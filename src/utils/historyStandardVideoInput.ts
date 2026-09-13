import { VIDEO_MODELS, isFalVideoModel, isGrokVideo15NewModel, videoModelOptionsForSource } from '../providers/models';
import { historyVideoBasicSettings } from './historyVideoBasicSettings';

const commonKeys = ['mainId', 'model', 'videoBuiltinSource', 'providerSource', 'providerId', 'providerModel',
  'ratio', 'duration', 'resolution', 'seed'] as const;

/** Read-only standard Grok preparation. This does not enable a canvas action:
 * scope, fixed asset identity/bytes, mentions and persistence are caller gates.
 * Other video branches need their own effective-input mapping before admission. */
export function readHistoryStandardVideoInput(data: Record<string, unknown>) {
  const settings = historyVideoBasicSettings(data);
  if (!settings) throw new Error('历史未记录完整视频输入，未套用当前默认值');
  const model = VIDEO_MODELS.find(item => item.id === settings.mainId);
  const apiModel = String(settings.model);
  if (!model || model.id !== 'grok-video-3' || model.kind !== 'grok' || !model.supportImages
    || settings.videoBuiltinSource !== 'zhenzhen' || settings.providerSource !== 'zhenzhen'
    || settings.providerId !== '' || settings.providerModel !== '' || isFalVideoModel(apiModel)
    || !videoModelOptionsForSource(model, 'zhenzhen').some(option => option.value === apiModel && !option.disabled)
    || (apiModel !== 'grok-video-3' && !isGrokVideo15NewModel(apiModel))) {
    throw new Error('此视频渠道尚未支持完整输入恢复');
  }
  // Standard Grok forwards providerParams. The common context does not prove
  // their effective value, so never silently drop unadapted overrides.
  const params = data.providerParams;
  if (params != null && (typeof params !== 'object' || Array.isArray(params)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(params))
    || Object.keys(params).length)) throw new Error('历史视频附加参数尚未支持完整恢复');

  const isNew = isGrokVideo15NewModel(apiModel);
  const keys: readonly string[] = [...commonKeys, ...(isNew ? ['size'] : [])];
  const invalid = () => new Error('历史视频参数不完整或已不兼容，未套用当前默认值');
  if (keys.some(key => !Object.hasOwn(settings, key))) throw invalid();
  // New's only active scalar is its captured size (validated by the reader).
  // Ordinary Grok must not regain missing/falsy values through registry defaults.
  if (!isNew && (!model.ratios.includes(String(settings.ratio))
    || !model.durations?.includes(Number(settings.duration))
    || !model.resolutions?.includes(String(settings.resolution)))) throw invalid();
  const context = data.historyResolvedInput as { prompt: string; localRefImages: string[];
    localRefVideos: string[]; localRefAudios: string[] };
  // collectUpstream already dedupes each common list before capture. Reject a
  // malformed capture rather than inventing a new ordering or dropping blanks.
  if (!context.prompt.trim() || [context.localRefImages, context.localRefVideos, context.localRefAudios]
    .some(urls => urls.some(url => !url.trim()) || new Set(urls).size !== urls.length)) throw invalid();
  const cap = isNew ? 1 : model.maxRefImages;
  if (isNew && context.localRefImages.length === 0) throw invalid();
  // This branch forwards image URLs directly, without fallible base64 filtering.
  // Videos/audio and images after the branch cap were not sent to this request.
  return {
    settings: Object.fromEntries(keys.map(key => [key, settings[key]])),
    prompt: context.prompt,
    media: context.localRefImages.slice(0, cap).map((url, index) => ({ kind: 'image' as const, url, label: `图片 ${index + 1}` })),
  };
}
