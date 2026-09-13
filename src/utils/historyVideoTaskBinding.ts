import { VIDEO_MODELS, inferVideoBuiltinSource, videoModelsForSource, videoModelOptionsForSource } from '../providers/models';

/** Resolve the same built-in fallback as VideoNode, not just a suffix on raw
 * saved text. External-provider availability is not archival evidence: reject
 * a task-bound built-in fallback even if an extension might currently exist.
 * No settings/caches/Provider requests are changed or copied here. */
export function historyVideoUsesTaskCache(data: Record<string, unknown>): boolean {
  const rawModel = typeof data.model === 'string' ? data.model : '';
  const savedModelDef = VIDEO_MODELS.find(model => model.id === rawModel
    || model.apiModelOptions.some(option => option.value === rawModel));
  const source = data.videoBuiltinSource === 'seedance-nz' || data.videoBuiltinSource === 'zhenzhen'
    ? data.videoBuiltinSource
    : data.providerSource === 'seedance-nz' && !data.providerId ? 'seedance-nz'
      : inferVideoBuiltinSource(rawModel || data.mainId) || 'zhenzhen';
  const models = videoModelsForSource(source);
  const requestedMainId = data.mainId
    || (/^sora-2(?:-\d{4}-\d{2}-\d{2})?$/.test(rawModel) ? 'sora-2' : savedModelDef?.id)
    || models[0]?.id || VIDEO_MODELS[0].id;
  const model = models.find(item => item.id === requestedMainId)
    || (savedModelDef && models.find(item => item.id === savedModelDef.id)) || models[0] || VIDEO_MODELS[0];
  const options = videoModelOptionsForSource(model, source);
  const apiModel = rawModel && options.some(option => option.value === rawModel)
    ? rawModel : options[0]?.value || model.apiModelOptions[0].value;
  return model.kind === 'flux3' && apiModel.endsWith('-draft-enhance');
}
