import { IMAGE_MODELS, isFalModel, isGptImage25Model, GPT_IMAGE_25_MAX_IMAGES,
  GPT_IMAGE_25_QUALITIES, GPT_IMAGE_25_MODERATION, GPT_IMAGE_25_SIZES,
  GPT_IMAGE_25_BACKGROUNDS, GPT_IMAGE_25_PROMPT_MAX_LENGTH, validateGptImage25Size } from '../providers/models';
import { historyImageBasicSettings } from './historyImageBasicSettings';

const baseKeys = ['model', 'apiModel', 'aspectRatio', 'sizeLevel', 'imageBuiltinSource',
  'providerSource', 'providerId', 'providerModel'] as const;
const gptKeys = ['gptImageQuality', 'gptImageModeration'] as const;
const gpt25Keys = ['gptImage25Size', 'gptImage25CustomWidth', 'gptImage25CustomHeight',
  'gptImage25Count', 'gptImage25Background'] as const;

/** Read-only preparation for standard GPT image input recovery. Not a public
 * capability gate: asset identity/bytes, scope and draft persistence still have
 * to be checked by the caller before a canvas node can be created. */
export function readHistoryStandardImageInput(data: Record<string, unknown>) {
  const settings = historyImageBasicSettings(data);
  if (!settings) throw new Error('历史未记录完整图像输入，未套用当前默认值');
  const model = IMAGE_MODELS.find(item => item.id === settings.model);
  if (!model || model.id !== 'gpt-image-2' || model.paramKind !== 'gpt-size'
    || settings.providerSource !== 'zhenzhen' || settings.imageBuiltinSource !== 'zhenzhen'
    || settings.providerId !== '' || settings.providerModel !== ''
    || !model.apiModelOptions?.some(item => item.value === settings.apiModel)
    || isFalModel(String(settings.apiModel))) throw new Error('此图像渠道尚未支持完整输入恢复');

  // The standard request forwards providerParams too. v2's common context did
  // not capture its effective value: never silently discard a nonempty object.
  const params = data.providerParams;
  if (params != null && (typeof params !== 'object' || Array.isArray(params)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(params))
    || Object.keys(params).length)) throw new Error('历史图像附加参数尚未支持完整恢复');

  const is25 = isGptImage25Model(String(settings.apiModel));
  const keys = [...baseKeys, ...gptKeys, ...(is25 ? gpt25Keys : [])];
  const invalid = () => new Error('历史图像参数不完整或已不兼容，未套用当前默认值');
  if (keys.some(key => !Object.hasOwn(settings, key))
    || !model.aspectRatios.includes(String(settings.aspectRatio))
    || !model.sizes.includes(String(settings.sizeLevel))
    || !(is25 ? GPT_IMAGE_25_QUALITIES : ['auto', 'high', 'medium', 'low'] as readonly string[]).includes(String(settings.gptImageQuality))
    || !(GPT_IMAGE_25_MODERATION as readonly string[]).includes(String(settings.gptImageModeration))) throw invalid();
  if (is25) {
    const boundedInteger = (key: string, min: number, max: number) => Number.isSafeInteger(settings[key])
      && Number(settings[key]) >= min && Number(settings[key]) <= max;
    if (!(GPT_IMAGE_25_SIZES as readonly string[]).includes(String(settings.gptImage25Size))
      || !(GPT_IMAGE_25_BACKGROUNDS as readonly string[]).includes(String(settings.gptImage25Background))
      || !boundedInteger('gptImage25Count', 1, 10)
      || !boundedInteger('gptImage25CustomWidth', 16, 3840)
      || !boundedInteger('gptImage25CustomHeight', 16, 3840)) throw invalid();
    const size = settings.gptImage25Size === 'custom'
      ? `${settings.gptImage25CustomWidth}x${settings.gptImage25CustomHeight}` : String(settings.gptImage25Size);
    if (validateGptImage25Size(size)) throw invalid();
  }
  // The parser above validates the v2 envelope. Keep the already compiled
  // prompt and combined local/upstream order; do not reapply old adjustments,
  // recalculate against today's graph, or collapse equal-URL input slots.
  const context = data.historyResolvedInput as { prompt: string; referenceImages: string[] };
  const maxRefs = is25 ? GPT_IMAGE_25_MAX_IMAGES : model.maxReferenceImages;
  if (!context.prompt.trim() || (is25 && context.prompt.length > GPT_IMAGE_25_PROMPT_MAX_LENGTH)
    || context.referenceImages.length > maxRefs || context.referenceImages.some(url => !url.trim())) throw invalid();
  return {
    settings: Object.fromEntries(keys.map(key => [key, settings[key]])),
    prompt: context.prompt,
    media: context.referenceImages.map((url, index) => ({ kind: 'image' as const, url, label: `图片 ${index + 1}` })),
  };
}
