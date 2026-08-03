'use strict';

const assert = require('node:assert/strict');

const {
  buildSyncEnvironment,
} = require('../scripts/sync-platform.cjs');

const darwinEnv = buildSyncEnvironment('darwin', { PATH: '/usr/bin', GIT_LFS_SKIP_SMUDGE: '0' });
assert.equal(darwinEnv.GIT_LFS_SKIP_SMUDGE, '1');

const windowsEnv = buildSyncEnvironment('win32', { PATH: 'C:/Windows', GIT_LFS_SKIP_SMUDGE: '0' });
assert.equal(windowsEnv.GIT_LFS_SKIP_SMUDGE, undefined);

console.log('syncPlatform.test.cjs: ok');
