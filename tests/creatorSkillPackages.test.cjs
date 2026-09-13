'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yazl = require('yazl');
const {
  SKILL_LIMITS, CreatorSkillError, safeSkillPath, buildSkillPackage,
  verifySkillPackage, readSkillZip, readSkillDirectory, skillContextResources,
} = require('../backend/src/services/creatorSkillPackages');

const source = '---\nname: product-story\ndescription: Turn a product brief into a clear creative prompt.\nmetadata:\n  version: "1.0"\n---\nKeep the supplied product facts. Ask only for missing essentials.\n';
const entry = (filename, value) => ({ path: filename, bytes: Buffer.isBuffer(value) ? value : Buffer.from(value) });
const matches = (code) => (error) => error instanceof CreatorSkillError && error.code === code;
async function zipFiles(files, options = {}) {
  const zip = new yazl.ZipFile();
  files.forEach((file) => zip.addBuffer(file.bytes, file.path, options));
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('standard SKILL.md is loaded without a private manifest or executable authority', () => {
  const pack = buildSkillPackage([entry('SKILL.md', source)]);
  assert.equal(pack.metadata.name, 'product-story');
  assert.equal(pack.metadata.declaredVersion, '1.0');
  assert.equal(pack.compatibility, 'text-only');
  assert.equal(pack.body, 'Keep the supplied product facts. Ask only for missing essentials.');
  assert.equal(Buffer.from(pack.files[0].content, 'base64').toString(), source);
  assert.deepEqual(pack, verifySkillPackage(JSON.parse(JSON.stringify(pack))));
  assert.match(pack.packageDigest, /^[a-f0-9]{64}$/);
});

test('package identity covers every original byte and is independent of upload order', () => {
  const files = [entry('SKILL.md', `${source}\nRead [style](references/style.md).`), entry('references/style.md', 'Use a restrained style.')];
  const pack = buildSkillPackage(files);
  assert.equal(buildSkillPackage([...files].reverse()).packageDigest, pack.packageDigest);
  assert.notEqual(buildSkillPackage([files[0], entry('references/style.md', 'A different style.')]).packageDigest, pack.packageDigest);
  assert.equal(skillContextResources(pack).resources[0].text, 'Use a restrained style.');
});

test('all bundled files survive one enclosing skill folder without accepting sibling payloads', () => {
  const pack = buildSkillPackage([entry('product-story/SKILL.md', source), entry('product-story/assets/example.png', Buffer.from([137,80,78,71]))]);
  assert.deepEqual(pack.files.map(f => f.path), ['SKILL.md', 'assets/example.png']);
  assert.throws(() => buildSkillPackage([entry('product-story/SKILL.md', source), entry('sibling.txt', 'not part of package')]), matches('CREATOR_SKILL_ROOT_INVALID'));
});

test('declared tools, script sources and external URLs remain non-executable references', () => {
  const body = source.replace('metadata:', 'allowed-tools: Bash Read\nmetadata:') + '\nRun scripts/process.py, then [upload](https://example.invalid/upload).\n';
  const pack = buildSkillPackage([entry('SKILL.md', body), entry('scripts/process.py', 'raise Exception("must not execute")')]);
  assert.equal(pack.compatibility, 'reference-only');
  assert.ok(pack.diagnostics.some(item => item.code === 'scripts-retained'));
  assert.ok(pack.diagnostics.some(item => item.code === 'external-tools'));
  assert.ok(pack.diagnostics.some(item => item.code === 'external-resource'));
  assert.deepEqual(skillContextResources(pack).resources, []);
});

test('missing or escaping required references never become a compatible complete package', () => {
  const pack = buildSkillPackage([entry('SKILL.md', source + '\nRead [brief](references/brief.md) and [private](../../private.txt).')]);
  assert.equal(pack.compatibility, 'reference-only');
  assert.ok(pack.diagnostics.some(item => item.code === 'missing-resource'));
  assert.ok(pack.diagnostics.some(item => item.code === 'unsafe-reference'));
});

test('reference cycles are bounded and context includes each referenced text resource once', () => {
  const pack = buildSkillPackage([
    entry('SKILL.md', source + '\n[a](references/a.md)'),
    entry('references/a.md', '[b](b.md)'), entry('references/b.md', '[a](a.md)'),
  ]);
  assert.equal(skillContextResources(pack).resources.length, 2);
});

test('unreachable bundled documents are retained but cannot inject unrelated context', () => {
  const pack = buildSkillPackage([
    entry('SKILL.md', source + '\n[guide](references/guide.md)'), entry('references/guide.md', 'Relevant guide.'),
    entry('references/unrelated.md', '[huge](huge.md)'), entry('references/huge.md', 'x'.repeat(SKILL_LIMITS.contextBytes)),
  ]);
  assert.equal(pack.files.length, 4);
  assert.deepEqual(skillContextResources(pack).resources.map(file => file.path), ['references/guide.md']);
});

test('required binary references remain explicitly unsupported until a real context adapter reads them', () => {
  const pack = buildSkillPackage([entry('SKILL.md', source + '\n![example](assets/example.png)'), entry('assets/example.png', Buffer.from([137,80,78,71]))]);
  assert.equal(pack.compatibility, 'reference-only');
  assert.equal(skillContextResources(pack).diagnostics[0].code, 'resource-adapter-required');
});

test('context never truncates required resource contents to report success', () => {
  const pack = buildSkillPackage([entry('SKILL.md', source + '\n[reference](references/large.md)'), entry('references/large.md', 'x'.repeat(SKILL_LIMITS.contextBytes))]);
  assert.throws(() => skillContextResources(pack), matches('CREATOR_SKILL_CONTEXT_TOO_LARGE'));
});

for (const filename of ['../SKILL.md', '/SKILL.md', 'C:/SKILL.md', 'a\\SKILL.md', 'a/../SKILL.md', 'a//b.md', 'a/CON.txt', 'aux.md', 'a.md:secret', 'a./b.md', 'a /b.md', 'a\u0000.md', 'a/<b>.md']) {
  test(`reject unsafe portable path ${JSON.stringify(filename)}`, () => {
    assert.throws(() => safeSkillPath(filename), matches('CREATOR_SKILL_PATH_INVALID'));
  });
}

test('reject case collisions, file/directory collisions, excessive path depth and unsupported executables', () => {
  assert.throws(() => buildSkillPackage([entry('SKILL.md', source), entry('skill.md', source)]), matches('CREATOR_SKILL_PATH_COLLISION'));
  assert.throws(() => buildSkillPackage([entry('SKILL.md', source), entry('a.md', 'x'), entry('a.md/b.txt', 'y')]), matches('CREATOR_SKILL_PATH_COLLISION'));
  assert.throws(() => safeSkillPath('a/'.repeat(SKILL_LIMITS.depth) + 'x.md'), matches('CREATOR_SKILL_PATH_INVALID'));
  assert.throws(() => buildSkillPackage([entry('SKILL.md', source), entry('tool.exe', 'x')]), matches('CREATOR_SKILL_FILE_TYPE'));
});

test('reject malformed YAML, duplicate metadata keys, invalid UTF-8 and oversized metadata', () => {
  for (const text of ['# no frontmatter', source.replace('product-story', 'Invalid Name'), source.replace('description:', 'name: duplicate\ndescription:'), source.replace('metadata:', 'x: !<tag:yaml.org,2002:js/function> "function(){}"\nmetadata:')]) {
    assert.throws(() => buildSkillPackage([entry('SKILL.md', text)]), matches('CREATOR_SKILL_METADATA_INVALID'));
  }
  assert.throws(() => buildSkillPackage([entry('SKILL.md', Buffer.from([0xff,0xfe]))]), matches('CREATOR_SKILL_TEXT_INVALID'));
  assert.throws(() => buildSkillPackage([entry('SKILL.md', source + 'x'.repeat(SKILL_LIMITS.instructionBytes))]), matches('CREATOR_SKILL_TOO_LARGE'));
});

test('stored claims cannot upgrade untrusted compatibility; byte tampering fails', () => {
  const pack = buildSkillPackage([entry('SKILL.md', source)]);
  assert.equal(verifySkillPackage({ ...pack, compatibility: 'all-tools', metadata: { name: 'trusted-official' } }).metadata.name, 'product-story');
  const changed = JSON.parse(JSON.stringify(pack));
  changed.files[0].content = Buffer.from(source + 'modified').toString('base64');
  assert.throws(() => verifySkillPackage(changed), matches('CREATOR_SKILL_INTEGRITY'));
  assert.throws(() => verifySkillPackage({ ...pack, packageDigest: 'a'.repeat(64) }), matches('CREATOR_SKILL_INTEGRITY'));
});

test('maximum-size binary resource verifies without a recursive base64 regex or decoding loss', () => {
  const pack = buildSkillPackage([entry('SKILL.md', source), entry('assets/example.png', Buffer.alloc(SKILL_LIMITS.fileBytes, 137))]);
  assert.equal(verifySkillPackage(pack).totalBytes, Buffer.byteLength(source) + SKILL_LIMITS.fileBytes);
});

test('ZIP import is memory-bounded, preserves bytes and verifies CRC', async () => {
  const files = [entry('product-story/SKILL.md', source), entry('product-story/references/guide.md', 'Reference facts.')];
  const zipped = await zipFiles(files, { compress: false });
  assert.deepEqual(await readSkillZip(zipped), buildSkillPackage(files));
  const corrupted = Buffer.from(zipped);
  const at = corrupted.indexOf(Buffer.from('Reference facts.'));
  assert.ok(at > 0);
  corrupted[at] ^= 1;
  await assert.rejects(readSkillZip(corrupted), matches('CREATOR_SKILL_ZIP_INVALID'));
  await assert.rejects(readSkillZip(Buffer.from('not a zip')), matches('CREATOR_SKILL_ZIP_INVALID'));
});

test('ZIP rejects symlinks, duplicate names and excessive expansion', async () => {
  await assert.rejects(readSkillZip(await zipFiles([entry('SKILL.md', source)], { mode: 0o120777 })), matches('CREATOR_SKILL_LINK_UNSUPPORTED'));
  await assert.rejects(readSkillZip(await zipFiles([entry('SKILL.md', source), entry('SKILL.md', source)])), matches('CREATOR_SKILL_PATH_COLLISION'));
  const large = await zipFiles([entry('SKILL.md', source), entry('large.txt', Buffer.alloc(SKILL_LIMITS.fileBytes + 1))]);
  await assert.rejects(readSkillZip(large), matches('CREATOR_SKILL_TOO_LARGE'));
});

test('ZIP hostile relative path is rejected before any filesystem extraction', async () => {
  const zipped = await zipFiles([entry('aa/SKILL.md', source)], { compress: false });
  const modified = Buffer.from(zipped);
  let index = modified.indexOf(Buffer.from('aa/SKILL.md'));
  while (index >= 0) {
    modified.write('../SKILL.md', index);
    index = modified.indexOf(Buffer.from('aa/SKILL.md'), index + 1);
  }
  await assert.rejects(readSkillZip(modified), error => error instanceof CreatorSkillError);
});

test('local directory import snapshots files and rejects directory junctions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-skill-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'skill');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), source);
  assert.equal(readSkillDirectory(sourceDir).metadata.name, 'product-story');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(sourceDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readSkillDirectory(sourceDir), matches('CREATOR_SKILL_LINK_UNSUPPORTED'));
});
