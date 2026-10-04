'use strict';

const { spawnSync } = require('node:child_process');

const PROXY_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

function firstConfiguredProxy(env = process.env) {
  return PROXY_KEYS.map((key) => env[key]).find((value) => String(value || '').trim()) || '';
}

function parseScutilProxyOutput(output) {
  const values = {};
  for (const line of String(output || '').split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*?)\s*$/u);
    if (match) values[match[1]] = match[2];
  }
  const candidates = [
    ['HTTPSEnable', 'HTTPSProxy', 'HTTPSPort'],
    ['HTTPEnable', 'HTTPProxy', 'HTTPPort'],
    ['SOCKSEnable', 'SOCKSProxy', 'SOCKSPort'],
  ];
  for (const [enabledKey, hostKey, portKey] of candidates) {
    const host = values[hostKey];
    const port = Number(values[portKey]);
    if (values[enabledKey] === '1' && host && Number.isInteger(port) && port > 0 && port < 65536) {
      return `http://${host}:${port}`;
    }
  }
  return '';
}

function detectMacSystemProxy({
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  if (platform !== 'darwin') return '';
  const result = spawn('scutil', ['--proxy'], { encoding: 'utf8', stdio: 'pipe' });
  if (result.error || result.status !== 0) return '';
  return parseScutilProxyOutput(result.stdout);
}

function buildFetchEnvironment({
  platform = process.platform,
  base = process.env,
  systemProxy = detectMacSystemProxy({ platform }),
} = {}) {
  const env = { ...base };
  const configured = firstConfiguredProxy(base);
  if (configured || !systemProxy) {
    return { env, proxy: configured || null, source: configured ? 'environment' : 'none' };
  }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
    if (!env[key]) env[key] = systemProxy;
  }
  return { env, proxy: systemProxy, source: 'macos-system' };
}

function classifyFetchFailure(output) {
  const text = String(output || '');
  if (/FETCH_HEAD/u.test(text) && /(operation not permitted|permission denied|EACCES|EPERM)/iu) {
    return 'permission';
  }
  if (/(could not resolve host|timed out|timeout|HTTP2 framing|connection reset|network is unreachable|unable to access)/iu.test(text)) {
    return 'network';
  }
  return 'unknown';
}

function fetchUpstream({
  remote = 'upstream',
  branch = 'main',
  cwd = process.cwd(),
  env = process.env,
  spawn = spawnSync,
  platform = process.platform,
} = {}) {
  const prepared = buildFetchEnvironment({ platform, base: env });
  const result = spawn('git', ['-c', 'lfs.skipSmudge=true', 'fetch', '--no-tags', remote, branch], {
    cwd,
    env: prepared.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (output) process.stderr.write(`${output}\n`);
  if (result.error || result.status !== 0) {
    const kind = classifyFetchFailure(`${result.error?.message || ''}\n${output}`);
    const error = new Error(
      kind === 'permission'
        ? '上游抓取被本地 Git 目录权限阻止；请确保 .git/FETCH_HEAD 可写后重试。'
        : kind === 'network'
          ? '上游抓取遇到网络或代理错误；请检查代理连通性后重试。'
          : `上游抓取失败${result.error ? `：${result.error.message}` : ''}`,
    );
    error.code = `UPSTREAM_FETCH_${kind.toUpperCase()}`;
    error.proxy = prepared.proxy;
    error.proxySource = prepared.source;
    error.output = output;
    throw error;
  }
  return { proxy: prepared.proxy, proxySource: prepared.source, output };
}

if (require.main === module) {
  try {
    const [remote = 'upstream', branch = 'main'] = process.argv.slice(2);
    const result = fetchUpstream({ remote, branch });
    process.stdout.write(`[fetch-upstream] remote=${remote} branch=${branch} proxy=${result.proxy || 'none'} source=${result.proxySource}\n`);
  } catch (error) {
    process.stderr.write(`[fetch-upstream] ${error.code || 'FAILED'} ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildFetchEnvironment,
  classifyFetchFailure,
  detectMacSystemProxy,
  fetchUpstream,
  firstConfiguredProxy,
  parseScutilProxyOutput,
};
