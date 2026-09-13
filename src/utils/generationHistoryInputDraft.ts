import { collectUpstreamMaterials, type Material } from '../components/nodes/useUpstreamMaterials';
import { orderMaterials } from '../components/nodes/useOrderedMaterials';
import { resolveMediaMentions, type MediaMention } from '../components/nodes/mediaMentions';
import { filterExcludedMaterials, normalizeExcludedMaterialIds } from './materialExclusion';
import { historySettingLabel, selectHistoryBasicSettings, supportsHistoryInputDraft } from './generationHistorySettings';
import { frozenAssetMediaUrl } from './frozenAssetMedia';
import { historyResolvedSeedanceInput } from './historyResolvedSeedanceInput';
import { readHistoryStandardImageInput } from './historyStandardImageInput';
import { readHistoryBudgetImageInput } from './historyBudgetImageInput';
import { readHistoryFalImageInput } from './historyFalImageInput';
import { readHistoryStandardBananaInput } from './historyStandardBananaInput';
import { FAL_REGISTRY, VIDEO_FAL_REGISTRY } from '../providers/models';
import { readHistoryStandardVideoInput } from './historyStandardVideoInput';
import { readHistoryFalVideoInput } from './historyFalVideoInput';
import { historyVideoBasicSettings } from './historyVideoBasicSettings';
import { IMAGE_HISTORY_EXTRA_FIELDS, historyImageBasicSettings } from './historyImageBasicSettings';
import type { AssetRef, CanvasPatch } from '../types/project';
import type { GenerationHistoryGroup, GenerationHistoryInputArchive } from '../types/generationHistory';

type AvailableArchive = Extract<GenerationHistoryInputArchive, { status: 'available' }>;
export class HistoryReferenceRecoveryRequired extends Error {
  recover?: (file: File, signal: AbortSignal) => Promise<void>;
  constructor(public readonly target: { referenceGroupId: string; referenceArchiveDigest: string; referenceIndex: number }, public readonly label: string) {
    super(`${label} 的旧文件缺失或已变化。请选择当时的原文件，系统会核对内容；本次未创建草稿。`);
    this.name = 'HistoryReferenceRecoveryRequired';
  }
}
const kinds = ['image', 'video', 'audio'] as const;
const fieldFor = { image: 'localRefImages', video: 'localRefVideos', audio: 'localRefAudios' } as const;
const labels = { image: '图片', video: '视频', audio: '音频' };
const listOfStrings = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('历史参考顺序不完整，未创建草稿');
  return value;
};

/** Same input selection semantics as SeedanceNode, applied to the archived
 * graph only. No current upstream nodes are consulted, edited, or executed. */
export function collectHistorySeedanceInputs(archive: AvailableArchive) {
  const { node, upstreamNodes, incomingEdges } = archive.snapshot;
  const resolved = historyResolvedSeedanceInput(node.data);
  if (resolved) return { prompt: resolved.prompt as string,
    media: kinds.flatMap(kind => listOfStrings(resolved[fieldFor[kind]]).map((url, index) => ({ kind, url, label: `${labels[kind]} ${index + 1}` }))) };
  const incoming = incomingEdges.filter(edge => edge.target === node.id);
  const ids = [...new Set(incoming.map(edge => String(edge.source)))];
  const inputs = ids.map(id => upstreamNodes.find(source => source.id === id));
  if (inputs.some(source => !source)) throw new Error('历史上游节点不完整，未创建草稿');
  const handles = new Map<string, Set<string | null>>(), targets = new Map<string, Set<string>>();
  for (const edge of incoming) {
    const source = String(edge.source), handle = edge.sourceHandle == null ? null : String(edge.sourceHandle);
    handles.set(source, new Set([...(handles.get(source) || []), handle]));
    const target = String(edge.targetHandle || '').trim();
    if (target) targets.set(source, new Set([...(targets.get(source) || []), target]));
  }
  const upstream = collectUpstreamMaterials(inputs as typeof upstreamNodes, handles, targets, [node]);
  const order = listOfStrings(node.data.materialOrder), excluded = normalizeExcludedMaterialIds(node.data.excludedMaterialIds);
  const ordered = {
    texts: orderMaterials(filterExcludedMaterials(upstream.texts, excluded), order),
    image: orderMaterials(filterExcludedMaterials(upstream.images, excluded), order),
    video: orderMaterials(filterExcludedMaterials(upstream.videos, excluded), order),
    audio: orderMaterials(filterExcludedMaterials(upstream.audios, excluded), order),
  };
  const local = Object.fromEntries(kinds.map(kind => [kind, listOfStrings(node.data[fieldFor[kind]])])) as Record<typeof kinds[number], string[]>;
  const localMaterials: Material[] = kinds.flatMap(kind => local[kind].map(url => ({
    id: `local::seedance-${kind}:${url}`, kind, url, sourceNodeId: node.id, origin: 'local' as const,
  })));
  const mentions = Array.isArray(node.data.promptMentions) ? node.data.promptMentions as MediaMention[] : [];
  if (mentions.some(mention => !mention || !['image', 'video', 'audio', 'text'].includes(mention.kind)
    || typeof mention.token !== 'string' || typeof mention.materialKey !== 'string'
    || !Number.isSafeInteger(mention.start) || !Number.isSafeInteger(mention.end))) throw new Error('历史引用标记不完整，未创建草稿');
  const localPrompt = typeof node.data.prompt === 'string' ? node.data.prompt : '';
  const resolvedPrompt = resolveMediaMentions(localPrompt, mentions, [...ordered.image, ...ordered.video, ...ordered.audio, ...localMaterials]);
  const prompt = (ordered.texts.map(item => item.url).filter(Boolean).join('\n').trim() || resolvedPrompt || '').trim();
  const media = kinds.flatMap(kind => [...new Set([...ordered[kind].map(item => item.url), ...local[kind]].filter(Boolean))]
    .map((url, index) => ({ kind, url, label: `${labels[kind]} ${index + 1}` })));
  return { prompt, media };
}

export async function prepareHistoryInputDraft(archive: GenerationHistoryInputArchive | undefined, group: GenerationHistoryGroup,
  scope: { projectId: string; canvasId: string }, dependencies: {
    assertCurrent: () => void;
    getAsset: (id: string) => Promise<AssetRef>;
    request: (url: string, init: RequestInit) => Promise<Pick<Response, 'ok'>>;
    recoveredReferences?: GenerationHistoryGroup['referenceRecoveries'];
  }) {
  dependencies.assertCurrent();
  if (!archive || archive.status !== 'available' || !group.snapshotAvailable) throw new Error('当时的完整输入未归档，不能创建输入草稿');
  const { binding, snapshot } = archive;
  if (!binding.nodeEntityUid || binding.projectId !== scope.projectId || binding.canvasId !== scope.canvasId
    || binding.nodeId !== group.nodeId || binding.nodeEntityUid !== group.nodeEntityUid
    || snapshot.node.id !== binding.nodeId || snapshot.node.type !== group.nodeType
    || !supportsHistoryInputDraft(snapshot.node.type)) throw new Error('历史输入作用域或节点类型不匹配');
  // Route only from the validated captured source, never raw current node data
  // or a failed reader followed by a more permissive fallback.
  const capturedImageSettings = snapshot.node.type === 'image' ? historyImageBasicSettings(snapshot.node.data) : undefined;
  const budgetImage = capturedImageSettings?.imageBuiltinSource === 'seedance-nz';
  const falImage = !budgetImage && Boolean(capturedImageSettings && Object.hasOwn(FAL_REGISTRY, String(capturedImageSettings.apiModel)));
  const bananaImage = !budgetImage && !falImage && ['nano-banana-2', 'nano-banana-pro'].includes(String(capturedImageSettings?.model));
  const imageInput = snapshot.node.type === 'image'
    ? (budgetImage ? readHistoryBudgetImageInput : falImage ? readHistoryFalImageInput
      : bananaImage ? readHistoryStandardBananaInput : readHistoryStandardImageInput)(snapshot.node.data) : undefined;
  const capturedVideoSettings = snapshot.node.type === 'video' ? historyVideoBasicSettings(snapshot.node.data) : undefined;
  const falVideo = Boolean(capturedVideoSettings && Object.hasOwn(VIDEO_FAL_REGISTRY, String(capturedVideoSettings.model)));
  const falVideoInput = falVideo ? readHistoryFalVideoInput(snapshot.node.data) : undefined;
  const videoInput = snapshot.node.type === 'video'
    ? falVideoInput || readHistoryStandardVideoInput(snapshot.node.data) : undefined;
  const standardInput = imageInput || videoInput;
  const { prompt, media } = standardInput || collectHistorySeedanceInputs(archive);
  if (media.length > 100) throw new Error('历史参考数量超出恢复上限，未创建部分草稿');
  const resolvedInput = standardInput ? undefined : historyResolvedSeedanceInput(snapshot.node.data);
  const settings = standardInput?.settings || selectHistoryBasicSettings(resolvedInput || snapshot.node.data);
  const data: Record<string, unknown> = { ...settings };
  if (resolvedInput) data.providerParams = structuredClone(resolvedInput.providerParams);
  data.prompt = prompt;
  const references: Array<{ kind: typeof kinds[number]; url: string; label: string }> = [];
  const checked = new Map<string, string>();
  // Sequential bounded reads avoid starting 100 simultaneous file-hash jobs.
  for (const item of media) {
    dependencies.assertCurrent();
    const entries = archive.references?.status === 'captured' ? archive.references.entries : [];
    const matches = entries.filter(entry => {
      let value: unknown = snapshot;
      for (const part of entry.path) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
      return value === item.url;
    });
    const bound = matches[0];
    if (!bound || bound.status !== 'bound' || bound.kind !== item.kind
      || matches.some(entry => entry.status !== 'bound' || entry.kind !== bound.kind || entry.assetId !== bound.assetId
        || entry.entityUid !== bound.entityUid || entry.contentHash !== bound.contentHash)) {
      throw new Error(`${item.label} 未记录可验证的旧版本。可先找回本地文件；本次未创建草稿。`);
    }
    const key = JSON.stringify([bound.assetId, bound.entityUid, bound.contentHash]);
    let url = checked.get(key);
    if (!url) {
      const referenceIndex = entries.indexOf(bound);
      const recovered = dependencies.recoveredReferences?.find(ref => ref.referenceIndex === referenceIndex);
      if (recovered && (recovered.contentHash !== bound.contentHash || recovered.kind !== bound.kind)) throw new Error('已找回参考与原归档不一致，未创建草稿');
      const expected = recovered || bound;
      const missing = () => new HistoryReferenceRecoveryRequired({ referenceGroupId: group.id, referenceArchiveDigest: archive.digest, referenceIndex }, item.label);
      let asset: AssetRef;
      try { asset = await dependencies.getAsset(expected.assetId); }
      catch { dependencies.assertCurrent(); throw missing(); }
      dependencies.assertCurrent();
      if (!asset || asset.id !== expected.assetId || asset.entityUid !== expected.entityUid || asset.contentHash !== bound.contentHash
        || asset.projectId !== scope.projectId || asset.kind !== item.kind || asset.availability !== 'available') {
        throw missing();
      }
      url = frozenAssetMediaUrl(asset);
      let response: Pick<Response, 'ok'>;
      try { response = await dependencies.request(url, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', redirect: 'error' }); }
      catch { dependencies.assertCurrent(); throw missing(); }
      dependencies.assertCurrent();
      if (!response.ok) throw missing();
      checked.set(key, url);
    }
    // Distinct original aliases of the same bytes may both have been inputs.
    // Keep each slot distinct for both URL dedupers and mention identities.
    references.push({ kind: item.kind, url: `${url}&referenceSlot=${references.length}`, label: item.label });
  }
  if (imageInput) data.referenceImages = references.map(ref => ref.url);
  else for (const kind of kinds) data[fieldFor[kind]] = references.filter(ref => ref.kind === kind).map(ref => ref.url);
  // Freeze the effective prompt selected by the node-specific adapter.
  // Rebind numbered media tokens to the restored ordered local references so
  // later prompt editing still uses the normal mention editor.
  const promptMentions: MediaMention[] = [];
  for (const match of prompt.matchAll(/@(image|img|video|vid|audio|aud)(\d+)\b/g)) {
    // Standard image/video upstream text may contain literal aliases or zero-padded tokens.
    // Binding those would rewrite the initial compiled prompt on generation.
    if (standardInput && match[0] !== `@image${Number(match[2])}`) continue;
    const tokenKinds = { image: 'image', img: 'image', video: 'video', vid: 'video', audio: 'audio', aud: 'audio' } as const;
    const kind = tokenKinds[match[1] as keyof typeof tokenKinds];
    const ref = references.filter(item => item.kind === kind)[Number(match[2]) - 1];
    if (!ref) continue; // Preserve an original literal token; do not invent its material.
    promptMentions.push({ id: `history-mention-${match.index}`, kind, materialKey: `${kind}:${ref.url}`, url: ref.url,
      label: ref.label, token: match[0], start: match.index!, end: match.index! + match[0].length });
  }
  data.promptMentions = promptMentions;
  data.historyInputDraft = { archiveDigest: archive.digest, sourceNodeEntityUid: binding.nodeEntityUid };
  dependencies.assertCurrent();
  // Standard GPT2.5 ignores aspectRatio/sizeLevel in its request. Keep the
  // captured node values in data, but review the effective size controls rather
  // than presenting an inactive "2K" as the generated image size.
  const image25 = imageInput && Object.hasOwn(settings, 'gptImage25Size');
  const videoNew = videoInput && Object.hasOwn(settings, 'size');
  const bananaLite = bananaImage && settings.apiModel === 'gemini-3.1-flash-lite-image';
  const hiddenReviewKeys = new Set(standardInput ? ['providerSource', 'providerId', 'providerModel',
    ...(videoNew || falVideo ? ['ratio', 'duration', 'resolution', 'seed'] : []),
    ...(image25 || budgetImage || falImage ? ['aspectRatio', 'sizeLevel'] : []),
    ...(bananaLite ? ['sizeLevel'] : []),
    ...(falImage && settings.falSize !== 'custom' ? ['falCustomW', 'falCustomH'] : []),
    ...(falImage && settings.apiModel !== 'gpt-image-2-fal' ? ['falSync'] : []),
    ...(budgetImage && settings.zhenzhenImageG25Size === 'custom' ? ['zhenzhenImageG25Resolution'] : []),
    ...(budgetImage && settings.zhenzhenImageG25Size !== 'custom' ? ['zhenzhenImageG25CustomWidth', 'zhenzhenImageG25CustomHeight'] : []),
    ...(budgetImage && settings.zhenzhenImageG25OutputFormat === 'png' ? ['zhenzhenImageG25OutputCompression'] : []),
    ...(image25 && settings.gptImage25Size !== 'custom' ? ['gptImage25CustomWidth', 'gptImage25CustomHeight'] : [])] : []);
  const primaryImageOptions = new Set(['gptImage25Size', 'gptImage25Count', 'gptImage25CustomWidth', 'gptImage25CustomHeight',
    'falMode', 'falSize', 'falCustomW', 'falCustomH', 'falN', 'nbAspect', 'nbResolution',
    'zhenzhenImageG25Size', 'zhenzhenImageG25Resolution', 'zhenzhenImageG25Count', 'zhenzhenImageG25CustomWidth', 'zhenzhenImageG25CustomHeight']);
  return { nodeType: snapshot.node.type, data, prompt, references, referenceWarning: false, resolvedFrontendInputs: Boolean(standardInput || resolvedInput),
    ...(imageInput ? { inputKind: budgetImage ? 'budget-image' as const : falImage ? 'fal-image' as const
      : bananaImage ? 'banana-image' as const : 'standard-image' as const } : {}),
    ...(videoInput ? { inputKind: falVideo ? 'fal-video' as const : 'standard-video' as const } : {}),
    fields: [{ key: 'prompt', label: '实际提示词（含上游文本）', before: '新建独立草稿', after: prompt },
      ...Object.entries(settings).filter(([key]) => key !== 'prompt' && !hiddenReviewKeys.has(key))
        .map(([key, value]) => ({ key, label: historySettingLabel(key, snapshot.node.type), before: '新建独立草稿', after: typeof value === 'string' ? value : JSON.stringify(value),
          ...(imageInput && Object.hasOwn(IMAGE_HISTORY_EXTRA_FIELDS, key) && !primaryImageOptions.has(key) ? { advanced: true } : {}) })),
      // Display-only effective request value. Never persist it as a node field
      // or replace the archived setting; this is not a decoded output size.
      ...(bananaLite ? [{ key: 'requestedImageSize', label: '请求分辨率', before: '新建独立草稿', after: '1K' }] : []),
      ...(falVideoInput?.requestedSafetyTolerance !== undefined && settings.vfSafety !== falVideoInput.requestedSafetyTolerance
        ? [{ key: 'requestedSafetyTolerance', label: '实际请求安全容忍度', before: '新建独立草稿', after: String(falVideoInput.requestedSafetyTolerance) }] : []),
      ...(resolvedInput && Object.keys(resolvedInput.providerParams as object).length
        ? [{ key: 'providerParams', label: '提交时的附加参数（不含凭据）', before: '新建独立草稿', after: JSON.stringify(resolvedInput.providerParams, null, 2) }] : [])],
  };
}

export function createHistoryInputDraftPatch(draft: Awaited<ReturnType<typeof prepareHistoryInputDraft>>, input: {
  id: string; projectId: string; canvasId: string; baseRevision: number; position: { x: number; y: number };
}): CanvasPatch {
  if (Object.values(draft.data).some(value => typeof value === 'string' && value.length > 65536)) throw new Error('历史文本超过画布写入上限，未截断或创建草稿');
  return { schema: 't8-canvas-patch-v1', id: input.id, baseRevision: input.baseRevision, requiresConfirmation: true,
    summary: '从生成历史新建独立输入草稿（不生成）', diagnosticsResolved: [], operations: [{
      opId: `${input.id}-input-draft`, projectId: input.projectId, canvasId: input.canvasId,
      actorId: '', sessionId: '', clientSeq: 0, timestamp: 1, type: 'node.add', payload: { node: {
        id: `history-input-${input.id}`, type: draft.nodeType, position: input.position, data: draft.data,
      } },
    }],
  };
}
