'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  CreatorSkillError, verifySkillPackage, canonicalJson, hash, skillContextResources,
} = require('./creatorSkillPackages');
const { normalizeSkillContract } = require('./creatorSkillContracts');

const STORE_SCHEMA = 't8-creator-skill-library-v1';
const CATALOG_SCHEMA = 't8-creator-skill-catalog-v1';
const MAX_RECORD_BYTES = 24 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGES = 128;
const MAX_COMMITS = 2048;

function error(code, message, status = 409) { throw new CreatorSkillError(code, message, status); }
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/u.test(value)) {
    error('CREATOR_SKILL_SCOPE_INVALID', '技能所属身份或项目无效', 400);
  }
  return value;
}
function digestValue(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) error('CREATOR_SKILL_DIGEST_INVALID', '技能版本指纹无效', 400);
  return value;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function readJson(filename, maxBytes) {
  let fd;
  try {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes) throw new Error('unsafe file');
    fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) throw new Error('changed file');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error('short read');
      offset += count;
    }
    return JSON.parse(bytes.toString('utf8'));
  } catch (cause) {
    if (cause.code === 'ENOENT') throw cause;
    error('CREATOR_SKILL_STORE_INVALID', '技能库记录损坏或不可安全读取，请保留文件并重新导入');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// Publish an immutable, fully flushed object without overwriting a concurrent
// winner. Crash leftovers are ignored staging files, never a stale global lock.
function publishObject(filename, value, beforePublish) {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (beforePublish) beforePublish();
    fs.linkSync(temporary, filename);
    return true;
  } catch (cause) {
    if (cause.code === 'EEXIST') return false;
    throw cause;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
  }
}

function verifyCatalog(envelope, trustedKeys, minimumRevision = 0) {
  const manifest = envelope?.manifest;
  const pem = trustedKeys?.[envelope?.keyId];
  if (!pem || manifest?.schema !== CATALOG_SCHEMA || !Number.isSafeInteger(manifest.revision)
    || manifest.revision < minimumRevision || !Array.isArray(manifest.skills) || manifest.skills.length > 128
    || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/u.test(envelope.signature)) {
    error('CREATOR_SKILL_CATALOG_UNTRUSTED', '技能目录来源或版本无法验证');
  }
  let verified = false;
  try {
    const key = crypto.createPublicKey(pem);
    verified = key.asymmetricKeyType === 'ed25519'
      && crypto.verify(null, Buffer.from(canonicalJson(manifest)), key, Buffer.from(envelope.signature, 'base64'));
  } catch (_) { /* Untrusted public keys never become a fallback trust root. */ }
  if (!verified) error('CREATOR_SKILL_CATALOG_UNTRUSTED', '技能目录签名校验失败');
  const ids = new Set();
  for (const item of manifest.skills) {
    identifier(item.id);
    digestValue(item.packageDigest);
    if (ids.has(item.id) || !['text', 'image', 'video'].includes(item.kind)
      || !['text-v1', 'image-v1', 'video-v1'].includes(item.adapterId)
      || item.adapterId !== `${item.kind}-v1` || typeof item.title !== 'string' || !item.title.trim()
      || item.title.length > 120 || typeof item.version !== 'string' || item.version.length > 80) {
      error('CREATOR_SKILL_CATALOG_INVALID', '技能目录适配记录不完整');
    }
    ids.add(item.id);
    if (item.contract != null) {
      normalizeSkillContract(item.contract);
      if (item.kind === 'text') error('CREATOR_SKILL_CATALOG_INVALID', '文本技能不能声明媒体生成约束');
    }
  }
  return clone(manifest);
}

class CreatorSkillStore {
  constructor(options = {}) {
    if (!path.isAbsolute(options.root || '')) error('CREATOR_SKILL_STORE_PATH', '技能库目录必须是绝对路径', 500);
    this.root = path.resolve(options.root);
    this.trustedKeys = Object.freeze({ ...(options.trustedKeys || {}) });
    this.catalogEnvelope = options.catalog ? clone(options.catalog) : null;
    this.catalog = options.catalog ? verifyCatalog(options.catalog, this.trustedKeys, options.minimumCatalogRevision || 0) : null;
    this.packageProvider = options.packageProvider || null;
    this.revokedDigests = new Set(options.revokedDigests || []);
    this.now = options.now || (() => Date.now());
    this.faultInjector = options.faultInjector || null;
  }

  _scope(scope) {
    const identity = { projectId: identifier(scope?.projectId), actorId: identifier(scope?.actorId || 'local-owner') };
    return { ...identity, key: hash(canonicalJson(identity)) };
  }

  _directory(scope, create = false) {
    const identity = this._scope(scope);
    const directory = path.join(this.root, identity.key);
    if (create) fs.mkdirSync(this.root, { recursive: true });
    // Root and owned children must never redirect to a different directory.
    for (const name of [this.root, directory, path.join(directory, 'packages'), path.join(directory, 'index')]) {
      if (!fs.existsSync(name)) {
        if (!create) continue;
        fs.mkdirSync(name);
      }
      const stat = fs.lstatSync(name);
      if (stat.isSymbolicLink() || !stat.isDirectory()) error('CREATOR_SKILL_STORE_PATH', '技能库目录被链接或其他文件替换');
    }
    return { directory, identity };
  }

  _readState(scope) {
    const { directory, identity } = this._directory(scope);
    const indexDir = path.join(directory, 'index');
    if (!fs.existsSync(indexDir)) return { schema: STORE_SCHEMA, owner: identity.key, revision: 0, entries: [] };
    const files = fs.readdirSync(indexDir).filter(name => /^\d{12}\.json$/u.test(name)).sort();
    if (!files.length) return { schema: STORE_SCHEMA, owner: identity.key, revision: 0, entries: [] };
    const state = readJson(path.join(indexDir, files.at(-1)), 1024 * 1024);
    const { stateDigest, ...content } = state;
    if (state.schema !== STORE_SCHEMA || state.owner !== identity.key || !Array.isArray(state.entries)
      || state.entries.length > MAX_PACKAGES || hash(canonicalJson(content)) !== stateDigest
      || state.revision !== Number(files.at(-1).slice(0, 12))) error('CREATOR_SKILL_STORE_INVALID', '技能索引校验失败');
    const ids = new Set();
    for (const item of state.entries) {
      identifier(item.id);
      digestValue(item.packageDigest);
      if (ids.has(item.id) || !['active', 'disabled', 'retained'].includes(item.status)
        || !['private', 'official'].includes(item.origin)) error('CREATOR_SKILL_STORE_INVALID', '技能安装记录无效');
      if (item.history != null && (!Array.isArray(item.history) || item.history.length > 16)) {
        error('CREATOR_SKILL_STORE_INVALID', '技能版本历史无效');
      }
      for (const version of item.history || []) digestValue(version?.packageDigest);
      ids.add(item.id);
    }
    return state;
  }

  _mutate(scope, apply) {
    const { directory } = this._directory(scope, true);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const previous = this._readState(scope);
      if (previous.revision >= MAX_COMMITS) error('CREATOR_SKILL_STORE_LIMIT', '技能库记录达到保留上限，请联系维护者归档');
      const next = { schema: STORE_SCHEMA, owner: previous.owner, revision: previous.revision + 1,
        catalogRevision: previous.catalogRevision || 0, entries: clone(previous.entries) };
      const result = apply(next);
      next.stateDigest = hash(canonicalJson(next));
      const filename = path.join(directory, 'index', `${String(next.revision).padStart(12, '0')}.json`);
      if (publishObject(filename, next, () => this.faultInjector?.('before-index-commit'))) return result;
    }
    error('CREATOR_SKILL_STORE_BUSY', '技能库正在更新，请重试');
  }

  _readPackage(scope, packageDigest) {
    digestValue(packageDigest);
    const { directory } = this._directory(scope);
    try {
      const pack = verifySkillPackage(readJson(path.join(directory, 'packages', `${packageDigest}.json`), MAX_RECORD_BYTES));
      if (pack.packageDigest !== packageDigest) error('CREATOR_SKILL_INTEGRITY', '技能内容与固定版本不一致');
      return pack;
    } catch (cause) {
      if (cause.code === 'ENOENT') error('CREATOR_SKILL_PACKAGE_MISSING', '固定版本技能包缺失，请重新导入同一版本');
      throw cause;
    }
  }

  _writePackage(scope, pack) {
    const { directory } = this._directory(scope, true);
    const packagesDir = path.join(directory, 'packages');
    let size = 0;
    const files = fs.readdirSync(packagesDir).filter(name => /^[a-f0-9]{64}\.json$/u.test(name));
    const target = path.join(packagesDir, `${pack.packageDigest}.json`);
    if (!fs.existsSync(target)) {
      for (const name of files) size += fs.lstatSync(path.join(packagesDir, name)).size;
      if (files.length >= MAX_PACKAGES || size + Buffer.byteLength(JSON.stringify(pack)) > MAX_LIBRARY_BYTES) {
        error('CREATOR_SKILL_STORE_LIMIT', '技能库保留资源达到上限，请先管理历史版本');
      }
      publishObject(target, pack, () => this.faultInjector?.('before-package-commit'));
    }
    this._readPackage(scope, pack.packageDigest);
  }

  _definition(item) {
    if (item.origin !== 'official') return null;
    const manifest = verifyCatalog(item.catalogEnvelope, this.trustedKeys);
    const definition = manifest.skills.find(skill => `official:${skill.id}` === item.id && skill.packageDigest === item.packageDigest);
    if (!definition) error('CREATOR_SKILL_CATALOG_UNTRUSTED', '安装记录没有对应的可信适配版本');
    return definition;
  }

  _public(scope, item) {
    const pack = this._readPackage(scope, item.packageDigest);
    const definition = this._definition(item);
    const revoked = this.revokedDigests.has(item.packageDigest);
    return {
      id: item.id, packageDigest: item.packageDigest, origin: item.origin, status: item.status,
      title: definition?.title || pack.metadata.name,
      description: definition?.description || pack.metadata.description,
      name: pack.metadata.name, version: definition?.version || pack.metadata.declaredVersion || pack.packageDigest.slice(0, 12),
      license: pack.metadata.license, totalBytes: pack.totalBytes, fileCount: pack.files.length,
      compatibility: revoked ? 'revoked' : pack.compatibility === 'reference-only' ? 'reference-only'
        : definition ? `${definition.kind}-adapter` : pack.compatibility,
      adapterId: definition?.adapterId || 'text-v1',
      diagnostics: pack.diagnostics,
      // A signature alone never creates a quality badge.
      quality: definition?.quality || { status: 'unverified' },
      definition, installedAt: item.installedAt,
      previousVersions: (item.history || []).map(version => ({ packageDigest: version.packageDigest, installedAt: version.installedAt })),
    };
  }

  list(scope, options = {}) {
    return this._readState(scope).entries.filter(item => options.includeRetained || item.status !== 'retained')
      .map(item => {
        try { return this._public(scope, item); } catch (cause) {
          if (!(cause instanceof CreatorSkillError)) throw cause;
          return { id: item.id, packageDigest: item.packageDigest, status: item.status, origin: item.origin,
            title: item.name || item.id, compatibility: 'unavailable', diagnostics: [{ code: cause.code, message: cause.message }], quality: { status: 'unverified' } };
        }
      });
  }

  _install(scope, pack, data, expectedPreviousDigest = null) {
    const verified = verifySkillPackage(pack);
    if (this.revokedDigests.has(verified.packageDigest)) error('CREATOR_SKILL_REVOKED', '此技能版本已撤回，不能新安装或执行');
    this._writePackage(scope, verified);
    const installed = this._mutate(scope, state => {
      if (data.origin === 'official') {
        const trusted = verifyCatalog(data.catalogEnvelope, this.trustedKeys, state.catalogRevision);
        state.catalogRevision = trusted.revision;
      }
      const existing = state.entries.find(item => item.id === data.id);
      if (expectedPreviousDigest && (!existing || existing.packageDigest !== expectedPreviousDigest)) {
        error('CREATOR_SKILL_VERSION_STALE', '待更新技能版本已变化，请重新查看');
      }
      if (existing && existing.packageDigest !== verified.packageDigest && !expectedPreviousDigest) {
        error('CREATOR_SKILL_UPDATE_REQUIRED', '已安装另一个固定版本，请明确选择更新版本');
      }
      if (!existing && state.entries.length >= MAX_PACKAGES) error('CREATOR_SKILL_STORE_LIMIT', '技能安装数量超过上限');
      const item = { ...data, name: verified.metadata.name, packageDigest: verified.packageDigest,
        status: 'active', installedAt: existing?.packageDigest === verified.packageDigest ? existing.installedAt : this.now(),
        history: existing?.history || [] };
      if (existing && existing.packageDigest !== verified.packageDigest) {
        item.history = [...item.history.filter(version => version.packageDigest !== verified.packageDigest), {
          packageDigest: existing.packageDigest, catalogEnvelope: existing.catalogEnvelope || null, installedAt: existing.installedAt,
        }];
        if (item.history.length > 16) error('CREATOR_SKILL_STORE_LIMIT', '技能历史版本保留已达上限，请先管理旧任务');
      }
      if (existing) state.entries[state.entries.indexOf(existing)] = item;
      else state.entries.push(item);
      return item;
    });
    return this._public(scope, installed);
  }

  installPrivate(scope, pack) {
    const verified = verifySkillPackage(pack);
    return this._install(scope, verified, { id: `private:${verified.packageDigest.slice(0, 32)}`, origin: 'private' });
  }

  getCatalog(scope) {
    const state = this._readState(scope);
    if (!this.catalog) return { revision: 0, items: [] };
    const manifest = verifyCatalog(this.catalogEnvelope, this.trustedKeys, state.catalogRevision || 0);
    return { revision: manifest.revision,
      items: manifest.skills.map(item => ({ ...item, revoked: this.revokedDigests.has(item.packageDigest) })) };
  }

  installOfficial(scope, id, expectedDigest) {
    const definition = this.catalog?.skills.find(item => item.id === id);
    if (!definition || !this.packageProvider) error('CREATOR_SKILL_NOT_FOUND', '精选技能不存在', 404);
    if (definition.packageDigest !== digestValue(expectedDigest)) error('CREATOR_SKILL_VERSION_STALE', '精选技能版本已变化，请重新查看');
    const pack = verifySkillPackage(this.packageProvider(id, expectedDigest));
    if (pack.packageDigest !== expectedDigest) error('CREATOR_SKILL_INTEGRITY', '精选技能资源与签名目录不一致');
    return this._install(scope, pack, { id: `official:${id}`, origin: 'official', catalogEnvelope: this.catalogEnvelope });
  }

  updateOfficial(scope, id, previousDigest, expectedDigest) {
    identifier(id);
    digestValue(previousDigest);
    digestValue(expectedDigest);
    const definition = this.catalog?.skills.find(item => `official:${item.id}` === id);
    if (!definition || !this.packageProvider) error('CREATOR_SKILL_NOT_FOUND', '此技能没有可用的官方更新', 404);
    if (definition.packageDigest !== expectedDigest) error('CREATOR_SKILL_VERSION_STALE', '更新目录已经变化');
    const pack = verifySkillPackage(this.packageProvider(definition.id, expectedDigest));
    if (pack.packageDigest !== expectedDigest) error('CREATOR_SKILL_INTEGRITY', '更新资源与签名目录不一致');
    return this._install(scope, pack, { id, origin: 'official', catalogEnvelope: this.catalogEnvelope }, previousDigest);
  }

  setStatus(scope, id, expectedDigest, status) {
    identifier(id);
    digestValue(expectedDigest);
    if (!['active', 'disabled', 'retained'].includes(status)) error('CREATOR_SKILL_STATUS_INVALID', '技能状态无效', 400);
    const item = this._mutate(scope, state => {
      const current = state.entries.find(entry => entry.id === id);
      if (!current) error('CREATOR_SKILL_NOT_FOUND', '技能未安装在当前项目', 404);
      if (current.packageDigest !== expectedDigest) error('CREATOR_SKILL_VERSION_STALE', '技能版本已经变化，请刷新');
      if (status === 'active') {
        if (this.revokedDigests.has(expectedDigest)) error('CREATOR_SKILL_REVOKED', '此技能版本已撤回');
        this._readPackage(scope, expectedDigest);
        this._definition(current);
      }
      current.status = status;
      return current;
    });
    // Uninstall/disable must remain possible even if the original bytes are damaged.
    return { id: item.id, packageDigest: item.packageDigest, status: item.status, retainedForExistingWork: status === 'retained' };
  }

  // Internal only: callers must have a durable, host-owned task binding. New
  // selections still use load(), which requires the current installed version.
  loadForTask(scope, id, expectedDigest) {
    const loaded = this.load(scope, id, expectedDigest, { readOnlyRecovery: true });
    if (loaded.skill.status !== 'active') error('CREATOR_SKILL_DISABLED', '技能已禁用或卸载，保留旧结果但不能开始新执行');
    if (this.revokedDigests.has(expectedDigest)) error('CREATOR_SKILL_REVOKED', '此技能版本已撤回，不能开始新执行');
    return { ...loaded, context: skillContextResources(loaded.pack), executionAllowed: true };
  }

  load(scope, id, expectedDigest, options = {}) {
    identifier(id);
    digestValue(expectedDigest);
    let item = this._readState(scope).entries.find(entry => entry.id === id);
    if (!item) error('CREATOR_SKILL_NOT_FOUND', '技能未安装在当前项目', 404);
    if (item.packageDigest !== expectedDigest) {
      const previous = options.readOnlyRecovery && (item.history || []).find(version => version.packageDigest === expectedDigest);
      if (!previous) error('CREATOR_SKILL_VERSION_STALE', '请使用当前任务固定的技能版本');
      item = { ...item, ...previous };
    }
    if (item.status !== 'active' && !options.readOnlyRecovery) error('CREATOR_SKILL_DISABLED', '技能已禁用或卸载，请重新选择');
    if (this.revokedDigests.has(expectedDigest) && !options.readOnlyRecovery) error('CREATOR_SKILL_REVOKED', '此技能已撤回，不能开始新执行');
    const pack = this._readPackage(scope, expectedDigest);
    return { skill: this._public(scope, item), pack, context: options.readOnlyRecovery ? null : skillContextResources(pack),
      executionAllowed: !options.readOnlyRecovery };
  }
}

module.exports = { STORE_SCHEMA, CATALOG_SCHEMA, CreatorSkillStore, verifyCatalog };
