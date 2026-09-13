'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const { recoverGenerationHistoryFile, validateRecoveryScope } = require('../services/generationHistoryRecovery');
const { resolveReferenceRecovery } = require('../services/generationHistoryReferenceRecovery');

function createHistoryRecoveryHandler({ getDatabase, config, isTrustedRequest, recover = recoverGenerationHistoryFile }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isTrustedRequest(req)) return res.status(403).json({ success: false, error: '仅允许客户端本机找回文件' });
    if (!req.is('multipart/form-data')) return res.status(415).json({ success: false, error: '请选择本地文件上传' });
    let directory;
    try {
      const database = getDatabase();
      const scope = validateRecoveryScope(database, req.query);
      const reference = Object.fromEntries(['referenceGroupId', 'referenceArchiveDigest', 'referenceIndex']
        .filter(key => Object.hasOwn(req.query, key)).map(key => [key, req.query[key]]));
      resolveReferenceRecovery(database, { ...scope, ...reference });
      directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 't8-history-upload-'));
      const upload = multer({
        storage: multer.diskStorage({ destination: directory, filename: (_req, file, done) => done(null, `selected${path.extname(file.originalname).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 16)}`) }),
        limits: { files: 1, fields: 0, parts: 2, fileSize: Math.min(Number(config.FILE_UPLOAD_MAX_BYTES) || 512 * 1024 * 1024, 512 * 1024 * 1024) },
      }).single('file');
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      if (!req.file || req.aborted) throw Object.assign(new Error('未收到完整文件'), { status: 400 });
      const data = await recover(database, config, { ...scope, ...reference, uploadPath: req.file.path, filename: req.file.originalname });
      res.status(data.duplicate ? 200 : 201).json({ success: true, data });
    } catch (error) {
      if (req.aborted || res.destroyed) return;
      const unconfirmed = error.code === 'project_database_write_acknowledgement_failed' && error.committed === true;
      const writesStopped = (error.code === 'project_database_write_sequence_32_invalid' && error.reason === 'coordinator-fail-stopped')
        || (error.code === 'project_database_recovery_generation_unavailable'
          && error.details?.phase === 'schema32-write-committed-acknowledgement-failed');
      if (unconfirmed || writesStopped) {
        return res.status(503).json({ success: false,
          code: unconfirmed ? 'HISTORY_RECOVERY_COMMIT_UNCONFIRMED' : 'HISTORY_RECOVERY_WRITES_STOPPED',
          committed: unconfirmed, retryable: false, stopBatch: true,
          error: unconfirmed ? '部分数据已提交，但保存确认失败。请先查看历史记录，不要重复找回或删除数据；重启客户端后如有恢复提示，请按提示处理。'
            : '数据库已暂停写入，本批找回已停止。请先查看历史记录；重启客户端后如有恢复提示，请按提示处理，不要删除数据。',
        });
      }
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : (error.status || 400);
      // Filesystem/decoder messages may include host paths. Keep the public
      // failure actionable but do not expose raw exception details.
      res.status(status).json({ success: false, error: error.code === 'generation_reference_content_mismatch'
        ? '所选文件与当时的参考内容不一致，未恢复。请选择原文件，不要选择修改后的版本。'
        : status === 413 ? '文件超过 512 MB 限制，请分文件找回' : '未能找回：请确认画布有效，文件完整且为图像、视频或音频，然后重试。' });
    } finally {
      if (directory) await fs.promises.rm(directory, { recursive: true, force: true });
    }
  };
}
module.exports = { createHistoryRecoveryHandler };
