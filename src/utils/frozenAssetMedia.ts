import type { AssetRef } from '../types/project';

/** A version guard, not a bearer capability. The host still owns permission,
 * availability and physical-byte checks on every read (including after restart). */
export function frozenAssetMediaUrl(asset: Pick<AssetRef, 'id' | 'projectId' | 'entityUid' | 'contentHash'>, referenceSlot?: number): string {
  if (!asset.id || !asset.projectId || asset.projectId.length > 240
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(asset.entityUid || '')
    || !/^[a-f0-9]{64}$/.test(asset.contentHash || '')) throw new Error('素材缺少可验证的固定版本，不能恢复引用');
  const query = new URLSearchParams({ projectId: asset.projectId, entityUid: asset.entityUid!, contentHash: asset.contentHash! });
  if (referenceSlot !== undefined) {
    if (!Number.isSafeInteger(referenceSlot) || referenceSlot < 0 || referenceSlot > 99) throw new Error('历史参考顺序超出范围');
    query.set('referenceSlot', String(referenceSlot));
  }
  return `/api/project-assets/${encodeURIComponent(asset.id)}/media?${query}`;
}
