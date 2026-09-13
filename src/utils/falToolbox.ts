import { minimumProviderMediaPollCount } from './providerTimeoutPolicy';

export type FalToolboxMediaKind = 'text' | 'image' | 'video' | 'audio' | 'model3d' | 'json';

export type FalToolboxUserParamKind = 'text' | 'textarea' | 'number' | 'select' | 'boolean';

export type FalToolboxUserParamConditionValue = string | number | boolean;

export interface FalToolboxUserParamCondition {
  key: string;
  equals?: FalToolboxUserParamConditionValue | FalToolboxUserParamConditionValue[];
  notEquals?: FalToolboxUserParamConditionValue | FalToolboxUserParamConditionValue[];
}

export interface FalToolboxCategory {
  id: string;
  name: string;
  description?: string;
  order?: number;
  icon?: string;
}

export interface FalToolboxInputMapping {
  key: string;
  label?: string;
  kind: Exclude<FalToolboxMediaKind, 'model3d' | 'json'>;
  required?: boolean;
  multiple?: boolean;
  maxItems?: number;
  sourceIndex?: number;
  defaultValue?: string;
  upload?: boolean;
  mediaMode?: 'url' | 'base64';
  order?: number;
}

export interface FalToolboxUserParam {
  key: string;
  payloadKey?: string;
  label: string;
  kind: FalToolboxUserParamKind;
  defaultValue?: string | number | boolean;
  placeholder?: string;
  options?: Array<string | number>;
  omitValues?: Array<string | number | boolean>;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  parseJson?: boolean;
  when?: FalToolboxUserParamCondition;
}

export interface FalToolboxFixedParam {
  key: string;
  value: string | number | boolean | string[] | number[] | Record<string, unknown>;
}

export interface FalToolboxOutputMapping {
  key: string;
  label?: string;
  kind: FalToolboxMediaKind;
  pathCandidates?: string[];
}

export interface FalToolboxTool {
  id: string;
  title: string;
  description?: string;
  categoryId: string;
  endpoint: string;
  enabled?: boolean;
  order?: number;
  capabilities: string[];
  inputSchema: FalToolboxInputMapping[];
  outputSchema: FalToolboxOutputMapping[];
  fixedParams?: FalToolboxFixedParam[];
  userParams?: FalToolboxUserParam[];
  runtime?: {
    pollIntervalMs?: number;
    maxPolls?: number;
    statusPath?: string;
  };
  ui?: {
    icon?: string;
    accent?: string;
    showInNode?: boolean;
    quickActionLabel?: string;
  };
  version?: number;
}

export interface FalToolboxManifest {
  schema: 't8-fal-toolbox-manifest';
  version: number;
  updatedAt?: string;
  categories: FalToolboxCategory[];
  tools: FalToolboxTool[];
}

export interface FalToolboxInputPools {
  texts?: string[];
  images?: string[];
  videos?: string[];
  audios?: string[];
}

export interface FalToolboxPickedInputs {
  values: Record<string, string | string[]>;
  missing: string[];
  missingKeys: string[];
}

export interface FalToolboxMediaField {
  key: string;
  kind: 'image' | 'video' | 'audio';
  multiple?: boolean;
  upload?: boolean;
  mediaMode?: 'url' | 'base64';
}

export interface FalToolboxRunPayload {
  toolId: string;
  title: string;
  endpoint: string;
  payload: Record<string, unknown>;
  mediaFields: FalToolboxMediaField[];
  outputSchema: FalToolboxOutputMapping[];
  statusPath?: string;
}

export interface FalToolboxOutputClassification {
  urls: string[];
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
  modelUrls: string[];
  textOutputs: string[];
}

export const FAL_TOOLBOX_ALL_CATEGORY_ID = 'all';

const DEFAULT_CATEGORY_ID = 'general';
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i;
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i;
const MODEL_RE = /\.(glb|gltf|obj|fbx|stl|usdz|zip)(\?|$)/i;

export const FAL_TOOLBOX_CAPABILITY_LABELS: Record<string, string> = {
  'image.generate': '图像生成',
  'image.edit': '图像编辑',
  'image.inpaint': '局部重绘',
  'image.upscale': '图像放大',
  'image.style': '图像风格',
  'video.generate': '视频生成',
  'video.edit': '视频编辑',
  'video.image-to-video': '图生视频',
  'video.text-to-video': '文生视频',
  'video.background-removal': '视频去背景',
  'audio.generate': '音频生成',
  'audio.tts': '语音合成',
  'audio.asr': '语音转文字',
  'audio.music': '音乐生成',
  'model3d.generate': '3D 模型',
};

function cleanText(value: unknown, fallback = ''): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return raw.length > 240 ? raw.slice(0, 240) : raw;
}

function cleanId(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function isValidFalToolboxEndpoint(value: unknown): boolean {
  const endpoint = String(value ?? '').trim();
  return !!endpoint && /^[a-z0-9._~:/-]+$/i.test(endpoint) && !endpoint.includes('..') && !/^https?:\/\//i.test(endpoint);
}

function cleanEndpoint(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return isValidFalToolboxEndpoint(raw) ? raw : '';
}

function cleanPayloadKey(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim();
  return raw && /^[a-z0-9._:-]+$/i.test(raw) && !raw.includes('..') ? raw : fallback;
}

function normalizeMediaKind(value: unknown): FalToolboxMediaKind {
  if (value === 'image' || value === 'video' || value === 'audio' || value === 'model3d' || value === 'json') return value;
  return 'text';
}

function normalizeInputKind(value: unknown): FalToolboxInputMapping['kind'] {
  if (value === 'image' || value === 'video' || value === 'audio') return value;
  return 'text';
}

function normalizeUserParamKind(value: unknown): FalToolboxUserParamKind {
  if (value === 'textarea' || value === 'number' || value === 'select' || value === 'boolean') return value;
  return 'text';
}

function cleanCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const capability = String(item ?? '').trim();
    if (!capability || seen.has(capability)) continue;
    seen.add(capability);
    out.push(capability);
  }
  return out;
}

function normalizeConditionValue(value: unknown): FalToolboxUserParamConditionValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

function normalizeConditionValueList(value: unknown): FalToolboxUserParamConditionValue[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map(normalizeConditionValue).filter((item): item is FalToolboxUserParamConditionValue => item !== undefined);
}

function normalizeUserParamCondition(value: unknown): FalToolboxUserParamCondition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const key = cleanId(raw.key, '');
  if (!key) return undefined;
  const equals = normalizeConditionValueList(raw.equals);
  const notEquals = normalizeConditionValueList(raw.notEquals);
  if (!equals.length && !notEquals.length) return undefined;
  return {
    key,
    ...(equals.length ? { equals: equals.length === 1 ? equals[0] : equals } : {}),
    ...(notEquals.length ? { notEquals: notEquals.length === 1 ? notEquals[0] : notEquals } : {}),
  };
}

function sortByOrderThenTitle<T extends { order?: number; title?: string; name?: string; id: string }>(items: T[]): T[] {
  return items.slice().sort((a, b) => {
    const ao = Number.isFinite(a.order) ? Number(a.order) : 9999;
    const bo = Number.isFinite(b.order) ? Number(b.order) : 9999;
    if (ao !== bo) return ao - bo;
    return String(a.title || a.name || a.id).localeCompare(String(b.title || b.name || b.id), 'zh-Hans-CN');
  });
}

function sortInputSchema(items: FalToolboxInputMapping[]): FalToolboxInputMapping[] {
  return items.slice().sort((a, b) => {
    const ao = Number.isFinite(a.order) ? Number(a.order) : 9999;
    const bo = Number.isFinite(b.order) ? Number(b.order) : 9999;
    if (ao !== bo) return ao - bo;
    return String(a.label || a.key).localeCompare(String(b.label || b.key), 'zh-Hans-CN');
  });
}

export function normalizeFalToolboxManifest(manifest: Partial<FalToolboxManifest> | null | undefined): FalToolboxManifest {
  const rawCategories = Array.isArray(manifest?.categories) ? manifest!.categories : [];
  const categories: FalToolboxCategory[] = [];
  const categoryIds = new Set<string>();

  for (const [index, item] of rawCategories.entries()) {
    const id = cleanId((item as any)?.id, `${DEFAULT_CATEGORY_ID}-${index + 1}`);
    if (categoryIds.has(id)) continue;
    categoryIds.add(id);
    categories.push({
      id,
      name: cleanText((item as any)?.name, id),
      description: cleanText((item as any)?.description),
      order: Number.isFinite((item as any)?.order) ? Number((item as any).order) : index,
      icon: cleanText((item as any)?.icon),
    });
  }
  if (!categories.length) {
    categories.push({ id: DEFAULT_CATEGORY_ID, name: '通用', order: 0 });
    categoryIds.add(DEFAULT_CATEGORY_ID);
  }

  const rawTools = Array.isArray(manifest?.tools) ? manifest!.tools : [];
  const tools: FalToolboxTool[] = [];
  const toolIds = new Set<string>();

  for (const [index, item] of rawTools.entries()) {
    const raw = item as any;
    const endpoint = cleanEndpoint(raw?.endpoint);
    const id = cleanId(raw?.id || endpoint, `fal-tool-${index + 1}`);
    if (toolIds.has(id)) continue;
    toolIds.add(id);
    const categoryId = categoryIds.has(raw?.categoryId) ? raw.categoryId : categories[0].id;
    const inputSchema: FalToolboxInputMapping[] = Array.isArray(raw?.inputSchema)
      ? raw.inputSchema.map((input: any, inputIndex: number) => ({
          key: cleanId(input?.key, `input-${inputIndex + 1}`),
          label: cleanText(input?.label, input?.key || `输入${inputIndex + 1}`),
          kind: normalizeInputKind(input?.kind),
          required: input?.required !== false,
          multiple: input?.multiple === true,
          maxItems: Number.isFinite(input?.maxItems) ? Math.max(1, Number(input.maxItems)) : undefined,
          sourceIndex: Number.isFinite(input?.sourceIndex) ? Math.max(0, Number(input.sourceIndex)) : undefined,
          defaultValue: input?.defaultValue == null ? undefined : String(input.defaultValue),
          upload: input?.upload !== false,
          mediaMode: input?.mediaMode === 'base64' ? 'base64' : 'url',
          order: Number.isFinite(input?.order) ? Number(input.order) : inputIndex,
        }))
      : [];
    const userParams: FalToolboxUserParam[] = Array.isArray(raw?.userParams)
      ? raw.userParams.map((param: any, paramIndex: number) => ({
          key: cleanId(param?.key, `param-${paramIndex + 1}`),
          payloadKey: cleanPayloadKey(param?.payloadKey, cleanId(param?.key, `param-${paramIndex + 1}`)),
          label: cleanText(param?.label, param?.key || `参数${paramIndex + 1}`),
          kind: normalizeUserParamKind(param?.kind),
          defaultValue: param?.defaultValue,
          placeholder: cleanText(param?.placeholder),
          options: Array.isArray(param?.options) ? param.options : undefined,
          omitValues: Array.isArray(param?.omitValues) ? param.omitValues : undefined,
          min: Number.isFinite(param?.min) ? Number(param.min) : undefined,
          max: Number.isFinite(param?.max) ? Number(param.max) : undefined,
          step: Number.isFinite(param?.step) ? Number(param.step) : undefined,
          required: param?.required === true,
          parseJson: param?.parseJson === true,
          when: normalizeUserParamCondition(param?.when),
        }))
      : [];
    const outputSchema: FalToolboxOutputMapping[] = Array.isArray(raw?.outputSchema)
      ? raw.outputSchema.map((output: any, outputIndex: number) => ({
          key: cleanId(output?.key, `output-${outputIndex + 1}`),
          label: cleanText(output?.label, output?.key || `输出${outputIndex + 1}`),
          kind: normalizeMediaKind(output?.kind),
          pathCandidates: Array.isArray(output?.pathCandidates)
            ? output.pathCandidates.map((p: unknown) => String(p || '').trim()).filter(Boolean)
            : undefined,
        }))
      : [];

    tools.push({
      id,
      title: cleanText(raw?.title, id),
      description: cleanText(raw?.description),
      categoryId,
      endpoint,
      enabled: raw?.enabled !== false && !!endpoint,
      order: Number.isFinite(raw?.order) ? Number(raw.order) : index,
      capabilities: cleanCapabilities(raw?.capabilities),
      inputSchema: sortInputSchema(inputSchema),
      outputSchema,
      fixedParams: Array.isArray(raw?.fixedParams)
        ? raw.fixedParams
            .map((param: any) => ({ key: cleanId(param?.key, 'fixed'), value: param?.value }))
            .filter((param: FalToolboxFixedParam) => !!param.key)
        : [],
      userParams,
      runtime: raw?.runtime && typeof raw.runtime === 'object'
        ? (() => {
            const pollIntervalMs = Number.isFinite(raw.runtime.pollIntervalMs)
              ? Math.max(1000, Number(raw.runtime.pollIntervalMs))
              : 3000;
            return {
              pollIntervalMs,
              maxPolls: minimumProviderMediaPollCount(pollIntervalMs, raw.runtime.maxPolls),
              statusPath: cleanText(raw.runtime.statusPath),
            };
          })()
        : undefined,
      ui: raw?.ui && typeof raw.ui === 'object'
        ? {
            icon: cleanText(raw.ui.icon),
            accent: cleanText(raw.ui.accent),
            showInNode: raw.ui.showInNode !== false,
            quickActionLabel: cleanText(raw.ui.quickActionLabel),
          }
        : undefined,
      version: Number.isFinite(raw?.version) ? Number(raw.version) : 1,
    });
  }

  return {
    schema: 't8-fal-toolbox-manifest',
    version: Number.isFinite(manifest?.version) ? Number(manifest!.version) : 1,
    updatedAt: cleanText(manifest?.updatedAt),
    categories: sortByOrderThenTitle(categories),
    tools: sortByOrderThenTitle(tools),
  };
}

export function listFalToolboxTools(
  manifest: FalToolboxManifest,
  options: { includeDisabled?: boolean } = {},
): FalToolboxTool[] {
  const normalized = normalizeFalToolboxManifest(manifest);
  return normalized.tools.filter((tool) => options.includeDisabled || tool.enabled !== false);
}

export function findFalToolboxToolById(manifest: FalToolboxManifest, toolId: string): FalToolboxTool | undefined {
  return listFalToolboxTools(manifest, { includeDisabled: true }).find((tool) => tool.id === toolId);
}

export function filterFalToolboxTools(
  manifest: FalToolboxManifest,
  options: { categoryId?: string; query?: string; includeDisabled?: boolean } = {},
): FalToolboxTool[] {
  const q = String(options.query || '').trim().toLowerCase();
  return listFalToolboxTools(manifest, { includeDisabled: options.includeDisabled }).filter((tool) => {
    if (options.categoryId && options.categoryId !== FAL_TOOLBOX_ALL_CATEGORY_ID && tool.categoryId !== options.categoryId) return false;
    if (!q) return true;
    const haystack = [
      tool.title,
      tool.description,
      tool.endpoint,
      tool.categoryId,
      ...(tool.capabilities || []),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

function poolForKind(kind: FalToolboxInputMapping['kind'], pools: FalToolboxInputPools): string[] {
  if (kind === 'image') return pools.images || [];
  if (kind === 'video') return pools.videos || [];
  if (kind === 'audio') return pools.audios || [];
  return pools.texts || [];
}

export function pickFalToolboxInputs(tool: FalToolboxTool, pools: FalToolboxInputPools): FalToolboxPickedInputs {
  const values: Record<string, string | string[]> = {};
  const missing: string[] = [];
  const missingKeys: string[] = [];
  for (const input of tool.inputSchema) {
    const candidates = poolForKind(input.kind, pools).map((v) => String(v || '').trim()).filter(Boolean);
    if (!candidates.length && input.defaultValue) candidates.push(input.defaultValue);
    const sourceIndex = Number.isFinite(input.sourceIndex) ? Math.max(0, Number(input.sourceIndex)) : undefined;
    const sourceCandidates = sourceIndex == null
      ? candidates
      : candidates.slice(sourceIndex, input.multiple ? undefined : sourceIndex + 1);
    const picked = input.multiple
      ? sourceCandidates.slice(0, Math.max(1, input.maxItems || sourceCandidates.length || 1))
      : sourceCandidates[0];
    if ((Array.isArray(picked) && picked.length) || (!Array.isArray(picked) && picked)) {
      values[input.key] = picked;
    } else if (input.required) {
      missing.push(input.label || input.key);
      missingKeys.push(input.key);
    }
  }
  return { values, missing, missingKeys };
}

function setPayloadValue(payload: Record<string, unknown>, key: string, value: unknown) {
  const parts = String(key || '').split('.').filter(Boolean);
  if (parts.length <= 1) {
    payload[key] = value;
    return;
  }
  let cursor: Record<string, unknown> = payload;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function isOmittedParamValue(value: unknown, omitValues?: Array<string | number | boolean>): boolean {
  if (!Array.isArray(omitValues) || omitValues.length === 0) return false;
  return omitValues.some((item) => String(item) === String(value));
}

function getUserParamControlValue(
  params: FalToolboxUserParam[] | undefined,
  values: Record<string, string | number | boolean> | undefined,
  key: string,
): unknown {
  const param = (params || []).find((item) => item.key === key);
  return values?.[key] ?? param?.defaultValue;
}

function conditionValuesMatch(actual: unknown, expected: FalToolboxUserParamConditionValue | FalToolboxUserParamConditionValue[]): boolean {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  return expectedValues.some((item) => String(actual) === String(item));
}

function userParamConditionMatches(
  condition: FalToolboxUserParamCondition | undefined,
  params: FalToolboxUserParam[] | undefined,
  values: Record<string, string | number | boolean> | undefined,
): boolean {
  if (!condition) return true;
  const actual = getUserParamControlValue(params, values, condition.key);
  if (condition.equals !== undefined && !conditionValuesMatch(actual, condition.equals)) return false;
  if (condition.notEquals !== undefined && conditionValuesMatch(actual, condition.notEquals)) return false;
  return true;
}

function parseJsonParamValue(param: FalToolboxUserParam, value: unknown): unknown {
  if (param.parseJson !== true || typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return value;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${param.label || param.key} 不是有效 JSON`);
  }
}

export function buildFalToolboxRunPayload(
  tool: FalToolboxTool,
  options: {
    inputValues: Record<string, string | string[]>;
    userParamValues?: Record<string, string | number | boolean>;
  },
): FalToolboxRunPayload {
  const payload: Record<string, unknown> = {};
  const mediaFields: FalToolboxMediaField[] = [];

  for (const input of tool.inputSchema) {
    const value = options.inputValues[input.key];
    if (hasValue(value)) setPayloadValue(payload, input.key, value);
    if ((input.kind === 'image' || input.kind === 'video' || input.kind === 'audio') && hasValue(value)) {
      mediaFields.push({
        key: input.key,
        kind: input.kind,
        multiple: input.multiple === true,
        upload: input.upload !== false,
        mediaMode: input.mediaMode === 'base64' ? 'base64' : 'url',
      });
    }
  }

  for (const param of tool.userParams || []) {
    if (!userParamConditionMatches(param.when, tool.userParams, options.userParamValues)) continue;
    const value = options.userParamValues?.[param.key] ?? param.defaultValue;
    if (isOmittedParamValue(value, param.omitValues)) continue;
    if (hasValue(value) || param.kind === 'boolean') setPayloadValue(payload, param.payloadKey || param.key, parseJsonParamValue(param, value ?? ''));
  }

  for (const fixed of tool.fixedParams || []) {
    setPayloadValue(payload, fixed.key, fixed.value);
  }

  return {
    toolId: tool.id,
    title: tool.title,
    endpoint: tool.endpoint,
    payload,
    mediaFields,
    outputSchema: tool.outputSchema,
    statusPath: tool.runtime?.statusPath,
  };
}

export function classifyFalToolboxOutputs(input: {
  urls?: string[];
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  modelUrls?: string[];
  textOutputs?: string[];
  texts?: string[];
}): FalToolboxOutputClassification {
  const imageUrls = new Set<string>(input.imageUrls || []);
  const videoUrls = new Set<string>(input.videoUrls || []);
  const audioUrls = new Set<string>(input.audioUrls || []);
  const modelUrls = new Set<string>(input.modelUrls || []);
  const urls = new Set<string>(input.urls || []);

  for (const raw of input.urls || []) {
    const url = String(raw || '').trim();
    if (!url) continue;
    if (IMAGE_RE.test(url)) imageUrls.add(url);
    else if (VIDEO_RE.test(url)) videoUrls.add(url);
    else if (AUDIO_RE.test(url)) audioUrls.add(url);
    else if (MODEL_RE.test(url)) modelUrls.add(url);
  }
  for (const url of [...imageUrls, ...videoUrls, ...audioUrls, ...modelUrls]) urls.add(url);

  return {
    urls: Array.from(urls),
    imageUrls: Array.from(imageUrls),
    videoUrls: Array.from(videoUrls),
    audioUrls: Array.from(audioUrls),
    modelUrls: Array.from(modelUrls),
    textOutputs: Array.from(new Set([...(input.textOutputs || []), ...(input.texts || [])].filter(Boolean))),
  };
}
