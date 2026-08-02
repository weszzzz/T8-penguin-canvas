'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseLfsPointer,
  verifyLfsPointer,
  verifyRuntimeFile,
} = require('../scripts/verify-lfs-runtime.cjs');

const bytes = Buffer.from('runtime fixture');
const oid = crypto.createHash('sha256').update(bytes).digest('hex');
const size = bytes.length;
const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

assert.deepEqual(parseLfsPointer(pointer), {
  version: 'https://git-lfs.github.com/spec/v1',
  oid,
  size,
});
assert.deepEqual(verifyLfsPointer(pointer, { oid, size }), { version: 'https://git-lfs.github.com/spec/v1', oid, size });
assert.throws(() => verifyLfsPointer(pointer, { oid: '0'.repeat(64), size }), /oid mismatch/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-lfs-runtime-'));
const filePath = path.join(tempDir, 'runtime.bin');
fs.writeFileSync(filePath, bytes);
assert.deepEqual(verifyRuntimeFile(filePath, { oid, size }), { oid, size });
fs.rmSync(tempDir, { recursive: true, force: true });

console.log('verifyLfsRuntime.test.cjs: ok');
