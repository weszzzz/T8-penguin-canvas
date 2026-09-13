import { IMAGE_MODELS, FAL_REGISTRY, GPT_FAL_SIZES, NBPRO_FAL_RATIOS, NBPRO_FAL_RESOLUTIONS } from '../providers/models';
import { historyImageBasicSettings } from './historyImageBasicSettings';

const supported = ['gpt-image-2-fal', 'nano-banana-pro-fal', 'nano-banana-2-fal'];
const baseKeys = ['model', 'apiModel', 'aspectRatio', 'sizeLevel', 'imageBuiltinSource', 'providerSource', 'providerId', 'providerModel',
  'falN', 'falFormat', 'falSync'];
const gptKeys = ['falMode', 'falSize', 'falCustomW', 'falCustomH', 'falQuality'];
const bananaKeys = ['nbAspect', 'nbResolution', 'nbSafety', 'nbSeed', 'nbSysPrompt', 'nbWebSearch', 'nbImgMode'];

/** Read-only FAL preparation. Fixed asset identity, confirmation and persistence
 * remain caller responsibilities; this does not open a public draft capability. */
export function readHistoryFalImageInput(data: Record<string, unknown>) {
  const settings = historyImageBasicSettings(data);
  if (!settings) throw new Error('历史未记录完整图像输入，未套用当前默认值');
  const model = IMAGE_MODELS.find(item => item.id === settings.model);
  const apiModel = String(settings.apiModel), definition = FAL_REGISTRY[apiModel];
  if (!supported.includes(apiModel) || !definition || !model?.apiModelOptions?.some(item => item.value === apiModel)
    || settings.imageBuiltinSource !== 'zhenzhen' || settings.providerSource !== 'zhenzhen'
    || settings.providerId !== '' || settings.providerModel !== '') throw new Error('此图像渠道尚未支持完整输入恢复');
  // Common v2 capture did not archive overrides. Do not claim an exact restored
  // frontend request when unrecorded raw extras were forwarded by submitImageFal.
  const params = data.providerParams;
  if (params != null && (typeof params !== 'object' || Array.isArray(params)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(params)) || Object.keys(params).length)) {
    throw new Error('历史图像附加参数尚未支持完整恢复');
  }
  const gpt = definition.paramKind === 'gpt-fal';
  const keys = [...baseKeys, ...(gpt ? gptKeys : bananaKeys)];
  const member = (key: string, values: readonly string[]) => values.includes(String(settings[key]));
  const integer = (key: string, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(settings[key])
    && Number(settings[key]) >= min && Number(settings[key]) <= max;
  const invalid = () => new Error('历史图像参数不完整或已不兼容，未套用当前默认值');
  if (keys.some(key => !Object.hasOwn(settings, key)) || !integer('falN', 1, 4)
    || !member('falFormat', ['png', 'jpeg', 'webp'])) throw invalid();
  if (gpt) {
    if (!member('falMode', ['edit', 'gen']) || !member('falSize', GPT_FAL_SIZES.map(item => item.value))
      || !member('falQuality', ['auto', 'low', 'medium', 'high'])
      || !integer('falCustomW', 1) || !integer('falCustomH', 1)) throw invalid();
    // Preserve explicit configured integers. Backend snap16 still performs its
    // existing rounding/clamping; these are not claimed as final output pixels.
  } else if (!member('nbAspect', NBPRO_FAL_RATIOS) || !member('nbResolution', NBPRO_FAL_RESOLUTIONS)
    || !member('nbSafety', ['1', '2', '3', '4', '5', '6']) || !member('nbImgMode', ['image_url', 'base64'])
    || !integer('nbSeed', 0)) throw invalid();
  const context = data.historyResolvedInput as { prompt: string; referenceImages: string[] };
  if (!context.prompt.trim() || context.referenceImages.length > definition.maxRefs
    || context.referenceImages.some(url => !url.trim())) throw invalid();
  // GPT gen omits image_urls even when the frontend had references. Keep its
  // compiled prompt but do not pretend those unused images were sent upstream.
  const refs = gpt && settings.falMode === 'gen' ? [] : context.referenceImages;
  return { settings: Object.fromEntries(keys.map(key => [key, settings[key]])), prompt: context.prompt,
    media: refs.map((url, index) => ({ kind: 'image' as const, url, label: `图片 ${index + 1}` })) };
}
