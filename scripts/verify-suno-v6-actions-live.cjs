'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');
const seedanceNz = require('../backend/src/providers/seedanceNz');

const root = path.resolve(__dirname, '..');
const ffmpeg = path.join(root, 'tools', 'ffmpeg-runtime', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobe = path.join(root, 'tools', 'ffmpeg-runtime', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const apiKey = String(process.env.SEEDANCE_NZ_API_KEY || '').trim();
const liveRun = String(process.env.SUNO_V6_ACTIONS_LIVE_RUN || '').trim();
const allowLive = /^suno-v6-actions-live-[A-Za-z0-9._:-]{8,80}$/.test(liveRun);
const liveScope = String(process.env.SUNO_V6_ACTIONS_SCOPE || 'all').trim();
const createModelSourceDir = String(process.env.SUNO_V6_CREATE_MODEL_SOURCE_DIR || '').trim();
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const reportDir = path.join(root, 'output', `suno-v6-actions-live-${stamp}`);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-suno-v6-actions-'));
const report = {
  schema: 't8-suno-v6-actions-live-v1',
  startedAt: startedAt.toISOString(),
  finishedAt: '',
  baseUrl: seedanceNz.BASE_URL,
  scope: liveScope,
  lowLoad: { serial: true, nodeOldSpaceMiB: Number(process.env.NODE_OPTIONS?.match(/max-old-space-size=(\d+)/)?.[1] || 0), ffmpegThreads: 1 },
  actions: [],
  passed: false,
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeError(error) {
  let text = String(error?.message || error || 'unknown error');
  if (apiKey) text = text.split(apiKey).join('[redacted]');
  return text
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[redacted-uuid]')
    .replace(/(["']?(?:task_?id|model_?id)["']?\s*[:=]\s*)["']?[^,}\s"']+/gi, '$1[redacted-id]')
    .slice(0, 800);
}

function run(binary, args, label, timeout = 60_000) {
  const result = spawnSync(binary, args, { windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${safeError(result.error || result.stderr || `exit ${result.status}`)}`);
  }
  return result.stdout;
}

function makeMediaInput() {
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) throw new Error('bundled ffmpeg/ffprobe runtime is missing');
  const target = path.join(tempDir, 'media-reference.wav');
  run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
    '-threads', '1', '-c:a', 'pcm_s16le', target,
  ], 'media input');
  return target;
}

function loadCreateModelInputs() {
  if (!createModelSourceDir) throw new Error('SUNO_V6_CREATE_MODEL_SOURCE_DIR is required for create-model verification');
  const sourceDir = path.resolve(root, createModelSourceDir);
  const allowedRoot = `${path.resolve(root, 'output')}${path.sep}`;
  if (!`${sourceDir}${path.sep}`.startsWith(allowedRoot)) {
    throw new Error('create-model source directory must be inside this workspace output directory');
  }
  const files = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ['.mp3', '.wav', '.m4a'].includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(sourceDir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), 'en'));
  if (files.length < 6 || files.length > 24) throw new Error('create-model source directory must contain 6-24 supported audio files');
  for (const [index, file] of files.entries()) {
    const stats = fs.statSync(file);
    if (!stats.isFile() || stats.size <= 0 || stats.size > 50 * 1024 * 1024) {
      throw new Error(`create-model source ${index + 1} has invalid byte size`);
    }
    const parsed = JSON.parse(run(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file,
    ], `create-model source ${index + 1} ffprobe`));
    const durationSeconds = Number(parsed.format?.duration || 0);
    if (!parsed.streams?.some((stream) => stream.codec_type === 'audio' && stream.codec_name)
      || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`create-model source ${index + 1} has no decodable audio stream`);
    }
  }
  console.log(`[suno-v6-live] create-model source set validated; files=${files.length}`);
  return files;
}

async function pollTask(taskId, resultFamily, action, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let polls = 0;
  let transientReads = 0;
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  while (Date.now() < deadline) {
    try {
      const result = await seedanceNz.querySunoMusicTask(taskId, apiKey, { resultFamily });
      polls += 1;
      const status = String(result.status || '').toLowerCase();
      if (['succeeded', 'success', 'completed'].includes(status)) return { result, polls };
      if (status === 'failed') throw new Error(`${action} failed at Provider terminal state`);
      if (polls === 1 || polls % 5 === 0) console.log(`[suno-v6-live] ${action} pending; polls=${polls}`);
    } catch (error) {
      if (/terminal state/.test(String(error?.message || ''))) throw error;
      transientReads += 1;
      if (transientReads > 5) throw new Error(`${action} status query failed repeatedly: ${safeError(error)}`);
      console.log(`[suno-v6-live] ${action} status read retry ${transientReads}/5`);
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  throw new Error(`${action} polling timed out; the accepted task was not resubmitted`);
}

async function downloadArtifact(artifact, action, index) {
  const response = await seedanceNz.fetchRemote(artifact.url, { method: 'GET' });
  if (!response.ok) throw new Error(`${action} artifact ${index + 1} download HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 80 * 1024 * 1024) throw new Error(`${action} artifact ${index + 1} has invalid byte size`);
  const digest = sha256(buffer);
  if (artifact.kind === 'audio') {
    const target = path.join(tempDir, `${action}-${index + 1}.bin`);
    fs.writeFileSync(target, buffer);
    const parsed = JSON.parse(run(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration,size,format_name',
      '-show_entries', 'stream=codec_type,codec_name,sample_rate', '-of', 'json', target,
    ], `${action} ffprobe`));
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');
    const durationSeconds = Number(parsed.format?.duration || 0);
    if (!audioStream?.codec_name || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error(`${action} artifact ${index + 1} has no decodable audio stream`);
    }
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', target, '-map', '0:a:0', '-f', 'null', '-'], `${action} full audio decode`, 180_000);
    return { kind: 'audio', bytes: buffer.length, sha256: digest, codec: audioStream.codec_name, sampleRate: Number(audioStream.sample_rate || 0), durationSeconds };
  }
  if (artifact.kind === 'image') {
    const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) throw new Error(`${action} artifact ${index + 1} has no decodable image`);
    return { kind: 'image', bytes: buffer.length, sha256: digest, format: metadata.format, width: metadata.width, height: metadata.height };
  }
  return { kind: artifact.kind, bytes: buffer.length, sha256: digest };
}

async function runMediaAction(action, request, source) {
  console.log(`[suno-v6-live] submitting ${action} exactly once`);
  const submitted = await seedanceNz.submitSunoMusicTask({ ...request, operation: action, audio_url: source }, apiKey);
  if (!submitted.taskId) throw new Error(`${action} submit response contained no task_id`);
  const terminal = ['succeeded', 'success', 'completed'].includes(String(submitted.status || '').toLowerCase())
    ? { result: submitted, polls: 0 }
    : await pollTask(submitted.taskId, 'audio', action, 20 * 60_000);
  const artifacts = Array.isArray(terminal.result.artifacts) ? terminal.result.artifacts : [];
  const audioArtifacts = artifacts.filter((artifact) => artifact.kind === 'audio');
  if (!audioArtifacts.length) throw new Error(`${action} completed without an audio artifact`);
  const validated = [];
  for (const [index, artifact] of artifacts.entries()) validated.push(await downloadArtifact(artifact, action, index));
  report.actions.push({ action, submitted: true, terminalStatus: 'succeeded', polls: terminal.polls, artifactCount: artifacts.length, validated });
  console.log(`[suno-v6-live] ${action} passed; artifacts=${artifacts.length}`);
}

async function runCreateModel(sources) {
  const action = 'suno-create-model';
  console.log(`[suno-v6-live] submitting ${action} exactly once`);
  const submitted = await seedanceNz.submitSunoMusicTask({
    operation: action,
    name: `T8 V6 verification ${stamp.slice(0, 19)}`,
    audio_urls: sources,
  }, apiKey);
  if (!submitted.taskId) throw new Error(`${action} submit response contained no task_id`);
  const terminal = await pollTask(submitted.taskId, 'model', action, 25 * 60_000);
  const modelId = String(terminal.result.text || '').trim();
  // The authoritative reference promises a 36-character UUID, but does not
  // constrain its UUID version/variant. Accept the canonical shape only.
  const uuidLike = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(modelId);
  if (!uuidLike) throw new Error(`${action} completed without a valid model UUID`);
  report.actions.push({ action, submitted: true, terminalStatus: 'succeeded', polls: terminal.polls, modelIdLength: modelId.length, modelIdFormat: 'uuid', artifactCount: 0 });
  console.log(`[suno-v6-live] ${action} passed; model_id validated`);
}

async function main() {
  if (!apiKey) throw new Error('SEEDANCE_NZ_API_KEY is required');
  if (!allowLive) throw new Error('set SUNO_V6_ACTIONS_LIVE_RUN=suno-v6-actions-live-<unique-id> to authorize this paid live verification');
  if (!['all', 'create-model'].includes(liveScope)) throw new Error('SUNO_V6_ACTIONS_SCOPE must be all or create-model');
  fs.mkdirSync(reportDir, { recursive: true });
  if (liveScope === 'all') {
    const mediaSource = makeMediaInput();
    await runMediaAction('suno-upload-cover', {
      version: 'v6-mini', custom: true, instrumental: true,
      tags: 'calm cinematic instrumental', title: 'T8 Cover Verification',
      negative_tags: 'harsh vocals', style_weight: 0.5, weirdness: 0.5, audio_weight: 0.5,
      auto_lyrics: false, duration_s: 10, variety: 'normal', max_mode: false, audio_format: 'mp3',
    }, mediaSource);
    await runMediaAction('suno-upload-extend', {
      version: 'v6-mini', continue_at: 2, prompt: 'Continue as a calm cinematic piano outro',
      tags: 'calm cinematic piano', title: 'T8 Extend Verification', negative_tags: 'harsh vocals',
      style_weight: 0.5, weirdness: 0.5, audio_weight: 0.5, auto_lyrics: false,
      duration_s: 10, variety: 'normal', max_mode: false, audio_format: 'mp3',
    }, mediaSource);
  }
  await runCreateModel(loadCreateModelInputs());
  report.passed = true;
}

main().catch((error) => {
  report.error = safeError(error);
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const resolvedTemp = path.resolve(tempDir);
  const resolvedSystemTemp = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (resolvedTemp.startsWith(resolvedSystemTemp) && path.basename(resolvedTemp).startsWith('t8-suno-v6-actions-')) {
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
  console.log(`[suno-v6-live] report=${path.relative(root, path.join(reportDir, 'report.json'))}; passed=${report.passed}`);
});
