const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'workflows');
const checkOnly = process.argv.includes('--check');
const savedAt = '2026-09-12T00:00:00.000Z';

function workflow(slug, title, label, outputType, data) {
  const actionId = `${slug}-action`;
  const outputId = `${slug}-output`;
  return {
    schema: 't8-workflow-fragment',
    version: 1,
    title,
    nodes: [
      {
        id: actionId,
        type: 'audio',
        position: { x: 40, y: 40 },
        data: {
          label,
          audioProviderMode: 'suno',
          sunoPlatform: 'seedance-nz',
          apiModel: data.sunoNzOperation,
          reuseResult: false,
          ...data,
        },
      },
      {
        id: outputId,
        type: 'output',
        position: { x: 860, y: 40 },
        data: { label: `${label} · 结果`, outputType },
      },
    ],
    edges: [{ id: `${slug}-edge`, source: actionId, target: outputId }],
    nodeCount: 2,
    edgeCount: 1,
    nodeTypes: ['audio', 'output'],
    topologyPreview: {
      nodes: [
        { id: actionId, type: 'audio', label, x: 8, y: 50 },
        { id: outputId, type: 'output', label: `${label} · 结果`, x: 92, y: 50 },
      ],
      edges: [{ source: actionId, target: outputId }],
    },
    savedAt,
  };
}

const workflows = {
  'suno-create-model.json': workflow(
    'suno-create-model',
    'Suno V6 · suno-create-model',
    '创建自定义模型（先批量导入 6–24 段音频）',
    'text',
    {
      sunoNzOperation: 'suno-create-model',
      sunoNzModelName: 'V6 Studio Voice',
      sunoNzLocalRefAudios: [],
      sunoNzLocalRefAudioNames: [],
    },
  ),
  'suno-upload-cover-description.json': workflow(
    'suno-upload-cover-description',
    'Suno V6 · suno-upload-cover · description mode',
    '上传音频翻唱 · 灵感描述模式（先导入 1 段音频）',
    'audio',
    {
      sunoNzOperation: 'suno-upload-cover',
      sunoNzVersion: 'v6-mini',
      sunoCustom: false,
      sunoInstrumental: false,
      sunoNzGptDescription: '将参考音频改编为克制、温暖的电影感器乐版本',
      sunoNzVocalGender: '',
      sunoNzVariety: 'normal',
      sunoNzAudioFormat: 'mp3',
      localRefAudio: '',
    },
  ),
  'suno-upload-cover-custom.json': workflow(
    'suno-upload-cover-custom',
    'Suno V6 · suno-upload-cover · custom mode',
    '上传音频翻唱 · 自定义模式（先导入 1 段音频）',
    'audio',
    {
      sunoNzOperation: 'suno-upload-cover',
      sunoNzVersion: 'v6-mini',
      sunoNzCustomModelId: '',
      sunoCustom: true,
      sunoInstrumental: false,
      prompt: '[Verse]\n雨落在未寄出的信上\n\n[Chorus]\n天亮以后我们重新出发',
      tags: 'cinematic pop, warm piano, restrained electronic rhythm',
      title: '天亮以后',
      sunoNzNegativeTags: 'harsh vocals, distortion',
      sunoNzStyleWeight: 0.5,
      sunoNzWeirdness: 0.5,
      sunoNzAudioWeight: 0.5,
      sunoNzAutoLyrics: false,
      sunoNzVocalGender: 'Female',
      sunoNzPersonaId: '',
      sunoNzTargetDurationSeconds: 30,
      sunoNzVariety: 'normal',
      sunoNzMaxMode: false,
      sunoNzAudioFormat: 'mp3',
      localRefAudio: '',
    },
  ),
  'suno-upload-extend.json': workflow(
    'suno-upload-extend',
    'Suno V6 · suno-upload-extend',
    '上传音频续写（先导入 1 段长于续写起点的音频）',
    'audio',
    {
      sunoNzOperation: 'suno-upload-extend',
      sunoNzVersion: 'v6-mini',
      sunoNzCustomModelId: '',
      continueAt: 2,
      prompt: '延续原曲的和声与节奏，进入温暖、克制的钢琴尾奏',
      tags: 'cinematic piano, restrained electronic rhythm',
      title: '尾奏',
      sunoNzNegativeTags: 'harsh vocals, distortion',
      sunoNzStyleWeight: 0.5,
      sunoNzWeirdness: 0.5,
      sunoNzAudioWeight: 0.5,
      sunoNzAutoLyrics: false,
      sunoNzVocalGender: '',
      sunoNzPersonaId: '',
      sunoNzTargetDurationSeconds: 10,
      sunoNzVariety: 'normal',
      sunoNzMaxMode: false,
      sunoNzAudioFormat: 'mp3',
      localRefAudio: '',
    },
  ),
};

fs.mkdirSync(outDir, { recursive: true });
let changed = 0;
for (const [name, value] of Object.entries(workflows)) {
  const target = path.join(outDir, name);
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  const actual = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (actual === expected) continue;
  changed += 1;
  if (!checkOnly) fs.writeFileSync(target, expected, 'utf8');
}

if (checkOnly && changed > 0) {
  console.error(`[suno-v6-workflows] ${changed} workflow file(s) are missing or stale`);
  process.exitCode = 1;
} else {
  console.log(`[suno-v6-workflows] ${checkOnly ? 'verified' : 'generated'} ${Object.keys(workflows).length} workflow files`);
}
