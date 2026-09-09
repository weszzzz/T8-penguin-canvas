'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const sharp = require('sharp');
const { Agent: UndiciAgent, fetch: undiciFetch } = require('undici');
const seedanceNz = require('../backend/src/providers/seedanceNz');

const TASK_DEADLINE_MS = 30 * 60_000;
const REQUEST_DEADLINE_MS = 3 * 60_000;
const POLL_INTERVAL_MS = 8_000;
const MODELS = Object.freeze([
  'zhenzhen-image-g-v2.5-lowprice',
  'zhenzhen-image-g-v2.5-flare',
  'zhenzhen-image-g-v2.5-sunburst',
]);
const dispatcher = new UndiciAgent({
  connectTimeout: 30_000,
  headersTimeout: REQUEST_DEADLINE_MS,
  bodyTimeout: REQUEST_DEADLINE_MS,
});

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

function safeError(error, secrets) {
  let message = String(error?.message || error || 'unknown error');
  for (const secret of secrets) {
    if (secret) message = message.split(String(secret)).join('[REDACTED]');
  }
  return message.replace(/https?:\/\/[^\s"']+/g, '[remote-url]').slice(0, 1_000);
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('download deadline exceeded')), REQUEST_DEADLINE_MS);
  try {
    return await undiciFetch(url, { dispatcher, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(url) {
  const response = await fetchOnce(url);
  if (!response.ok) throw new Error(`output download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(String(metadata.format || ''))) {
    throw new Error('downloaded output is not a supported decodable image');
  }
  return { bytes, metadata };
}

async function runModel(model, request, apiKey, outputDir, secrets) {
  process.stdout.write(`${JSON.stringify({ phase: 'submit', model, paidPost: 1 })}\n`);
  const submission = await seedanceNz.submitImageTask(request, apiKey);
  secrets.push(submission.taskId);
  const startedAt = Date.now();
  let polls = 0;
  while (Date.now() - startedAt < TASK_DEADLINE_MS) {
    polls += 1;
    const result = await seedanceNz.queryImageTask(submission.taskId, apiKey);
    process.stdout.write(`${JSON.stringify({ phase: 'poll', model, poll: polls, state: result.status })}\n`);
    if (result.status === 'failed') throw new Error(`${model} task reached failed terminal state`);
    if (result.status === 'succeeded') {
      const remoteUrl = result.imageUrls?.[0] || result.imageUrl;
      if (!remoteUrl) throw new Error(`${model} succeeded without an output URL`);
      secrets.push(remoteUrl);
      const { bytes, metadata } = await downloadImage(remoteUrl);
      const extension = metadata.format === 'jpeg' ? 'jpg' : String(metadata.format || 'png');
      const filename = `${model}.${extension}`;
      fs.writeFileSync(path.join(outputDir, filename), bytes);
      return {
        model,
        mode: request.images?.length ? 'i2i' : 't2i',
        paidSubmitCount: 1,
        submitHttpStatus: submission.upstreamHttpStatus || null,
        polls,
        durationMs: Date.now() - startedAt,
        output: {
          filename,
          format: metadata.format,
          width: metadata.width,
          height: metadata.height,
          bytes: bytes.length,
          sha256: sha256(bytes),
        },
        usagePresent: Boolean(result.usage && typeof result.usage === 'object'),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`${model} did not finish within ${TASK_DEADLINE_MS / 60_000} minutes`);
}

async function main() {
  if (!process.argv.includes('--api-key-stdin')) throw new Error('use --api-key-stdin');
  const apiKey = await readSecretLine();
  if (!apiKey) throw new Error('API key is required through stdin');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const outputDir = path.resolve('output', `zhenzhen-image-g25-live-${stamp}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const secrets = [apiKey];
  const report = {
    schema: 't8-zhenzhen-image-g25-live-verification-v1',
    startedAt: new Date().toISOString(),
    endpoint: '/v1/image/generations',
    models: MODELS,
    paidSubmissionPolicy: 'exactly one POST per model; no automatic replay',
    credentialPersisted: false,
    taskIdPersisted: false,
    signedUrlPersisted: false,
    rawProviderResponsePersisted: false,
    results: [],
  };
  try {
    const lowprice = await runModel(MODELS[0], {
      model: MODELS[0],
      prompt: 'A tiny teal ceramic penguin figurine on a clean white studio table, product photograph',
      n: 1,
      size: '1:1',
      resolution: '1k',
      nsfw_check: false,
    }, apiKey, outputDir, secrets);
    report.results.push(lowprice);

    const flare = await runModel(MODELS[1], {
      model: MODELS[1],
      prompt: 'A small amber paper lantern glowing on a dark blue studio backdrop, centered editorial photograph',
      n: 1,
      size: '1:1',
      resolution: '1k',
      quality: 'low',
      output_format: 'png',
      background: 'auto',
      moderation: 'low',
    }, apiKey, outputDir, secrets);
    report.results.push(flare);

    const lowpriceBytes = fs.readFileSync(path.join(outputDir, lowprice.output.filename));
    const lowpriceMime = lowprice.output.format === 'jpeg' ? 'image/jpeg' : `image/${lowprice.output.format}`;
    const sunburst = await runModel(MODELS[2], {
      model: MODELS[2],
      prompt: 'Keep the figurine and composition, change the background to soft coral with a subtle paper texture',
      images: [`data:${lowpriceMime};base64,${lowpriceBytes.toString('base64')}`],
      n: 1,
      size: 'preserve_reference',
      resolution: '1k',
      quality: 'low',
      output_format: 'png',
      background: 'auto',
      moderation: 'low',
    }, apiKey, outputDir, secrets);
    report.results.push(sunburst);

    report.finishedAt = new Date().toISOString();
    report.ok = report.results.length === MODELS.length;
    fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ ok: true, models: report.results.map((item) => ({ model: item.model, mode: item.mode, output: item.output })) })}\n`);
  } catch (error) {
    report.finishedAt = new Date().toISOString();
    report.ok = false;
    report.error = safeError(error, secrets);
    fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    throw new Error(report.error);
  } finally {
    await dispatcher.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(error, []) })}\n`);
  process.exitCode = 1;
});
