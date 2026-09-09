'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { Writable } = require('node:stream');
const sharp = require('sharp');
const { Agent: UndiciAgent, fetch: undiciFetch } = require('undici');

const BASE_URL = 'https://api.seedance.nz';
const IMAGE_MODEL = 'vosr2-image-upscale';
const VIDEO_MODEL = 'vosr2-video-upscale';
const TASK_DEADLINE_MS = 30 * 60_000;
const REQUEST_DEADLINE_MS = 3 * 60_000;
const POLL_INTERVAL_MS = 10_000;
const dispatcher = new UndiciAgent({
  connectTimeout: 30_000,
  headersTimeout: REQUEST_DEADLINE_MS,
  bodyTimeout: REQUEST_DEADLINE_MS,
});

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function readSecretLine() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      const mutedOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      const input = readline.createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
      input.question('', (line) => {
        input.close();
        process.stdout.write('\n');
        resolve(String(line || '').trim());
      });
      return;
    }
    const input = readline.createInterface({ input: process.stdin, terminal: false });
    input.once('line', (line) => {
      input.close();
      resolve(String(line || '').trim());
    });
  });
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function redact(value, apiKey, secrets = []) {
  let text = String(value || '');
  for (const secret of [apiKey, ...secrets]) {
    if (secret) text = text.split(String(secret)).join('[REDACTED]');
  }
  return text.replace(/https?:\/\/[^\s"']+/g, '[remote-url]').slice(0, 1_000);
}

async function fetchOnce(url, init = {}, deadlineMs = REQUEST_DEADLINE_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request deadline exceeded')), deadlineMs);
  try {
    return await undiciFetch(url, { ...init, dispatcher, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response, apiKey, secrets = []) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status} returned non-JSON: ${redact(text, apiKey, secrets)}`);
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.error || body?.message || text;
    throw new Error(`HTTP ${response.status}: ${redact(message, apiKey, secrets)}`);
  }
  return body;
}

function uploadUrl(body) {
  return String(
    body?.url || body?.file_url || body?.fileUrl
    || body?.data?.url || body?.data?.file_url || body?.data?.fileUrl
    || '',
  ).trim();
}

function taskId(body) {
  return String(body?.id || body?.task_id || body?.data?.id || body?.data?.task_id || '').trim();
}

function taskBody(body) {
  return body?.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : body;
}

function taskState(body) {
  const record = taskBody(body);
  const state = String(record?.status || record?.data?.status || '').trim().toUpperCase();
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(state)) return 'succeeded';
  if (['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(state)) return 'failed';
  return 'pending';
}

function resultUrl(body, kind) {
  const record = taskBody(body);
  const content = record?.data?.content || record?.content || {};
  return String(
    record?.result_url || record?.resultUrl
    || (kind === 'image' ? record?.image_url || record?.imageUrl : record?.video_url || record?.videoUrl)
    || record?.data?.result_url
    || (kind === 'image' ? content?.image_url || content?.imageUrl : content?.video_url || content?.videoUrl)
    || '',
  ).trim();
}

function usagePresence(body) {
  const record = taskBody(body);
  const usage = record?.usage || body?.usage || body?.data?.usage;
  return {
    usagePresent: Boolean(usage && typeof usage === 'object'),
    thirdPartyConsumeMoneyPresent: Boolean(
      usage && typeof usage === 'object'
      && Object.prototype.hasOwnProperty.call(usage, 'thirdPartyConsumeMoney'),
    ),
  };
}

async function uploadFile(filename, mime, apiKey) {
  const bytes = fs.readFileSync(filename);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), path.basename(filename));
  const response = await fetchOnce(`${BASE_URL}/v1/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body = await readJson(response, apiKey);
  const url = uploadUrl(body);
  if (!/^https?:\/\//i.test(url)) throw new Error('file upload succeeded without a public URL');
  return url;
}

async function submitTask(kind, sourceUrl, apiKey) {
  const isImage = kind === 'image';
  const endpoint = isImage ? '/v1/image/generations' : '/v1/video/generations';
  const payload = isImage
    ? { model: IMAGE_MODEL, images: [sourceUrl] }
    : { model: VIDEO_MODEL, metadata: { video_url: sourceUrl } };
  const response = await fetchOnce(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response, apiKey, [sourceUrl]);
  const id = taskId(body);
  if (!id) throw new Error(`${kind} submission succeeded without a task ID`);
  return { id, endpoint, httpStatus: response.status, submittedAt: new Date().toISOString() };
}

async function pollTask(kind, submission, apiKey) {
  const startedAt = Date.now();
  let polls = 0;
  let lastBody = null;
  while (Date.now() - startedAt < TASK_DEADLINE_MS) {
    polls += 1;
    const response = await fetchOnce(`${BASE_URL}${submission.endpoint}/${encodeURIComponent(submission.id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    lastBody = await readJson(response, apiKey, [submission.id]);
    const state = taskState(lastBody);
    process.stdout.write(`${JSON.stringify({ phase: `${kind}-poll`, poll: polls, state })}\n`);
    if (state === 'failed') throw new Error(`${kind} task reached a failed terminal state`);
    if (state === 'succeeded') {
      const url = resultUrl(lastBody, kind);
      if (!/^https?:\/\//i.test(url)) throw new Error(`${kind} task succeeded without a result URL`);
      return { url, polls, durationMs: Date.now() - startedAt, ...usagePresence(lastBody) };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`${kind} task did not finish within ${TASK_DEADLINE_MS / 60_000} minutes`);
}

async function download(url, apiKey, secrets) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetchOnce(url, {}, REQUEST_DEADLINE_MS);
      if (!response.ok) throw new Error(`download HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw new Error(redact(lastError?.message || 'download failed', apiKey, secrets));
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`media tool exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(-800)}`));
    });
  });
}

async function createInputs(outputDir) {
  const imagePath = path.join(outputDir, 'input.png');
  const imageSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
      <defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#00bcd4"/><stop offset="1" stop-color="#ffca28"/></linearGradient></defs>
      <rect width="320" height="180" fill="url(#g)"/><circle cx="160" cy="90" r="54" fill="#152238"/>
      <text x="160" y="100" text-anchor="middle" font-family="Arial" font-size="26" fill="white">VOSR2</text>
    </svg>
  `);
  await sharp(imageSvg).png().toFile(imagePath);

  const videoPath = path.join(outputDir, 'input.mp4');
  const ffmpeg = path.resolve('tools', 'ffmpeg-runtime', 'ffmpeg.exe');
  await runProcess(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath,
  ]);
  return { imagePath, videoPath };
}

async function probeVideo(filename) {
  const ffprobe = path.resolve('tools', 'ffmpeg-runtime', 'ffprobe.exe');
  const raw = await runProcess(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt:format=duration',
    '-of', 'json', filename,
  ]);
  const parsed = JSON.parse(raw);
  const stream = parsed?.streams?.[0] || {};
  return {
    codec: String(stream.codec_name || ''),
    width: Number(stream.width) || 0,
    height: Number(stream.height) || 0,
    pixelFormat: String(stream.pix_fmt || ''),
    durationSeconds: Number(parsed?.format?.duration) || 0,
  };
}

async function main() {
  if (!process.argv.includes('--api-key-stdin')) throw new Error('use --api-key-stdin');
  const apiKey = await readSecretLine();
  if (!apiKey) throw new Error('API key is required through stdin');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const outputDir = path.resolve(argument('output', path.join('output', `vosr2-live-${stamp}`)));
  fs.mkdirSync(outputDir, { recursive: true });
  const report = {
    schema: 't8-vosr2-live-verification-v1',
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    requestContracts: {
      image: '{model,images:[one_public_url]}',
      video: '{model,metadata:{video_url:one_public_url}}',
    },
    paidSubmissionPolicy: 'exactly one POST per model; no automatic replay',
    credentialPersisted: false,
    taskIdPersisted: false,
    signedUrlPersisted: false,
    rawProviderResponsePersisted: false,
    image: null,
    video: null,
  };
  const secrets = [];
  try {
    const inputs = await createInputs(outputDir);

    process.stdout.write(`${JSON.stringify({ phase: 'image-upload' })}\n`);
    const imageSourceUrl = await uploadFile(inputs.imagePath, 'image/png', apiKey);
    secrets.push(imageSourceUrl);
    process.stdout.write(`${JSON.stringify({ phase: 'image-submit', paidPost: 1 })}\n`);
    const imageSubmission = await submitTask('image', imageSourceUrl, apiKey);
    secrets.push(imageSubmission.id);
    const imageResult = await pollTask('image', imageSubmission, apiKey);
    secrets.push(imageResult.url);
    const imageBytes = await download(imageResult.url, apiKey, secrets);
    const imageMetadata = await sharp(imageBytes).metadata();
    if (!imageMetadata.width || !imageMetadata.height || Math.max(imageMetadata.width, imageMetadata.height) < 3840) {
      throw new Error(`image output did not meet documented 4K size (${imageMetadata.width || 0}x${imageMetadata.height || 0})`);
    }
    const imageExtension = imageMetadata.format === 'jpeg' ? 'jpg' : String(imageMetadata.format || 'png');
    const imageOutputPath = path.join(outputDir, `vosr2-image-upscale.${imageExtension}`);
    fs.writeFileSync(imageOutputPath, imageBytes);
    report.image = {
      model: IMAGE_MODEL,
      paidSubmitCount: 1,
      submitHttpStatus: imageSubmission.httpStatus,
      polls: imageResult.polls,
      durationMs: imageResult.durationMs,
      output: {
        filename: path.basename(imageOutputPath),
        format: imageMetadata.format,
        width: imageMetadata.width,
        height: imageMetadata.height,
        bytes: imageBytes.length,
        sha256: sha256(imageBytes),
      },
      usagePresent: imageResult.usagePresent,
      thirdPartyConsumeMoneyPresent: imageResult.thirdPartyConsumeMoneyPresent,
    };
    process.stdout.write(`${JSON.stringify({ ok: true, model: IMAGE_MODEL, width: imageMetadata.width, height: imageMetadata.height })}\n`);

    process.stdout.write(`${JSON.stringify({ phase: 'video-upload' })}\n`);
    const videoSourceUrl = await uploadFile(inputs.videoPath, 'video/mp4', apiKey);
    secrets.push(videoSourceUrl);
    process.stdout.write(`${JSON.stringify({ phase: 'video-submit', paidPost: 1 })}\n`);
    const videoSubmission = await submitTask('video', videoSourceUrl, apiKey);
    secrets.push(videoSubmission.id);
    const videoResult = await pollTask('video', videoSubmission, apiKey);
    secrets.push(videoResult.url);
    const videoBytes = await download(videoResult.url, apiKey, secrets);
    const videoOutputPath = path.join(outputDir, 'vosr2-video-upscale.mp4');
    fs.writeFileSync(videoOutputPath, videoBytes);
    const videoMetadata = await probeVideo(videoOutputPath);
    if (!videoMetadata.width || !videoMetadata.height || Math.max(videoMetadata.width, videoMetadata.height) < 2000) {
      throw new Error(`video output did not meet documented 2K size (${videoMetadata.width}x${videoMetadata.height})`);
    }
    report.video = {
      model: VIDEO_MODEL,
      paidSubmitCount: 1,
      submitHttpStatus: videoSubmission.httpStatus,
      polls: videoResult.polls,
      durationMs: videoResult.durationMs,
      output: {
        filename: path.basename(videoOutputPath),
        ...videoMetadata,
        bytes: videoBytes.length,
        sha256: sha256(videoBytes),
      },
      usagePresent: videoResult.usagePresent,
      thirdPartyConsumeMoneyPresent: videoResult.thirdPartyConsumeMoneyPresent,
    };
    process.stdout.write(`${JSON.stringify({ ok: true, model: VIDEO_MODEL, width: videoMetadata.width, height: videoMetadata.height, durationSeconds: videoMetadata.durationSeconds })}\n`);

    report.completedAt = new Date().toISOString();
    report.success = true;
  } catch (error) {
    report.completedAt = new Date().toISOString();
    report.success = false;
    report.error = redact(error?.message || error, apiKey, secrets);
    throw error;
  } finally {
    const reportPath = path.join(outputDir, 'report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ report: reportPath, success: report.success })}\n`);
    await dispatcher.close().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`Vosr2 live verification failed: ${String(error?.message || error).replace(/https?:\/\/[^\s"']+/g, '[remote-url]').slice(0, 1_000)}\n`);
  process.exitCode = 1;
});
