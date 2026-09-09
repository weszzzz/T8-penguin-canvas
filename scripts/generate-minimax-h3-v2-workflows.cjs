'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'docs', 'workflows');
const savedAt = '2026-09-06T00:00:00.000Z';

function uploadNode(id, label, uploadType, x, y) {
  return {
    id,
    type: 'upload',
    position: { x, y },
    data: { label, uploadType, lockedUploadType: uploadType },
  };
}

function videoNode(id, label, prompt, position, options = {}) {
  return {
    id,
    type: 'video',
    position,
    data: {
      label,
      mainId: 'hailuo-2.3',
      model: 'MiniMax-H3',
      videoBuiltinSource: 'seedance-nz',
      ratio: options.ratio || '16:9',
      duration: options.duration || 4,
      resolution: '480P',
      prompt,
      localPrompt: prompt,
      minimaxH3FirstFrameEnabled: options.firstFrame === true,
      minimaxH3LastFrameEnabled: options.lastFrame === true,
      minimaxH3DriveAudioEnabled: options.driveAudio === true,
      minimaxH3AudioMode: options.audioMode || 'api_default',
      minimaxH3DenoiseStrength: options.denoiseStrength ?? 0.35,
      minimaxH3AddDriveAsReference: options.addDriveAsReference || 'api_default',
      minimaxH3VideoStartSeconds: options.videoStartSeconds || [0, 0, 0],
      reuseResult: false,
    },
  };
}

function edge(source, target) {
  return { id: `${source}-to-${target}`, source, target };
}

function writeWorkflow(filename, title, nodes, edges) {
  const workflow = {
    schema: 't8-workflow-fragment',
    version: 1,
    title,
    nodes,
    edges,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeTypes: nodes.map((node) => node.type),
    topologyPreview: {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type,
        label: node.data.label,
        x: node.position.x + 50,
        y: node.position.y + 50,
      })),
      edges,
    },
    savedAt,
  };
  fs.writeFileSync(path.join(outputDir, filename), `${JSON.stringify(workflow, null, 2)}\n`);
}

const textVideo = videoNode(
  'minimax-h3-v2-text',
  'MiniMax-H3 文生视频',
  '清晨的纸风筝从安静海岸升起，镜头平稳跟随，柔和晨光与海面反射保持连续',
  { x: 0, y: 0 },
);
writeWorkflow(
  'MiniMax-H3-text-to-video.json',
  'MiniMax-H3 文生视频（贞贞的平价AI小屋 · V2）',
  [textVideo],
  [],
);

const firstFrame = uploadNode('minimax-h3-v2-first-frame', '上传首帧图', 'image', 0, 0);
const lastFrame = uploadNode('minimax-h3-v2-last-frame', '上传尾帧图', 'image', 0, 220);
const keyframeVideo = videoNode(
  'minimax-h3-v2-keyframes',
  'MiniMax-H3 首尾帧视频',
  '保持主体身份、服装、构图与光线一致，从首帧自然连续地过渡到尾帧，镜头缓慢推进',
  { x: 440, y: 40 },
  { firstFrame: true, lastFrame: true, ratio: 'adaptive' },
);
writeWorkflow(
  'MiniMax-H3-keyframes.json',
  'MiniMax-H3 首尾关键帧视频（贞贞的平价AI小屋 · V2）',
  [firstFrame, lastFrame, keyframeVideo],
  [edge(firstFrame.id, keyframeVideo.id), edge(lastFrame.id, keyframeVideo.id)],
);

const referenceImage = uploadNode('minimax-h3-v2-reference-image', '上传参考图', 'image', 0, 0);
const referenceVideo = uploadNode('minimax-h3-v2-reference-video', '上传参考视频', 'video', 0, 220);
const referenceAudio = uploadNode('minimax-h3-v2-reference-audio', '上传参考音频', 'audio', 0, 440);
const multimodalVideo = videoNode(
  'minimax-h3-v2-multimodal',
  'MiniMax-H3 多模态参考视频',
  '保持参考图中的主体和视觉风格，借鉴参考视频的镜头节奏，并跟随参考音频的情绪变化自然运动',
  { x: 440, y: 120 },
  { videoStartSeconds: [1.5, 0, 0] },
);
writeWorkflow(
  'MiniMax-H3-multimodal-reference.json',
  'MiniMax-H3 多模态参考视频（贞贞的平价AI小屋 · V2）',
  [referenceImage, referenceVideo, referenceAudio, multimodalVideo],
  [
    edge(referenceImage.id, multimodalVideo.id),
    edge(referenceVideo.id, multimodalVideo.id),
    edge(referenceAudio.id, multimodalVideo.id),
  ],
);

const driveImage = uploadNode('minimax-h3-v2-drive-image', '上传参考图', 'image', 0, 0);
const driveAudio = uploadNode('minimax-h3-v2-drive-audio-input', '上传驱动音频', 'audio', 0, 240);
const driveVideo = videoNode(
  'minimax-h3-v2-drive-audio',
  'MiniMax-H3 驱动音频视频',
  '保持参考图中的人物身份与场景风格，动作和表情自然跟随驱动音频，镜头稳定连贯',
  { x: 440, y: 60 },
  { driveAudio: true, audioMode: 'lock_source', denoiseStrength: 0 },
);
writeWorkflow(
  'MiniMax-H3-drive-audio.json',
  'MiniMax-H3 驱动音频视频（贞贞的平价AI小屋 · V2）',
  [driveImage, driveAudio, driveVideo],
  [edge(driveImage.id, driveVideo.id), edge(driveAudio.id, driveVideo.id)],
);

console.log('generated 4 MiniMax-H3 V2 workflows');
