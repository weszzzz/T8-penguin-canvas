import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeCreatorComposerSkill, creatorComposerSkillFromBinding, creatorComposerSkillFromItem } from '../src/services/creatorSkillComposer';
import type { CreatorInstalledSkillV2, CreatorSkillBindingV2 } from '../src/services/creatorAgentV2';

const item: CreatorInstalledSkillV2 = { id: 'private:test', packageDigest: 'a'.repeat(64), title: '商品提示词', version: '1', origin: 'private', status: 'active', compatibility: 'text-only', diagnostics: [], quality: { status: 'unverified' } };
const panel = readFileSync(new URL('../src/components/CreatorAgentPanelV2.tsx', import.meta.url), 'utf8');
const market = readFileSync(new URL('../src/components/CreatorSkillMarket.tsx', import.meta.url), 'utf8');

test('composer skill records only a fixed task selection and rejects damaged saved drafts', () => {
  const selected = creatorComposerSkillFromItem(item, 'task-1');
  assert.ok(selected);
  assert.deepEqual(normalizeCreatorComposerSkill({ ...selected, apiKey: 'must-not-copy', instructions: 'must-not-copy' }), selected);
  assert.equal(normalizeCreatorComposerSkill({ ...selected, packageDigest: 'wrong' }), null);
  assert.equal(normalizeCreatorComposerSkill({ ...selected, taskId: '' }), null);
  assert.equal(normalizeCreatorComposerSkill(null), null);
});

test('unavailable installed entries cannot be prepared as runnable skills', () => {
  assert.equal(creatorComposerSkillFromItem({ ...item, status: 'disabled' }, 'task-1'), null);
  assert.equal(creatorComposerSkillFromItem({ ...item, compatibility: 'revoked' }, 'task-1'), null);
  assert.equal(creatorComposerSkillFromItem({ ...item, compatibility: 'unavailable' }, 'task-1'), null);
  assert.equal(creatorComposerSkillFromItem({ ...item, compatibility: 'reference-only' }, 'task-1')?.referenceOnly, true);
});

test('continuing an existing work keeps the exact old task and package rather than selecting latest', () => {
  const selected = creatorComposerSkillFromItem(item, 'old-task')!;
  const binding = { selection: selected, title: selected.title, version: selected.version, referenceOnly: false } as CreatorSkillBindingV2;
  assert.deepEqual(creatorComposerSkillFromBinding(binding), selected);
  assert.equal(creatorComposerSkillFromBinding(undefined), null);
  assert.notEqual(creatorComposerSkillFromItem(item, 'new-task')?.taskId, selected.taskId);
});

test('panel preserves skill draft scope and restores it only for explicitly linked continuations', () => {
  assert.match(panel, /skill: normalizeCreatorComposerSkill\(source.skill\)/);
  assert.match(panel, /setSelectedSkill\(restored.skill\)/);
  assert.match(panel, /skill: turnSkill \? \{ id: turnSkill.id, packageDigest: turnSkill.packageDigest, taskId: turnSkill.taskId \}/);
  assert.match(panel, /if \(!preserveComposer\) \{[\s\S]*?setSelectedSkill\(null\)/);
  assert.match(panel, /skill: creatorComposerSkillFromBinding\(latestAssistant\?\.skillBinding\)/);
  assert.match(panel, /setSelectedSkill\(creatorComposerSkillFromBinding\(user.skillBinding\)\)/);
  assert.match(panel, /<pre tabIndex=\{0\}[^>]*>\{message.skillOutput.body\}<\/pre>/);
});

test('market is an explicit independent import surface with bounded discovery and no generation API', () => {
  assert.doesNotMatch(market, /sendCreatorMessage|confirmCreatorAction|dangerouslySetInnerHTML|window\.open/);
  assert.match(market, /filtered.slice\(0, limit\)/);
  assert.match(market, /Promise.allSettled/);
  assert.match(market, /readAbort.current\?\.abort\(\)/);
  assert.match(market, /uploadAbort.current\?\.abort\(\)/);
  assert.match(market, /role="dialog" aria-modal="true"/);
  assert.match(market, /event.stopPropagation\(\)/);
  assert.match(market, /if \(!alive.current\) return/);
  assert.match(market, /<pre>\{detail.instructions\}<\/pre>/);
  assert.match(market, /const latest = await prepareCreatorSkillV2/);
  assert.match(market, /new MutationObserver\(cover\)/);
  assert.match(market, /element.inert = wasInert/);
  assert.match(market, /tabIndex=\{tab === value \? 0 : -1\}/);
});
