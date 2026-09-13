import { useEffect, useState } from 'react';
import { preflightCreatorSkillV2, type CreatorMediaRef, type CreatorSkillSelectionV2 } from '../services/creatorAgentV2';
import { skillFailureText } from './CreatorSkillMarket';

interface Props {
  projectId: string; canvasId: string; sessionId?: string; skill: CreatorSkillSelectionV2;
  attachments: CreatorMediaRef[]; selectedNodeIds: string[]; settingsRevision: string;
  copy: (zh: string, en: string) => string;
  onSettings: () => void; onApiSettings: () => void;
}

export default function CreatorSkillReadiness(props: Props) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof preflightCreatorSkillV2>> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [responseKey, setResponseKey] = useState('');
  const [retry, setRetry] = useState(0);
  // Only identities and saved settings drive this read-only request. Typing
  // prompt text never uploads it or triggers repeated preflights.
  const inputKey = JSON.stringify({ projectId: props.projectId, canvasId: props.canvasId, sessionId: props.sessionId,
    skill: { id: props.skill.id, packageDigest: props.skill.packageDigest, taskId: props.skill.taskId },
    attachments: props.attachments.map(({ assetId, kind }) => ({ assetId, kind })), selectedNodeIds: props.selectedNodeIds });
  const requestKey = `${inputKey}:${props.settingsRevision}:${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(null); setResponseKey('');
    const timer = setTimeout(() => {
      void preflightCreatorSkillV2(JSON.parse(inputKey), controller.signal).then(value => {
        if (!controller.signal.aborted) { setResult(value); setResponseKey(requestKey); }
      }, cause => { if (!controller.signal.aborted) { setError(cause); setResponseKey(requestKey); } });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [inputKey, requestKey]);
  const copy = props.copy;
  if (responseKey !== requestKey) return <div className="t8-skill-readiness" role="status" data-i18n-skip="true">{copy('正在核对技能素材与生成设置…', 'Checking skill materials and generation settings…')}</div>;
  if (error) return <div className="t8-skill-readiness" role="status" data-i18n-skip="true">{skillFailureText(error, copy)} <button type="button" onClick={() => setRetry(value => value + 1)}>{copy('重新检查', 'Check again')}</button></div>;
  if (!result) return null;
  const { llm, media, input } = result.readiness;
  const issue = llm.state !== 'configured' ? llm : media.state !== 'configured' && media.state !== 'not-required' ? media : null;
  return <section className="t8-skill-readiness" data-i18n-skip="true" aria-label={copy('本次技能准备情况', 'Skill preparation')}>
    {issue ? <div role="status"><span>{issue.state === 'missing-credentials'
      ? copy('还需配置模型渠道；当前草稿会保留。', 'Set up the model service; your draft will be kept.')
      : copy('所选模型不兼容此技能素材，请调整生成设置。', 'The selected model is not compatible with these skill materials. Adjust generation settings.')}</span>
      <button type="button" onClick={issue.state === 'missing-credentials' ? props.onApiSettings : props.onSettings}>{issue.state === 'missing-credentials' ? copy('配置 API', 'Set up API') : copy('调整模型', 'Change model')}</button></div>
      : media.choice && <p>{copy('本次生成模型：', 'Generation model: ')}{media.choice.label}{media.automatic ? copy('（智能选择）', ' (automatic)') : ''}</p>}
    {input.state !== 'ready' && <p role="status">{input.state === 'missing'
      ? copy('请引用本次创作需要的素材，也可以先让助手整理方向。', 'Reference the material for this task, or ask the assistant to plan the direction first.')
      : copy('有多份主体素材，请说明本次使用哪一份。', 'Several subject references are linked. Specify which one to use for this task.')}</p>}
    {result.materials.length > 0 && <div className="t8-skill-readiness__materials">{result.materials.slice(0, 3).map(asset => <figure key={asset.assetId}>
      {asset.kind === 'image' && <img src={`/api/project-assets/${encodeURIComponent(asset.assetId)}/media`} alt="" loading="lazy" />}
      <figcaption>{asset.title || copy('已引用素材', 'Referenced material')}</figcaption>
    </figure>)}{result.materials.length > 3 && <small>{copy(`另有 ${result.materials.length - 3} 份素材`, `${result.materials.length - 3} more references`)}</small>}</div>}
    <small>{copy('配置检查不代表密钥已验证或作品质量已通过。', 'Configuration is checked locally; credentials and output quality are not yet verified.')}</small>
  </section>;
}
