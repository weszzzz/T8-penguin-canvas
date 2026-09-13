import { IMAGE_MODELS } from '../providers/models';
import { historyImageBasicSettings } from './historyImageBasicSettings';

const keys = ['model', 'apiModel', 'aspectRatio', 'sizeLevel', 'imageBuiltinSource',
  'providerSource', 'providerId', 'providerModel'] as const;
const supported = new Set(['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image',
  'nano-banana-pro', 'nano-banana-pro-2k', 'nano-banana-pro-4k', 'gemini-3-pro-image']);

/** Read-only archive preparation, not a public recovery gate. The caller must
 * still bind fixed assets and verify scope, confirmation and persistence.
 * sizeLevel is the archived setting, not a decoded output size: the existing
 * Gemini Lite backend always requests 1K even when this setting says 4K. */
export function readHistoryStandardBananaInput(data: Record<string, unknown>) {
  const settings = historyImageBasicSettings(data);
  if (!settings) throw new Error('历史未记录完整图像输入，未套用当前默认值');
  const model = IMAGE_MODELS.find(item => item.id === settings.model);
  if (!model || !['nano-banana-2', 'nano-banana-pro'].includes(model.id)
    || model.paramKind !== 'banana-ratio' || !supported.has(String(settings.apiModel))
    || !model.apiModelOptions?.some(item => item.value === settings.apiModel)
    || settings.providerSource !== 'zhenzhen' || settings.imageBuiltinSource !== 'zhenzhen'
    || settings.providerId !== '' || settings.providerModel !== '') {
    throw new Error('此图像渠道尚未支持完整输入恢复');
  }
  // v2 has no effective additional-parameter capture. Do not guess which
  // credential/group overrides were used, or copy raw parameters into a draft.
  const params = data.providerParams;
  if (params != null && (typeof params !== 'object' || Array.isArray(params)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(params))
    || Object.keys(params).length)) throw new Error('历史图像附加参数尚未支持完整恢复');

  const context = data.historyResolvedInput as { prompt: string; referenceImages: string[] };
  if (!model.aspectRatios.includes(String(settings.aspectRatio))
    || !model.sizes.includes(String(settings.sizeLevel)) || !context.prompt.trim()
    || context.referenceImages.length > model.maxReferenceImages
    || context.referenceImages.some(url => !url.trim())) {
    throw new Error('历史图像参数不完整或已不兼容，未套用当前默认值');
  }
  // The archive already contains compiled prompt and capped reference order.
  // Keep duplicate slots; never reapply adjustments or read the current graph.
  return {
    settings: Object.fromEntries(keys.map(key => [key, settings[key]])),
    prompt: context.prompt,
    media: context.referenceImages.map((url, index) => ({ kind: 'image' as const, url, label: `图片 ${index + 1}` })),
  };
}
