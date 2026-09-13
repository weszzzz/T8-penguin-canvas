'use strict';

const express = require('express');
const multer = require('multer');
const {
  SKILL_LIMITS, CreatorSkillError, buildSkillPackage, readSkillZip,
} = require('../services/creatorSkillPackages');

const SKILL_HTTP_SCHEMA = 't8-creator-agent-http-v2';
const SKILL_UPLOAD_REQUEST_LIMIT = SKILL_LIMITS.totalBytes + 1024 * 1024;

function skillUploadStorage() {
  return {
    _handleFile(req, file, callback) {
      let settled = false;
      let size = 0;
      const chunks = [];
      const limit = /\.zip$/iu.test(file.originalname) ? SKILL_LIMITS.compressedBytes : SKILL_LIMITS.fileBytes;
      const finish = (error, data) => {
        if (settled) return;
        settled = true;
        callback(error, data);
      };
      file.stream.on('data', chunk => {
        if (settled) return;
        size += chunk.length;
        req.creatorSkillUploadBytes = (req.creatorSkillUploadBytes || 0) + chunk.length;
        if (size > limit || req.creatorSkillUploadBytes > SKILL_LIMITS.totalBytes) {
          chunks.length = 0;
          finish(new CreatorSkillError('CREATOR_SKILL_TOO_LARGE', '技能上传超过单文件或总大小限制', 413));
          return;
        }
        chunks.push(chunk);
      });
      file.stream.on('error', finish);
      file.stream.on('end', () => finish(null, { buffer: Buffer.concat(chunks), size }));
    },
    _removeFile(_req, file, callback) { delete file.buffer; callback(null); },
  };
}

function createCreatorSkillRouter(options) {
  const router = express.Router();
  const store = () => options.getStore();
  const response = (res, data, status = 200) => res.status(status).json({ schema: SKILL_HTTP_SCHEMA, ok: true, data });
  // Actor identity belongs to the authenticated host, never request JSON.
  const scope = (req) => {
    const input = req.method === 'GET' || req.path === '/import' ? req.query : req.body;
    const validated = options.requireScope(input || {});
    return { projectId: validated.projectId, actorId: options.actorForRequest?.(req) || 'local-owner' };
  };
  const upload = multer({
    storage: skillUploadStorage(), preservePath: true,
    limits: { fileSize: SKILL_LIMITS.compressedBytes, files: SKILL_LIMITS.files, fields: 0, parts: SKILL_LIMITS.files, fieldNameSize: 32 },
  }).array('files', SKILL_LIMITS.files);

  router.get('/', (req, res, next) => {
    try { response(res, { items: store().list(scope(req)) }); } catch (error) { next(error); }
  });
  router.get('/catalog', (req, res, next) => {
    try {
      response(res, store().getCatalog(scope(req)));
    } catch (error) { next(error); }
  });
  router.post('/import', (req, res, next) => {
    let requestScope;
    try { requestScope = scope(req); } catch (error) { next(error); return; }
    if (!req.is('multipart/form-data')) { next(new CreatorSkillError('CREATOR_SKILL_UPLOAD_INVALID', '请选择技能文件或文件夹上传', 400)); return; }
    const length = Number(req.get('content-length'));
    if (Number.isFinite(length) && length > SKILL_UPLOAD_REQUEST_LIMIT) {
      next(new CreatorSkillError('CREATOR_SKILL_TOO_LARGE', '技能上传超过大小限制', 413)); return;
    }
    upload(req, res, async uploadError => {
      if (uploadError) { next(uploadError); return; }
      try {
        const files = req.files || [];
        const isZip = files.length === 1 && /\.zip$/iu.test(files[0].originalname);
        const pack = isZip ? await readSkillZip(files[0].buffer)
          : buildSkillPackage(files.map(file => ({ path: file.originalname, bytes: file.buffer })));
        const item = store().installPrivate(requestScope, pack);
        response(res, { item, generated: false }, 201);
      } catch (error) { next(error); } finally {
        for (const file of req.files || []) delete file.buffer;
      }
    });
  });
  router.post('/install', (req, res, next) => {
    try {
      const item = store().installOfficial(scope(req), req.body?.id, req.body?.packageDigest);
      response(res, { item, generated: false }, 201);
    } catch (error) { next(error); }
  });
  router.post('/:id/status', (req, res, next) => {
    try { response(res, store().setStatus(scope(req), req.params.id, req.body?.packageDigest, req.body?.status)); }
    catch (error) { next(error); }
  });
  router.post('/:id/update', (req, res, next) => {
    try { response(res, { item: store().updateOfficial(scope(req), req.params.id, req.body?.previousDigest, req.body?.packageDigest), generated: false }); }
    catch (error) { next(error); }
  });
  // Inspecting historical instructions is not permission to start a new task.
  // This read-only preflight requires the current active package and a complete
  // bounded context. Actual send still revalidates after this response.
  router.get('/:id/prepare', (req, res, next) => {
    try {
      const loaded = store().load(scope(req), req.params.id, req.query.packageDigest);
      response(res, { item: loaded.skill, generated: false });
    } catch (error) { next(error); }
  });
  router.get('/:id', (req, res, next) => {
    try {
      const loaded = store().load(scope(req), req.params.id, req.query.packageDigest, { readOnlyRecovery: true });
      response(res, { item: loaded.skill, instructions: loaded.pack.body,
        files: loaded.pack.files.map(file => ({ path: file.path, size: file.size, sha256: file.sha256 })) });
    } catch (error) { next(error); }
  });
  router.use((error, _req, res, next) => {
    if (!(error instanceof CreatorSkillError) && !(error instanceof multer.MulterError)) { next(error); return; }
    const uploadError = error instanceof multer.MulterError;
    res.status(uploadError ? 413 : error.status).json({
      schema: SKILL_HTTP_SCHEMA, ok: false,
      code: uploadError ? 'CREATOR_SKILL_UPLOAD_LIMIT' : error.code,
      message: uploadError ? '技能上传字段、数量或大小超过限制' : error.message,
    });
  });
  return router;
}

module.exports = { createCreatorSkillRouter, SKILL_UPLOAD_REQUEST_LIMIT };
