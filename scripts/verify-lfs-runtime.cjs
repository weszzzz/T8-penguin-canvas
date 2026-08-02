'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'pointer-stdin') {
      args.pointerStdin = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function parseLfsPointer(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  const version = lines.find((line) => line.startsWith('version '));
  const oid = lines.find((line) => line.startsWith('oid sha256:'));
  const size = lines.find((line) => line.startsWith('size '));
  if (!version || !oid || !size) throw new Error('not a complete Git LFS pointer');
  return {
    version: version.slice('version '.length).trim(),
    oid: oid.slice('oid sha256:'.length).trim().toLowerCase(),
    size: Number(size.slice('size '.length).trim()),
  };
}

function verifyLfsPointer(text, expected) {
  const pointer = parseLfsPointer(text);
  const expectedOid = String(expected.oid || '').toLowerCase();
  const expectedSize = Number(expected.size);
  if (pointer.oid !== expectedOid) {
    throw new Error(`LFS pointer oid mismatch: expected ${expectedOid}, got ${pointer.oid}`);
  }
  if (pointer.size !== expectedSize) {
    throw new Error(`LFS pointer size mismatch: expected ${expectedSize}, got ${pointer.size}`);
  }
  return pointer;
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function verifyRuntimeFile(filePath, expected) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`runtime is not a regular file: ${filePath}`);
  const expectedSize = Number(expected.size);
  const expectedOid = String(expected.oid || '').toLowerCase();
  if (stat.size !== expectedSize) {
    throw new Error(`runtime size mismatch: expected ${expectedSize}, got ${stat.size}`);
  }
  const actualOid = hashFile(filePath);
  if (actualOid !== expectedOid) {
    throw new Error(`runtime sha256 mismatch: expected ${expectedOid}, got ${actualOid}`);
  }
  return { size: stat.size, oid: actualOid };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const expected = { oid: args.oid, size: args.size };
  if (!expected.oid || !expected.size) throw new Error('--oid and --size are required');
  if (args.pointerStdin) verifyLfsPointer(fs.readFileSync(0, 'utf8'), expected);
  if (args.file) verifyRuntimeFile(args.file, expected);
  if (!args.pointerStdin && !args.file) throw new Error('--pointer-stdin or --file is required');
  console.log(`[lfs-runtime] verified oid=${expected.oid} size=${expected.size}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[lfs-runtime] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseLfsPointer,
  verifyLfsPointer,
  verifyRuntimeFile,
};
