import type { CreatorInstalledSkillV2, CreatorSkillBindingV2, CreatorSkillSelectionV2 } from './creatorAgentV2';

export interface CreatorComposerSkillV2 extends CreatorSkillSelectionV2 {
  title: string;
  version: string;
  referenceOnly: boolean;
}

export function normalizeCreatorComposerSkill(value: unknown): CreatorComposerSkillV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Partial<CreatorComposerSkillV2>;
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/u.test(input.id)
    || typeof input.taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/u.test(input.taskId)
    || typeof input.packageDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(input.packageDigest)
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120
    || typeof input.version !== 'string' || !input.version.trim() || input.version.length > 80) return null;
  return { id: input.id, packageDigest: input.packageDigest, taskId: input.taskId,
    title: input.title, version: input.version, referenceOnly: input.referenceOnly === true };
}

export function creatorComposerSkillFromItem(item: CreatorInstalledSkillV2, taskId: string): CreatorComposerSkillV2 | null {
  if (item.status !== 'active' || ['unavailable', 'revoked'].includes(item.compatibility)) return null;
  return normalizeCreatorComposerSkill({ id: item.id, packageDigest: item.packageDigest, taskId,
    title: item.title, version: item.version, referenceOnly: item.compatibility === 'reference-only' });
}

export function creatorComposerSkillFromBinding(binding?: CreatorSkillBindingV2): CreatorComposerSkillV2 | null {
  return binding ? normalizeCreatorComposerSkill({ ...binding.selection, title: binding.title,
    version: binding.version, referenceOnly: binding.referenceOnly }) : null;
}
