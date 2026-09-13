import { VIDEO_MODELS, VIDEO_FAL_REGISTRY, videoModelOptionsForSource,
  VEO_FAL_RATIOS, VEO_FAL_DURATIONS, VEO_FAL_RESOLUTIONS,
  GROK_FAL_MODES, GROK_FAL_RATIOS, GROK_FAL_RESOLUTIONS,
  SORA2_FAL_MODES, SORA2_FAL_RATIOS, SORA2_FAL_DURATIONS, SORA2_FAL_RESOLUTIONS } from '../providers/models';
import { historyVideoBasicSettings } from './historyVideoBasicSettings';

const common = ['mainId', 'model', 'videoBuiltinSource', 'providerSource', 'providerId', 'providerModel',
  'ratio', 'duration', 'resolution', 'seed'];
const families: Record<string, string> = { 'veo3.1-fal': 'veo3.1', 'grok-video-fal': 'grok-video-3',
  'grok-imagine-video-1.5': 'grok-video-3', 'sora-2': 'sora-2' };

/** Read-only preparation used by the history draft route. The caller still needs
 * exact archive/asset identity, original bytes, confirmation and persistence.
 * Only effective image slots are returned; never restore raw URL/character IDs. */
export function readHistoryFalVideoInput(data: Record<string, unknown>) {
  const settings = historyVideoBasicSettings(data);
  if (!settings) throw new Error('历史未记录完整视频输入，未套用当前默认值');
  const apiModel = String(settings.model), model = VIDEO_MODELS.find(item => item.id === settings.mainId);
  const reg = VIDEO_FAL_REGISTRY[apiModel];
  if (!Object.hasOwn(families, apiModel) || !reg || !model || model.id !== families[apiModel]
    || settings.videoBuiltinSource !== 'zhenzhen' || settings.providerSource !== 'zhenzhen'
    || settings.providerId !== '' || settings.providerModel !== ''
    || !videoModelOptionsForSource(model, 'zhenzhen').some(option => option.value === apiModel && !option.disabled)) {
    throw new Error('此视频渠道尚未支持完整输入恢复');
  }
  const invalid = () => new Error('历史视频参数不完整或已不兼容，未套用当前默认值');
  const v15 = apiModel === 'grok-imagine-video-1.5';
  const extras = reg.paramKind === 'veo-fal' ? ['vfRatio', 'vfDuration', 'vfResolution', 'vfAudio', 'vfSafety']
    : reg.paramKind === 'grok-fal' ? ['gkfMode', 'gkfDuration', 'gkfResolution', ...(!v15 ? ['gkfRatio'] : [])]
    : ['soraMode', 'soraRatio', 'soraDuration', 'soraResolution', 'soraDeleteVideo', 'soraBlockIp'];
  if (extras.some(key => !Object.hasOwn(settings, key))) throw invalid();
  if (reg.paramKind === 'veo-fal' && (!VEO_FAL_RATIOS.includes(String(settings.vfRatio))
    || !VEO_FAL_DURATIONS.includes(String(settings.vfDuration)) || !VEO_FAL_RESOLUTIONS.includes(String(settings.vfResolution))
    || !Number.isInteger(settings.vfSafety) || Number(settings.vfSafety) < 0 || Number(settings.vfSafety) > 6)) throw invalid();
  if (reg.paramKind === 'grok-fal' && (!GROK_FAL_MODES.some(mode => mode.value === settings.gkfMode)
    || (v15 && settings.gkfMode !== 'image_to_video') || (!v15 && !GROK_FAL_RATIOS.includes(String(settings.gkfRatio)))
    || !GROK_FAL_RESOLUTIONS.includes(String(settings.gkfResolution)) || !Number.isInteger(settings.gkfDuration)
    || Number(settings.gkfDuration) < 1 || Number(settings.gkfDuration) > 30)) throw invalid();
  if (reg.paramKind === 'sora-fal' && (!SORA2_FAL_MODES.some(mode => mode.value === settings.soraMode)
    || !SORA2_FAL_RATIOS.includes(String(settings.soraRatio)) || !SORA2_FAL_RESOLUTIONS.includes(String(settings.soraResolution))
    || !SORA2_FAL_DURATIONS.includes(Number(settings.soraDuration)))) throw invalid();
  // These active inputs were not captured as fixed media/character identities.
  const unsupportedReference = reg.paramKind === 'sora-fal' ? data.soraCharacterIds
    : !v15 && reg.paramKind === 'grok-fal' && settings.gkfMode === 'reference_to_video' ? data.gkfReferenceUrls : undefined;
  if (unsupportedReference != null && unsupportedReference !== '') throw new Error('历史视频外部引用尚未支持完整恢复');
  const context = data.historyResolvedInput as { prompt: string; localRefImages: string[]; localRefVideos: string[]; localRefAudios: string[] };
  if (!context.prompt.trim() || [context.localRefImages, context.localRefVideos, context.localRefAudios]
    .some(urls => urls.some(url => !url.trim()) || new Set(urls).size !== urls.length)) throw invalid();
  const cap = reg.paramKind === 'grok-fal' && (v15 || settings.gkfMode !== 'reference_to_video') ? 1 : reg.maxRefImages;
  const references = reg.paramKind === 'sora-fal' && settings.soraMode === 'text_to_video' ? [] : context.localRefImages.slice(0, cap);
  if ((v15 || (reg.paramKind === 'grok-fal' && settings.gkfMode === 'reference_to_video')
    || (reg.paramKind === 'sora-fal' && settings.soraMode === 'image_to_video')) && !references.length) throw invalid();
  // FAL's closed backend payload ignores providerParams and inactive common
  // scalars. Preserve captured settings, not task IDs, credentials or raw extras.
  return { settings: Object.fromEntries([...common, ...extras].map(key => [key, settings[key]])),
    prompt: context.prompt,
    media: references.map((url, index) => ({ kind: 'image' as const, url, label: `图片 ${index + 1}` })),
    // Preserve the historical zero; disclose its actual backend coercion in the
    // eventual review UI, rather than silently rewriting the archived setting.
    ...(reg.paramKind === 'veo-fal' ? { requestedSafetyTolerance: Number(settings.vfSafety) || 4 } : {}) };
}
