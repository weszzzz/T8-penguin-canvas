'use strict';
// Opt-in, one paid POST per selected model, serial polling only. No retries of POST.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fixture = require('./suno-workshop-route-fixture.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  const apiKey = process.env.SUNO_WORKSHOP_LIVE_KEY;
  if (!apiKey || process.env.SUNO_WORKSHOP_LIVE_CONFIRM !== '1') throw new Error('Explicit live key and confirmation required');
  const selected = process.env.SUNO_WORKSHOP_LIVE_VERSION || 'v6 mini';
  const versions = selected === 'all' ? ['v6', 'v6 wild', 'v6 mini'] : [selected];
  if (versions.some(v => !['v6', 'v6 wild', 'v6 mini'].includes(v))) throw new Error('Invalid live version');
  const output = path.join(root, 'output', 'suno-v6-live-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const report = { passed: false, scope: 'generation-and-decoding-only-actual-submit-route-isolated-settings-ledger-no-GUI', cases: [] };
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  save(); console.log('Evidence directory:', output);
  const headers = { Authorization: `Bearer ${apiKey}` };
  const route = fixture({ apiKey, fetchResponse: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(120000) }) });
  for (const version of versions) {
    const item = { version, mv: route.resolve(version), passed: false, submitCount: 1, outputs: [] };
    report.cases.push(item); save();
    console.log(version, 'submitting once');
    const result = await route.submit({ version, mode: 'generate', title: 'Morning Lantern',
      prompt: '[Verse]\nMorning light across the bay\nLittle lantern leads the way\n[Chorus]\nStep by step we start anew\nGolden skies and ocean blue',
      tags: 'gentle acoustic pop, warm piano, clear vocals, brief song, peaceful ending' });
    item.submitStatus = result.status; save();
    if (result.status !== 200 || !result.body?.data?.clipIds?.length) throw new Error(`${version}: submission not confirmed; never replay automatically`);
    const ids = result.body.data.clipIds;
    if (ids.length > 4 || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id))) throw new Error('Invalid clip identity');
    const deadline = Date.now() + 900000;
    let completed;
    for (let poll = 1; Date.now() < deadline; poll++) {
      await new Promise(resolve => setTimeout(resolve, 15000));
      const response = await fetch(`https://ai.t8star.org/suno/feed/${encodeURIComponent(ids.join(','))}`, { headers, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`${version}: query HTTP ${response.status}; original task must not be resubmitted`);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('Unexpected query format');
      const clips = ids.map(id => body.find(c => c.id === id));
      if (clips.some(c => ['error', 'failed', 'failure'].includes(String(c?.status).toLowerCase()))) throw new Error(`${version}: Provider task failed`);
      if (clips.every(c => c && ['complete', 'completed', 'succeeded', 'success'].includes(String(c.status).toLowerCase()) && c.audio_url)) { completed = clips; break; }
      if (poll % 2 === 0) console.log(version, `pending (${poll * 15}s)`);
    }
    if (!completed) throw new Error(`${version}: query deadline, no paid retry`);
    for (const [index, clip] of completed.entries()) {
      const url = new URL(clip.audio_url);
      if (url.protocol !== 'https:') throw new Error('Non-HTTPS media refused');
      // Do not send the Workshop credential to a media host.
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Media HTTP ${response.status}`);
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; if (size > 50 * 1024 * 1024) throw new Error('Media exceeds bounded download');
        chunks.push(chunk);
      }
      if (size === 0) throw new Error('Empty media');
      const bytes = Buffer.concat(chunks);
      const filename = `${version.replaceAll(' ', '-')}-${index + 1}.mp3`;
      const target = path.join(output, filename); fs.writeFileSync(target, bytes, { flag: 'wx' });
      const probe = spawnSync(path.join(root, 'tools/ffmpeg-runtime/ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,sample_rate', '-of', 'json', target], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
      if (probe.status !== 0) throw new Error('Audio probe failed');
      const info = JSON.parse(probe.stdout); const duration = Number(info.format?.duration);
      if (!info.streams?.some(s => s.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid audio stream');
      const decode = spawnSync(path.join(root, 'tools/ffmpeg-runtime/ffmpeg.exe'), ['-v', 'error', '-threads', '1', '-i', target, '-map', '0:a:0', '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8', timeout: 60000 });
      if (decode.status !== 0) throw new Error('Audio decode failed');
      item.outputs.push({ filename, bytes: size, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), duration, decoded: true,
        returnedModel: /^[a-z0-9.-]+$/.test(String(clip.model_name || '')) ? clip.model_name : null });
      save();
    }
    item.passed = true; save(); console.log(version, 'complete:', item.outputs.length, 'decoded tracks');
  }
  report.passed = true;
  report.returnedModelIdentityMatches = report.cases.every(item => item.outputs.every(output => output.returnedModel === item.mv));
  save(); console.log('All selected requests generated and decoded; returned model identity matches:', report.returnedModelIdentityMatches);
}
main().catch(error => { console.error(String(error?.message || 'Live verification failed').replaceAll(process.env.SUNO_WORKSHOP_LIVE_KEY || '__no_key__', '[REDACTED]')); process.exitCode = 1; });
