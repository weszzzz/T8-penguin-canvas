#!/usr/bin/env node
'use strict';

// Read-only, bounded views over the original documents; no generated feature facts.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const MANUAL = 'local-private/context-archive/20260912/SKILL.md';

function sections(source) {
  const lines = source.split(/\r?\n/);
  const entries = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mark = /^\s*(`{3,}|~{3,})/.exec(line);
    if (mark) {
      if (!fence) fence = mark[1];
      else if (mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,3})\s+(.+)/.exec(line);
    const update = /^> (\d{4}-\d{2}-\d{2} .+)/.exec(line);
    if (heading || update) entries.push({ line: i + 1, level: heading ? heading[1].length : 2, title: heading ? heading[2] : update[1], update: !!update });
  }
  return { lines, entries };
}

function readDocument(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }
function readSection(file, line) {
  const { lines, entries } = sections(readDocument(file));
  const index = entries.findIndex(entry => entry.line === Number(line));
  if (index < 0) throw new Error('Use a section start line returned by find/roadmap.');
  const entry = entries[index];
  const end = entries.slice(index + 1).find(next => next.level <= entry.level)?.line || lines.length + 1;
  return { source: `${file}:${entry.line}`, text: lines.slice(entry.line - 1, end - 1).join('\n') };
}

function query(command, args) {
  if (command === 'check') {
    const budgets = [['SKILL.md', 120, 12288], ['docs/project-context-current.md', 80, 8192]];
    const measured = budgets.map(([file, maxLines, maxBytes]) => {
      const text = readDocument(file);
      const lines = text.split(/\r?\n/).length;
      const bytes = Buffer.byteLength(text);
      if (lines > maxLines || bytes > maxBytes) throw new Error(`${file} exceeds context budget; archive/deduplicate before continuing.`);
      return { file, lines, bytes, maxLines, maxBytes };
    });
    JSON.parse(readDocument('features.json'));
    const manifest = JSON.parse(readDocument('local-private/context-archive/20260912/manifest.json'));
    const crypto = require('node:crypto');
    for (const entry of manifest.files) {
      if (!['SKILL.md', 'AGENTS.md', 'features.json', 'roadmap.md'].includes(entry.file)) throw new Error('Unknown archive entry.');
      const bytes = fs.readFileSync(path.join(ROOT, 'local-private/context-archive/20260912', entry.file));
      if (bytes.length !== entry.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Archive integrity failed: ${entry.file}`);
    }
    return { source: 'context budgets, feature JSON and original archive integrity', text: JSON.stringify(measured, null, 2) };
  }
  if (command === 'feature' || command === 'fields') {
    const key = args[0];
    const features = JSON.parse(readDocument('features.json'));
    if (!key || !Object.hasOwn(features, key)) throw new Error('Unknown feature key; use find first.');
    let value = features[key];
    for (const field of (args[1] || '').split('.').filter(Boolean)) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, field)) throw new Error('Unknown feature field.');
      value = value[field];
    }
    return { source: `features.json#${args.join('.')}`, text: JSON.stringify(command === 'fields' && value && typeof value === 'object' ? Object.keys(value) : value, null, 2) };
  }
  if (command === 'manual') return readSection(MANUAL, args[0]);
  if (command === 'roadmap-section') return readSection('roadmap.md', args[0]);
  if (command === 'find' || command === 'roadmap') {
    const needle = args.join(' ').toLocaleLowerCase();
    if (!needle) throw new Error('A keyword is required.');
    const matches = [];
    const file = command === 'find' ? MANUAL : 'roadmap.md';
    const entries = sections(readDocument(file)).entries;
    // Stable headings first; long dated progress notes must not bury operating rules.
    for (const entry of entries.filter(entry => !entry.update)) {
      if (entry.title.toLocaleLowerCase().includes(needle)) matches.push(`${command === 'find' ? 'manual' : 'roadmap-section'} ${entry.line} | ${entry.title.slice(0, 120)}`);
    }
    if (command === 'find') {
      const features = JSON.parse(readDocument('features.json'));
      const featureEntries = Object.entries(features).sort(([a], [b]) => Number(b.toLocaleLowerCase().includes(needle)) - Number(a.toLocaleLowerCase().includes(needle)));
      for (const [key, value] of featureEntries) {
        if (!`${key} ${JSON.stringify(value)}`.toLocaleLowerCase().includes(needle)) continue;
        matches.push(`feature ${key} | ${value?.status || typeof value}`);
      }
    }
    for (const entry of entries.filter(entry => entry.update)) {
      if (entry.title.toLocaleLowerCase().includes(needle)) matches.push(`${command === 'find' ? 'manual' : 'roadmap-section'} ${entry.line} | ${entry.title.slice(0, 120)}`);
    }
    return { source: command === 'find' ? 'features.json + archived manual headings' : file, text: matches.join('\n') || '(no matches)' };
  }
  throw new Error('Usage: node scripts/read-project-context.cjs check | find <keyword> | feature <key> [field.path] | fields <key> [field.path] | manual <line> | roadmap <keyword> | roadmap-section <line> [--offset N] [--limit N]');
}

function main(argv) {
  const positional = [];
  let offset = 0;
  let limit = 6000;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--offset' || argv[i] === '--limit') {
      const option = argv[i];
      const number = argv[++i];
      if (!/^\d+$/.test(number || '')) throw new Error('Pagination requires a non-negative integer.');
      const value = Number(number);
      if (!Number.isSafeInteger(value)) throw new Error('Pagination value is too large.');
      if (option === '--offset') offset = value;
      else limit = value;
    } else positional.push(argv[i]);
  }
  if (limit < 1 || limit > 12000) throw new Error('Limit must be 1..12000 characters.');
  const result = query(positional[0], positional.slice(1));
  const chars = Array.from(result.text);
  if (offset > chars.length) throw new Error('Offset exceeds document length.');
  const end = Math.min(offset + limit, chars.length);
  console.log(`[context] ${result.source}; characters ${offset}..${end} / ${chars.length}`);
  console.log(chars.slice(offset, end).join(''));
  if (end < chars.length) console.log(`\n[MORE: not fully read] Repeat the same command with --offset ${end} --limit ${limit}`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`[context] ${error.message}`); process.exitCode = 1; }
}
module.exports = { sections, query, main };
