'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const yaml = require('js-yaml');
const yauzl = require('yauzl');

const SKILL_PACKAGE_SCHEMA = 't8-creator-skill-package-v1';
const SKILL_LIMITS = Object.freeze({
  files: 128,
  depth: 8,
  path: 240,
  compressedBytes: 8 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  fileBytes: 4 * 1024 * 1024,
  instructionBytes: 64 * 1024,
  frontmatterBytes: 16 * 1024,
  contextBytes: 192 * 1024,
});
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv']);
const RESOURCE_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS, '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf',
  // Retained as source only. Importing these NEVER registers executable tools.
  '.py', '.js', '.cjs', '.mjs', '.sh', '.ps1', '.ts',
]);
const CODE_EXTENSIONS = new Set(['.py', '.js', '.cjs', '.mjs', '.sh', '.ps1', '.ts']);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

class CreatorSkillError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'CreatorSkillError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) { throw new CreatorSkillError(code, message, status); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function safeSkillPath(value) {
  if (typeof value !== 'string' || !value || value.length > SKILL_LIMITS.path
    || /[\\\u0000-\u001f\u007f<>:"|?*]/u.test(value) || value.startsWith('/')) {
    fail('CREATOR_SKILL_PATH_INVALID', '技能包中包含不安全的文件路径');
  }
  const parts = value.split('/');
  if (parts.length > SKILL_LIMITS.depth || parts.some((part) => !part || part === '.' || part === '..'
    || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part))) {
    fail('CREATOR_SKILL_PATH_INVALID', '技能包路径越界、过深或不兼容');
  }
  return parts.join('/').normalize('NFC');
}

function decodeText(bytes) {
  try {
    const result = utf8.decode(bytes);
    if (result.includes('\u0000')) fail('CREATOR_SKILL_TEXT_INVALID', '技能文本包含无效字符');
    return result;
  } catch (error) {
    if (error instanceof CreatorSkillError) throw error;
    fail('CREATOR_SKILL_TEXT_INVALID', '技能文本必须为有效 UTF-8');
  }
}

function parseSkillInstructions(bytes) {
  if (bytes.length > SKILL_LIMITS.instructionBytes) fail('CREATOR_SKILL_TOO_LARGE', '技能说明过长，请拆分参考资料后导入');
  const source = decodeText(bytes).replace(/^\uFEFF/u, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u);
  if (!match || Buffer.byteLength(match[1]) > SKILL_LIMITS.frontmatterBytes) {
    fail('CREATOR_SKILL_METADATA_INVALID', 'SKILL.md 需要有效的 YAML 名称和描述');
  }
  let metadata;
  try { metadata = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }); } catch (_) {
    fail('CREATOR_SKILL_METADATA_INVALID', '技能 YAML 无法解析，请检查名称和描述格式');
  }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object'
    || typeof metadata.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(metadata.name)
    || metadata.name.length > 64 || typeof metadata.description !== 'string'
    || !metadata.description.trim() || metadata.description.length > 1024 || !match[2].trim()) {
    fail('CREATOR_SKILL_METADATA_INVALID', '技能名称、描述或正文缺失/不兼容');
  }
  const stringField = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  return {
    name: metadata.name,
    description: metadata.description.trim(),
    license: stringField(metadata.license, 240),
    compatibility: stringField(metadata.compatibility, 500),
    declaredTools: stringField(metadata['allowed-tools'], 2000),
    declaredVersion: stringField(metadata.metadata?.version, 80),
    body: match[2].trim(),
  };
}

function validateFileEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > SKILL_LIMITS.files) {
    fail('CREATOR_SKILL_FILE_COUNT', '技能包为空或文件数量过多');
  }
  let total = 0;
  const seen = new Set();
  const result = entries.map((entry) => {
    const filename = safeSkillPath(entry?.path);
    const key = filename.toLowerCase();
    if (seen.has(key)) fail('CREATOR_SKILL_PATH_COLLISION', '技能包包含重复或大小写冲突的路径');
    seen.add(key);
    if (!Buffer.isBuffer(entry.bytes)) fail('CREATOR_SKILL_FILE_INVALID', '技能文件内容无效');
    const extension = path.posix.extname(filename).toLowerCase();
    if (!RESOURCE_EXTENSIONS.has(extension) && !/^(?:license|notice)(?:\.txt|\.md)?$/iu.test(path.posix.basename(filename))) {
      fail('CREATOR_SKILL_FILE_TYPE', '技能包包含暂不支持的文件类型');
    }
    total += entry.bytes.length;
    if (entry.bytes.length > SKILL_LIMITS.fileBytes || total > SKILL_LIMITS.totalBytes) {
      fail('CREATOR_SKILL_TOO_LARGE', '技能文件或解压后总体积超过限制');
    }
    if (TEXT_EXTENSIONS.has(extension) || CODE_EXTENSIONS.has(extension)) decodeText(entry.bytes);
    return { path: filename, bytes: Buffer.from(entry.bytes) };
  });
  // A file cannot also be an ancestor directory, including on Windows.
  for (const key of seen) {
    let parent = path.posix.dirname(key);
    while (parent !== '.') {
      if (seen.has(parent)) fail('CREATOR_SKILL_PATH_COLLISION', '技能包文件与目录名称冲突');
      parent = path.posix.dirname(parent);
    }
  }
  return result;
}

function buildSkillPackage(entries) {
  let files = validateFileEntries(entries);
  if (!files.some((file) => file.path === 'SKILL.md')) {
    const roots = files.filter((file) => file.path.endsWith('/SKILL.md'));
    if (roots.length !== 1) fail('CREATOR_SKILL_ROOT_INVALID', '请选择只包含一个主 SKILL.md 的完整技能目录');
    const prefix = roots[0].path.slice(0, -'SKILL.md'.length);
    if (files.some((file) => !file.path.startsWith(prefix))) fail('CREATOR_SKILL_ROOT_INVALID', '压缩包包含技能目录之外的文件');
    files = validateFileEntries(files.map((file) => ({ ...file, path: file.path.slice(prefix.length) })));
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const instructions = parseSkillInstructions(files.find((file) => file.path === 'SKILL.md').bytes);
  const inventory = files.map((file) => ({ path: file.path, size: file.bytes.length, sha256: hash(file.bytes) }));
  const packageDigest = hash(canonicalJson({ schema: SKILL_PACKAGE_SCHEMA, files: inventory }));
  const diagnostics = [];
  if (instructions.declaredTools) diagnostics.push({ code: 'external-tools', message: '声明的外部工具不会自动安装或执行' });
  if (files.some((file) => CODE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()))) {
    diagnostics.push({ code: 'scripts-retained', message: '包含脚本源码；本画布只保留，不执行' });
  }
  const paths = new Set(files.map((file) => file.path));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const referencedPaths = new Set();
  const queue = ['SKILL.md'];
  const visited = new Set();
  // Diagnostics improve author feedback; they are never an execution trust decision.
  // Follow only the selected Skill's reachable references; unrelated bundled
  // documents must not pollute context or exhaust its budget. Cycles are finite.
  while (queue.length) {
    const filename = queue.shift();
    if (visited.has(filename)) continue;
    visited.add(filename);
    const file = filesByPath.get(filename);
    if (!file || !TEXT_EXTENSIONS.has(path.posix.extname(filename).toLowerCase())) continue;
    const text = decodeText(file.bytes);
    const references = [...text.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/gu)].map((item) => item[1]);
    references.push(...[...text.matchAll(/(?:^|[\s`(])((?:references|assets|scripts)\/[\w./-]+)/gmu)].map((item) => item[1]));
    for (const raw of references) {
      if (raw.startsWith('#')) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(raw)) {
        diagnostics.push({ code: 'external-resource', message: '外部链接仅保留为文字，不自动访问' });
        continue;
      }
      let target;
      try {
        const decoded = decodeURIComponent(raw.split('#')[0]);
        if (path.posix.isAbsolute(decoded)) throw new Error('absolute reference');
        const relative = path.posix.join(path.posix.dirname(file.path), decoded);
        target = safeSkillPath(relative);
      } catch (_) {
        diagnostics.push({ code: 'unsafe-reference', message: '参考资料路径越界或不兼容' });
        continue;
      }
      referencedPaths.add(target);
      if (!paths.has(target)) diagnostics.push({ code: 'missing-resource', message: `缺少包内参考资料：${target}` });
      else {
        const extension = path.posix.extname(target).toLowerCase();
        if (TEXT_EXTENSIONS.has(extension)) queue.push(target);
        else if (!CODE_EXTENSIONS.has(extension)) diagnostics.push({
          code: 'resource-adapter-required', message: `当前文本上下文尚不能读取此参考资料：${target}`,
        });
      }
    }
  }
  const uniqueDiagnostics = [...new Map(diagnostics.map((item) => [`${item.code}:${item.message}`, item])).values()];
  const { body, ...metadata } = instructions;
  return {
    schema: SKILL_PACKAGE_SCHEMA,
    packageDigest,
    metadata,
    body,
    referencedPaths: [...referencedPaths].sort(),
    diagnostics: uniqueDiagnostics,
    // Even apparently pure instructions are unverified, text-only imports.
    // No regex result or package-authored manifest can grant media tools.
    compatibility: uniqueDiagnostics.length ? 'reference-only' : 'text-only',
    totalBytes: inventory.reduce((sum, file) => sum + file.size, 0),
    files: files.map((file, index) => ({ ...inventory[index], content: file.bytes.toString('base64') })),
  };
}

function verifySkillPackage(record) {
  if (record?.schema !== SKILL_PACKAGE_SCHEMA || !/^[a-f0-9]{64}$/u.test(record.packageDigest || '')
    || !Array.isArray(record.files) || record.files.length > SKILL_LIMITS.files) {
    fail('CREATOR_SKILL_INTEGRITY', '技能包记录损坏，请重新导入');
  }
  const entries = record.files.map((file) => {
    if (typeof file.content !== 'string' || file.content.length > Math.ceil(SKILL_LIMITS.fileBytes / 3) * 4) {
      fail('CREATOR_SKILL_INTEGRITY', '技能文件编码损坏');
    }
    const bytes = Buffer.from(file.content, 'base64');
    if (bytes.toString('base64') !== file.content || bytes.length !== file.size || hash(bytes) !== file.sha256) {
      fail('CREATOR_SKILL_INTEGRITY', '技能资源内容校验失败');
    }
    return { path: file.path, bytes };
  });
  const rebuilt = buildSkillPackage(entries);
  if (rebuilt.packageDigest !== record.packageDigest) fail('CREATOR_SKILL_INTEGRITY', '技能包内容已变化');
  // Always rederive metadata and compatibility. Stored claims are not authority.
  return rebuilt;
}

async function readSkillZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > SKILL_LIMITS.compressedBytes) {
    fail('CREATOR_SKILL_TOO_LARGE', '技能压缩包超过大小限制');
  }
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(new CreatorSkillError('CREATOR_SKILL_ZIP_INVALID', '无法读取技能 ZIP 文件'));
      let settled = false;
      let total = 0;
      let entryCount = 0;
      const files = [];
      const paths = new Set();
      const stop = (reason) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(reason instanceof CreatorSkillError ? reason : new CreatorSkillError('CREATOR_SKILL_ZIP_INVALID', '技能 ZIP 损坏或不兼容'));
      };
      zip.on('error', stop);
      zip.on('entry', (entry) => {
        try {
          if (++entryCount > SKILL_LIMITS.files * 2) fail('CREATOR_SKILL_FILE_COUNT', '技能压缩包条目过多');
          if (entry.generalPurposeBitFlag & 1) fail('CREATOR_SKILL_ZIP_INVALID', '不支持加密的技能压缩包');
          const directory = entry.fileName.endsWith('/');
          const filename = safeSkillPath(directory ? entry.fileName.slice(0, -1) : entry.fileName);
          const key = filename.toLowerCase();
          if (paths.has(key)) fail('CREATOR_SKILL_PATH_COLLISION', '技能压缩包包含重复路径');
          paths.add(key);
          const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (fileType && fileType !== (directory ? 0x4000 : 0x8000)) fail('CREATOR_SKILL_LINK_UNSUPPORTED', '技能压缩包不允许链接或特殊设备');
          if (directory) { zip.readEntry(); return; }
          if (files.length >= SKILL_LIMITS.files || entry.uncompressedSize > SKILL_LIMITS.fileBytes
            || total + entry.uncompressedSize > SKILL_LIMITS.totalBytes) fail('CREATOR_SKILL_TOO_LARGE', '技能解压体积或文件数超过限制');
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError) { stop(streamError); return; }
            let size = 0;
            const chunks = [];
            stream.on('error', stop);
            stream.on('data', (chunk) => {
              size += chunk.length;
              if (size > SKILL_LIMITS.fileBytes || total + size > SKILL_LIMITS.totalBytes) {
                stream.destroy();
                stop(new CreatorSkillError('CREATOR_SKILL_TOO_LARGE', '技能解压体积超过限制'));
              } else chunks.push(chunk);
            });
            stream.on('end', () => {
              if (settled) return;
              if (size !== entry.uncompressedSize) { stop(new Error('entry size mismatch')); return; }
              const bytes = Buffer.concat(chunks);
              if (crc32(bytes) !== entry.crc32) { stop(new Error('entry CRC mismatch')); return; }
              total += size;
              files.push({ path: filename, bytes });
              zip.readEntry();
            });
          });
        } catch (entryError) { stop(entryError); }
      });
      zip.on('end', () => {
        if (settled) return;
        try { const pack = buildSkillPackage(files); settled = true; resolve(pack); } catch (buildError) { stop(buildError); }
      });
      zip.readEntry();
    });
  });
}

function readSkillDirectory(directory) {
  // Local callers only: never expose a client-supplied host path in an HTTP API.
  const root = path.resolve(directory);
  const canonicalRoot = fs.realpathSync.native(root);
  const entries = [];
  let total = 0;
  let entryCount = 0;
  const walk = (current, relative) => {
    if (++entryCount > SKILL_LIMITS.files * 2 + 1) fail('CREATOR_SKILL_FILE_COUNT', '技能目录条目过多');
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail('CREATOR_SKILL_LINK_UNSUPPORTED', '技能目录不允许符号链接或目录联接');
    const canonical = fs.realpathSync.native(current);
    const location = path.relative(canonicalRoot, canonical);
    if (location === '..' || location.startsWith(`..${path.sep}`) || path.isAbsolute(location)) {
      fail('CREATOR_SKILL_PATH_INVALID', '技能目录路径已变化');
    }
    if (relative) safeSkillPath(relative);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current)) walk(path.join(current, name), relative ? `${relative}/${name}` : name);
    } else if (stat.isFile()) {
      total += stat.size;
      if (entries.length >= SKILL_LIMITS.files || stat.size > SKILL_LIMITS.fileBytes || total > SKILL_LIMITS.totalBytes) {
        fail('CREATOR_SKILL_TOO_LARGE', '技能目录超过体积或数量限制');
      }
      const fd = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        const actual = fs.fstatSync(fd);
        if (!actual.isFile() || actual.dev !== stat.dev || actual.ino !== stat.ino || actual.size !== stat.size) {
          fail('CREATOR_SKILL_FILE_INVALID', '技能文件在导入过程中发生变化');
        }
        const bytes = Buffer.alloc(actual.size);
        let offset = 0;
        while (offset < bytes.length) {
          const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
          if (!read) fail('CREATOR_SKILL_FILE_INVALID', '技能文件未完整读取');
          offset += read;
        }
        entries.push({ path: relative, bytes });
      } finally { fs.closeSync(fd); }
    } else fail('CREATOR_SKILL_FILE_INVALID', '技能目录包含特殊文件');
  };
  walk(root, '');
  return buildSkillPackage(entries);
}

function skillContextResources(pack) {
  const verified = verifySkillPackage(pack);
  const resources = verified.files.filter((file) => file.path !== 'SKILL.md'
    && verified.referencedPaths.includes(file.path) && TEXT_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()))
    .map((file) => ({ path: file.path, sha256: file.sha256, text: decodeText(Buffer.from(file.content, 'base64')) }));
  const bytes = Buffer.byteLength(verified.body) + resources.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0);
  if (bytes > SKILL_LIMITS.contextBytes) fail('CREATOR_SKILL_CONTEXT_TOO_LARGE', '技能必需资料超出当前上下文范围，需要适配，未截断执行');
  return { body: verified.body, resources, diagnostics: verified.diagnostics,
    contextDigest: hash(canonicalJson({ packageDigest: verified.packageDigest, resources })) };
}

module.exports = {
  SKILL_PACKAGE_SCHEMA, SKILL_LIMITS, CreatorSkillError, hash, canonicalJson,
  safeSkillPath, parseSkillInstructions, buildSkillPackage, verifySkillPackage,
  readSkillZip, readSkillDirectory, skillContextResources,
};
