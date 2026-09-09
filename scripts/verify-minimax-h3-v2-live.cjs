'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const ffprobe = require('@ffprobe-installer/ffprobe').path;
const provider = require('../backend/src/providers/seedanceNz.js');

const apiKey = String(process.env.MINIMAX_H3_V2_API_KEY || '').trim();
if (!apiKey) {
  console.error('Missing process-only MINIMAX_H3_V2_API_KEY.');
  process.exit(2);
}

const outputDir = path.resolve(__dirname, '..', 'output', 'minimax-h3-v2-live-20260906');
const videoPath = path.join(outputDir, 'MiniMax-H3-480P-4s.mp4');
const reportPath = path.join(outputDir, 'report.json');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeError(error) {
  const code = String(error?.code || '').trim();
  const status = Number(error?.status || 0);
  return {
    ...(code && /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? { code } : {}),
    ...(status >= 400 && status <= 599 ? { status } : {}),
    message: 'MiniMax-H3 live verification failed; inspect the local backend diagnostics without exposing credentials.',
  };
}

async function downloadVideo(url) {
  const response = await provider.fetchRemote(url, { method: 'GET' });
  if (!response.ok) throw Object.assign(new Error('Generated video download failed'), { status: response.status });
  const advertised = Number(response.headers.get('content-length') || 0);
  if (advertised > 1024 * 1024 * 1024) throw new Error('Generated video exceeds the 1 GiB verification boundary');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024 || !buffer.subarray(0, 32).includes(Buffer.from('ftyp'))) {
    throw new Error('Generated result is not a valid MP4 payload');
  }
  return buffer;
}

function probeVideo(filePath) {
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height:format=duration',
    '-of', 'json',
    filePath,
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('ffprobe could not decode the generated video');
  const payload = JSON.parse(result.stdout || '{}');
  const stream = payload.streams?.[0];
  const duration = Number(payload.format?.duration || 0);
  if (!stream?.codec_name || !(stream.width > 0) || !(stream.height > 0) || !(duration > 0)) {
    throw new Error('ffprobe returned incomplete video metadata');
  }
  return { codec: stream.codec_name, width: stream.width, height: stream.height, durationSeconds: duration };
}

function verifyFullVideoDecode(filePath) {
  const result = spawnSync(ffmpeg, [
    '-v', 'error',
    '-i', filePath,
    '-map', '0:v:0',
    '-f', 'null',
    '-',
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('ffmpeg could not fully decode the generated video stream');
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  let pollCount = 0;
  try {
    console.log('Submitting MiniMax-H3 V2 live verification (480P, 4s, 16:9)...');
    const submitted = await provider.submitHailuoTask({
      model: 'MiniMax-H3',
      prompt: 'A small paper kite rises above a quiet shoreline at sunrise, one continuous steady camera move, stable lighting and composition.',
      duration: 4,
      resolution: '480P',
      ratio: '16:9',
    }, apiKey);

    let completed = null;
    const deadline = Date.now() + 60 * 60 * 1000;
    while (Date.now() < deadline) {
      await wait(5000);
      pollCount += 1;
      const result = await provider.queryMinimaxH3V2Task(submitted.taskId, apiKey);
      console.log(`Poll ${pollCount}: ${result.status}`);
      if (result.status === 'succeeded') {
        if (!result.videoUrl) throw new Error('Succeeded task has no result URL');
        completed = result;
        break;
      }
      if (result.status === 'failed') throw new Error('MiniMax-H3 task failed');
    }
    if (!completed) throw new Error('MiniMax-H3 task exceeded the verification timeout');

    console.log('Downloading and decoding the generated video...');
    const buffer = await downloadVideo(completed.videoUrl);
    fs.writeFileSync(videoPath, buffer);
    const media = probeVideo(videoPath);
    verifyFullVideoDecode(videoPath);
    const report = {
      schema: 't8-live-verification',
      version: 1,
      provider: 'seedance-nz',
      channel: 'zhenzhen-budget-ai-house',
      model: 'MiniMax-H3',
      createEndpoint: '/v2/video_generation',
      queryEndpoint: '/v2/query/video_generation/{task_id}',
      request: { mode: 'text-to-video', duration: 4, resolution: '480P', ratio: '16:9' },
      status: 'succeeded',
      pollCount,
      artifact: {
        file: path.relative(path.resolve(__dirname, '..'), videoPath).replace(/\\/g, '/'),
        bytes: buffer.length,
        sha256: sha256(buffer),
        ...media,
        fullDecodeVerified: true,
      },
      startedAt,
      completedAt: new Date().toISOString(),
      credentialPersisted: false,
      taskIdPersisted: false,
      signedUrlPersisted: false,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`MiniMax-H3 V2 live verification succeeded: ${buffer.length} bytes, ${media.width}x${media.height}, ${media.durationSeconds.toFixed(3)}s.`);
  } catch (error) {
    const report = {
      schema: 't8-live-verification',
      version: 1,
      provider: 'seedance-nz',
      channel: 'zhenzhen-budget-ai-house',
      model: 'MiniMax-H3',
      status: 'failed',
      pollCount,
      startedAt,
      completedAt: new Date().toISOString(),
      error: safeError(error),
      credentialPersisted: false,
      taskIdPersisted: false,
      signedUrlPersisted: false,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(report.error.message);
    process.exitCode = 1;
  } finally {
    delete process.env.MINIMAX_H3_V2_API_KEY;
  }
}

void main();
