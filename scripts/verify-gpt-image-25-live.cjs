'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const sharp = require('sharp');
const { Agent: UndiciAgent, fetch: undiciFetch } = require('undici');

const MODELS = Object.freeze([
  'gpt-image-2.5-flare',
  'gpt-image-2.5-flare-2k',
  'gpt-image-2.5-flare-4k',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-sunburst-2k',
  'gpt-image-2.5-sunburst-4k',
]);
const BASE_URL = 'https://ai.t8star.org';
const RESPONSE_DEADLINE_MS = 15 * 60_000;
const DOWNLOAD_DEADLINE_MS = 5 * 60_000;
const MAX_REFERENCES = 14;
const dispatcher = new UndiciAgent({
  connectTimeout: 30_000,
  headersTimeout: RESPONSE_DEADLINE_MS,
  bodyTimeout: RESPONSE_DEADLINE_MS,
});

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function readSecretLine() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      const mutedOutput = new Writable({
        write(_chunk, _encoding, callback) { callback(); },
      });
      const input = readline.createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
      input.question('', (line) => {
        input.close();
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

function redact(value, apiKey) {
  let text = String(value || '');
  if (apiKey) text = text.split(apiKey).join('[REDACTED]');
  return text.replace(/https?:\/\/[^\s"']+/g, '[remote-url]').slice(0, 1_000);
}

async function fetchOnce(url, init, deadlineMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('deadline exceeded')), deadlineMs);
  try {
    return await undiciFetch(url, { ...init, dispatcher, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response, apiKey) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status} returned non-JSON: ${redact(text, apiKey)}`);
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || text;
    throw new Error(`HTTP ${response.status}: ${redact(message, apiKey)}`);
  }
  return body;
}

async function downloadResult(item, apiKey) {
  const encoded = String(item?.b64_json || '').trim().replace(/^data:image\/[^;]+;base64,/, '');
  if (encoded) return Buffer.from(encoded, 'base64');
  const url = String(item?.url || '').trim();
  if (!/^https:\/\//i.test(url)) throw new Error('result item contains neither b64_json nor an HTTPS URL');
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetchOnce(url, { method: 'GET' }, DOWNLOAD_DEADLINE_MS);
      if (!response.ok) throw new Error(`download HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(redact(lastError?.message || 'download failed', apiKey));
}

async function persistResults(body, label, outputDir, apiKey) {
  const items = Array.isArray(body?.data) ? body.data : [];
  if (!items.length) throw new Error('response contains no image data');
  const outputs = [];
  for (let index = 0; index < items.length; index += 1) {
    const bytes = await downloadResult(items[index], apiKey);
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) throw new Error('downloaded bytes are not a decodable image');
    const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
    const filename = `${label}-${index + 1}.${extension}`;
    fs.writeFileSync(path.join(outputDir, filename), bytes);
    outputs.push({
      filename,
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return outputs;
}

async function referencePng(index) {
  const hue = (index * 47) % 360;
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
      <rect width="256" height="256" fill="hsl(${hue},70%,72%)"/>
      <circle cx="128" cy="112" r="72" fill="hsl(${(hue + 120) % 360},65%,42%)"/>
      <text x="128" y="216" text-anchor="middle" font-size="38" font-family="Arial" fill="#111">${index}</text>
    </svg>
  `);
  return sharp(svg).png().toBuffer();
}

async function submitGeneration(model, apiKey) {
  const startedAt = Date.now();
  const response = await fetchOnce(`${BASE_URL}/v1/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: 'A simple red circle centered on a clean white background.',
      quality: 'low',
      size: '1024x1024',
      n: 1,
      moderation: 'auto',
    }),
  }, RESPONSE_DEADLINE_MS);
  return { body: await readJson(response, apiKey), httpStatus: response.status, durationMs: Date.now() - startedAt };
}

async function submitEdit(referenceCount, apiKey) {
  const form = new FormData();
  form.append('model', MODELS[0]);
  form.append('prompt', 'Create one clean color chart inspired by every numbered reference image.');
  form.append('quality', 'low');
  form.append('size', '1024x1024');
  form.append('n', '1');
  form.append('moderation', 'auto');
  for (let index = 1; index <= referenceCount; index += 1) {
    const bytes = await referencePng(index);
    form.append('image', new Blob([bytes], { type: 'image/png' }), `reference-${index}.png`);
  }
  const startedAt = Date.now();
  const response = await fetchOnce(`${BASE_URL}/v1/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, RESPONSE_DEADLINE_MS);
  return { body: await readJson(response, apiKey), httpStatus: response.status, durationMs: Date.now() - startedAt };
}

async function main() {
  const apiKey = process.argv.includes('--api-key-stdin')
    ? await readSecretLine()
    : String(process.env.ZHENZHEN_GPT_IMAGE_25_API_KEY || '').trim();
  if (!apiKey) throw new Error('API key is required through stdin or ZHENZHEN_GPT_IMAGE_25_API_KEY');
  const allModels = process.argv.includes('--all-models');
  const editCount = Math.trunc(Number(argument('edit-count', '0')) || 0);
  if (editCount < 0 || editCount > MAX_REFERENCES) throw new Error(`edit-count must be 0..${MAX_REFERENCES}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const outputDir = path.resolve(argument('output', path.join('output', `gpt-image-25-live-${stamp}`)));
  fs.mkdirSync(outputDir, { recursive: true });
  const report = {
    schema: 't8-gpt-image-25-live-verification-v1',
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    requestPolicy: 'paid POST requests are never retried automatically',
    models: [],
    edit: null,
  };
  const models = allModels ? MODELS : [MODELS[0]];
  try {
    for (const model of models) {
      const result = await submitGeneration(model, apiKey);
      const outputs = await persistResults(result.body, model, outputDir, apiKey);
      report.models.push({ model, mode: 'text_to_image', httpStatus: result.httpStatus, durationMs: result.durationMs, outputs });
      process.stdout.write(`${JSON.stringify({ ok: true, model, mode: 'text_to_image', outputs: outputs.map(({ width, height, format }) => ({ width, height, format })) })}\n`);
    }
    if (editCount) {
      const result = await submitEdit(editCount, apiKey);
      const outputs = await persistResults(result.body, `edit-${editCount}-references`, outputDir, apiKey);
      report.edit = { model: MODELS[0], mode: 'image_edit', referenceCount: editCount, httpStatus: result.httpStatus, durationMs: result.durationMs, outputs };
      process.stdout.write(`${JSON.stringify({ ok: true, model: MODELS[0], mode: 'image_edit', referenceCount: editCount, outputs: outputs.map(({ width, height, format }) => ({ width, height, format })) })}\n`);
    }
    report.completedAt = new Date().toISOString();
    report.success = true;
  } catch (error) {
    report.completedAt = new Date().toISOString();
    report.success = false;
    report.error = redact(error?.message || error, apiKey);
    throw error;
  } finally {
    fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ report: path.join(outputDir, 'report.json'), success: report.success })}\n`);
    await dispatcher.close().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`GPT Image 2.5 live verification failed: ${String(error?.message || error).slice(0, 1_000)}\n`);
  process.exitCode = 1;
});
