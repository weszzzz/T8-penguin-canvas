import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GENERATION_HISTORY_LIMITS,
  buildGenerationHistoryDataKey,
  collectGenerationHistory,
  countGenerationHistoryItems,
  countGenerationHistoryByKind,
} from '../src/utils/generationHistory.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('generation history indexes generated canvas content without duplicating payloads', () => {
  const longText = '春日牧场提示词 '.repeat(80);
  const nodes = [
    {
      id: 'older-image',
      type: 'output',
      position: { x: 0, y: 0 },
      data: {
        label: '旧图像',
        createdAt: 10,
        imageUrls: ['/files/output/old.png'],
      },
    },
    {
      id: 'mixed-output',
      type: 'output',
      position: { x: 120, y: 40 },
      data: {
        title: '综合输出',
        completedAt: 30,
        imageUrls: ['/files/output/farm.png', '/files/output/farm.png'],
        videoUrls: ['/files/output/farm.mp4'],
        audioUrl: '/files/output/farm.wav',
        modelUrls: ['/files/output/barn.glb'],
        directOutputText: longText,
        textSegments: ['第一段', '第二段'],
      },
    },
  ];

  const items = collectGenerationHistory(nodes as any, {
    totalLimit: 20,
    perKindLimit: 10,
    textPreviewChars: 48,
  });
  const counts = countGenerationHistoryByKind(items);

  assert.equal(countGenerationHistoryItems(nodes as any, { totalLimit: 20, perKindLimit: 10 }), items.length);
  assert.equal(counts.image, 2);
  assert.equal(counts.video, 1);
  assert.equal(counts.audio, 1);
  assert.equal(counts.model3d, 1);
  assert.equal(counts.text, 3);
  assert.equal(items[0].nodeId, 'mixed-output');
  assert.equal(items.filter((item) => item.url === '/files/output/farm.png').length, 1);

  const textItem = items.find((item) => item.kind === 'text' && item.textPreview?.startsWith('春日牧场提示词'));
  assert.ok(textItem);
  assert.equal(textItem?.fullText, undefined);
  assert.ok((textItem?.textPreview || '').length <= 51);
  assert.match(textItem?.textPreview || '', /\.\.\.$/);
});

test('generation history caps per kind and total items for large canvases', () => {
  const nodes = Array.from({ length: 180 }, (_, index) => ({
    id: `node-${index}`,
    type: 'output',
    position: { x: index * 16, y: 0 },
    data: {
      completedAt: index,
      imageUrls: [`/files/output/image-${index}.png`],
      directOutputText: `文本输出 ${index}`,
    },
  }));

  const items = collectGenerationHistory(nodes as any, {
    totalLimit: 60,
    perKindLimit: 35,
    textPreviewChars: 80,
  });
  const counts = countGenerationHistoryByKind(items);

  assert.equal(items.length, 60);
  assert.equal(countGenerationHistoryItems(nodes as any, { totalLimit: 60, perKindLimit: 35 }), 60);
  assert.ok(counts.image <= 35);
  assert.ok(counts.text <= 35);
  assert.equal(items[0].nodeId, 'node-179');
  assert.equal(GENERATION_HISTORY_LIMITS.total <= 400, true);
  assert.equal(GENERATION_HISTORY_LIMITS.visiblePageSize <= 60, true);
});

test('generation history data key ignores node movement and changes only when output payload changes', () => {
  const baseNode = {
    id: 'output-1',
    type: 'output',
    position: { x: 0, y: 0 },
    data: {
      imageUrls: ['/files/output/a.png'],
      directOutputText: '第一版',
    },
  };

  const movedKey = buildGenerationHistoryDataKey([
    baseNode,
    { ...baseNode, position: { x: 800, y: 600 } },
  ] as any);
  const samePayloadKey = buildGenerationHistoryDataKey([
    baseNode,
    { ...baseNode, position: { x: -200, y: 420 } },
  ] as any);
  const changedPayloadKey = buildGenerationHistoryDataKey([
    baseNode,
    { ...baseNode, data: { ...baseNode.data, imageUrls: ['/files/output/b.png'] } },
  ] as any);

  assert.equal(movedKey, samePayloadKey);
  assert.notEqual(movedKey, changedPayloadKey);
});

test('generation history shortcut and drawer are wired through toolbar, canvas, and theme CSS', () => {
  const toolbar = read('../src/components/CanvasToolbar.tsx');
  const canvas = read('../src/components/Canvas.tsx');
  const panel = read('../src/components/GenerationHistoryPanel.tsx');
  const css = read('../src/styles/index.css');
  const features = read('../features.json');

  assert.match(toolbar, /History/);
  assert.match(toolbar, /historyCount:\s*number/);
  assert.match(toolbar, /onToggleHistory:\s*\(\)\s*=>\s*void/);
  assert.match(toolbar, /aria-pressed=\{historyOpen\}/);
  assert.match(toolbar, /t\('toolbar\.history'\)/);
  assert.match(read('../src/i18n/resources.ts'), /history: '历史记录'/);
  assert.match(read('../src/i18n/resources.ts'), /history: 'Generation history'/);

  assert.match(canvas, /api\.listGenerationHistory\(/);
  assert.match(canvas, /page\.counts\.all/);
  assert.doesNotMatch(canvas, /countGenerationHistoryItems\(nodes\)/);
  assert.match(canvas, /generationHistoryOpen \? collectGenerationHistory\(nodes\) : \[\]/);
  assert.match(canvas, /historyCount=\{generationHistoryCount\}/);
  assert.match(canvas, /const generationHistoryForExport = collectGenerationHistory\(nodesRef\.current\)/);
  assert.match(canvas, /generationHistory:\s*generationHistoryForExport/);
  assert.doesNotMatch(canvas, /historyCount=\{generationHistoryItems\.length\}/);
  assert.match(canvas, /<GenerationHistoryPanel/);
  assert.match(canvas, /focusGenerationHistoryNode/);

  assert.match(panel, /GENERATION_HISTORY_KIND_ORDER/);
  assert.match(panel, /loading="lazy"/);
  assert.match(panel, /visibleLimit/);
  assert.match(panel, /t\('generationHistory.moreCurrent'\)/);
  assert.match(panel, /GenerationHistoryRecords/);
  assert.match(panel, /t\('generationHistory.current'\)/);

  assert.match(css, /Generation history drawer v1/);
  assert.match(css, /\.t8-generation-history-panel/);
  assert.match(css, /\[data-theme-visual="farm-story"\] \.t8-generation-history-panel/);
  assert.match(css, /\.t8-generation-history-grid/);

  assert.match(features, /generationHistoryShortcut/);
});
