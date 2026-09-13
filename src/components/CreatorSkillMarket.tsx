import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { BookOpen, ChevronLeft, Download, FolderOpen, LoaderCircle, Search, X } from 'lucide-react';
import {
  getCreatorSkillCatalogV2, getCreatorSkillDetailsV2, importCreatorSkillV2, installCreatorSkillV2,
  listCreatorSkillsV2, prepareCreatorSkillV2, setCreatorSkillStatusV2, updateCreatorSkillV2,
  type CreatorInstalledSkillV2, type CreatorSkillCatalogItemV2,
} from '../services/creatorAgentV2';
import './creatorSkillMarket.css';

type Copy = (zh: string, en: string) => string;
interface Props {
  projectId: string;
  canvasId: string;
  copy: Copy;
  onClose: () => void;
  onUse: (item: CreatorInstalledSkillV2) => void;
}

export function skillCanBeUsed(item: CreatorInstalledSkillV2) {
  return item.status === 'active' && item.compatibility !== 'unavailable' && item.compatibility !== 'revoked';
}

export function skillFailureText(error: unknown, copy: Copy) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (/VERSION_STALE|TASK_CONFLICT|UPDATE_REQUIRED/.test(code)) return copy('技能版本已经变化，请刷新后重新选择。原草稿仍然保留。', 'This skill version changed. Refresh and choose again; your draft is safe.');
  if (/REVOKED|DISABLED/.test(code)) return copy('这个技能已禁用或撤回。原作品仍然保留，请选择其他技能。', 'This skill is disabled or withdrawn. Existing work is safe; choose another skill.');
  if (/INPUT_STALE|ASSET_SCOPE/.test(code)) return copy('技能引用的素材或节点已经变化，请重新选择当前素材。', 'The referenced materials or nodes changed. Select the current materials again.');
  if (/ACTION_UNSUPPORTED|CONTEXT_TOO_LARGE/.test(code)) return copy('这项操作超出技能当前支持范围，请查看技能详情或改用普通创作。', 'This operation is outside the skill’s supported scope. Check its details or use ordinary creation.');
  if (/MODEL_REQUIRED|MODEL_STALE/.test(code)) return copy('技能需要兼容的生成模型，请检查生成设置。原草稿和素材仍然保留。', 'This skill needs a compatible generation model. Check generation settings; your draft and materials are safe.');
  if (/TOO_LARGE|UPLOAD_LIMIT|STORE_LIMIT/.test(code)) return copy('技能文件数量或体积超过限制。最多 128 个文件、总计 16 MB，ZIP 最多 8 MB。', 'The skill exceeds its file or size limit: up to 128 files, 16 MB total, or an 8 MB ZIP.');
  if (/CATALOG_UNTRUSTED|INTEGRITY/.test(code)) return copy('技能来源或完整性校验没有通过，未启用此版本。', 'The source or integrity check failed. This version was not activated.');
  if (/METADATA|ROOT_INVALID|PATH_|FILE_|UPLOAD_INVALID/.test(code)) return copy('请导入完整技能：主文件须为 SKILL.md，并保留引用资料的相对目录。', 'Import a complete skill with a main SKILL.md file and its original relative resource folders.');
  return copy('技能操作没有完成，请重试。原草稿和素材没有变化。', 'The skill operation did not finish. Try again; your draft and materials are unchanged.');
}

function capabilityLabel(item: CreatorInstalledSkillV2, copy: Copy) {
  if (item.compatibility === 'revoked') return copy('已撤回', 'Withdrawn');
  if (item.compatibility === 'unavailable') return copy('文件不可用', 'Files unavailable');
  if (item.status === 'disabled') return copy('已禁用', 'Disabled');
  if (item.compatibility === 'reference-only') return copy('仅作参考 · 有未支持步骤', 'Reference only · unsupported steps');
  if (item.compatibility === 'image-adapter') return copy('图片创作 · 沿用生成设置', 'Image creation · uses generation settings');
  if (item.compatibility === 'video-adapter') return copy('视频创作 · 沿用生成设置', 'Video creation · uses generation settings');
  return copy('文本创作', 'Text creation');
}

function diagnosticLabel(code: string, copy: Copy) {
  switch (code) {
    case 'external-tools': return copy('声明的外部工具不会自动安装或执行。', 'Declared external tools are not installed or executed.');
    case 'scripts-retained': return copy('脚本仅保留，不执行。', 'Script files are retained, not executed.');
    case 'external-resource': return copy('外部链接仅保留为文字，不自动访问。', 'External links remain text and are not visited.');
    case 'unsafe-reference': return copy('参考路径越界或不兼容。', 'A reference path is unsafe or incompatible.');
    case 'missing-resource': return copy('缺少包内参考资料，请核对原始说明。', 'A referenced resource is missing. Check the original instructions.');
    case 'resource-adapter-required': return copy('有参考资料尚无可用的读取适配。', 'A referenced resource does not yet have a supported reader.');
    default: return copy('技能资料需要检查，暂未确认可用。', 'The skill resources need checking; availability is not confirmed.');
  }
}

export default function CreatorSkillMarket({ projectId, canvasId, copy, onClose, onUse }: Props) {
  const titleId = useId();
  const listId = useId();
  const shell = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const readAbort = useRef<AbortController | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const [tab, setTab] = useState<'featured' | 'mine'>('featured');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<CreatorInstalledSkillV2[]>([]);
  const [catalog, setCatalog] = useState<CreatorSkillCatalogItemV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState('');
  const [limit, setLimit] = useState(12);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getCreatorSkillDetailsV2>> | null>(null);

  const refresh = useCallback(async () => {
    readAbort.current?.abort();
    const controller = new AbortController();
    readAbort.current = controller;
    setLoading(true);
    setLoadError(false);
    const results = await Promise.allSettled([
      listCreatorSkillsV2(projectId, canvasId, controller.signal),
      getCreatorSkillCatalogV2(projectId, canvasId, controller.signal),
    ]);
    if (!alive.current || controller.signal.aborted) return;
    if (results[0].status === 'fulfilled') setItems(results[0].value.items);
    if (results[1].status === 'fulfilled') setCatalog(results[1].value.items);
    setLoadError(results.some(result => result.status === 'rejected'));
    setLoading(false);
  }, [projectId, canvasId]);

  useEffect(() => {
    alive.current = true;
    const opener = document.activeElement;
    // A modal must also exclude the covered canvas/chat from keyboard and
    // assistive navigation. Restore pre-existing inert states on close.
    const covered = new Map<HTMLElement, boolean>();
    const ancestry: Array<{ parent: HTMLElement; child: Element }> = [];
    let child: Element | null = shell.current;
    while (child?.parentElement) {
      const parent: HTMLElement = child.parentElement;
      ancestry.push({ parent, child });
      if (parent === document.body) break;
      child = parent;
    }
    const cover = () => {
      for (const { parent, child: activeChild } of ancestry) for (const sibling of parent.children) {
        if (sibling === activeChild || !(sibling instanceof HTMLElement)) continue;
        if (!covered.has(sibling)) covered.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    };
    cover();
    const observer = new MutationObserver(cover);
    for (const { parent } of ancestry) observer.observe(parent, { childList: true });
    search.current?.focus();
    void refresh();
    return () => {
      alive.current = false;
      readAbort.current?.abort();
      uploadAbort.current?.abort();
      observer.disconnect();
      for (const [element, wasInert] of covered) element.inert = wasInert;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [refresh]);

  useEffect(() => {
    if (detail) shell.current?.querySelector<HTMLElement>('.t8-skill-market__body > button')?.focus();
    else search.current?.focus();
  }, [detail]);

  const perform = async (key: string, operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setError('');
    setNotice('');
    try { await operation(); }
    catch (cause) {
      if (alive.current) setError(skillFailureText(cause, copy));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy('');
    }
  };

  const useInstalled = (item: CreatorInstalledSkillV2) => void perform(item.id, async () => {
    // Read-only historical details must not approve an old version for a new task.
    const latest = await prepareCreatorSkillV2(projectId, canvasId, item.id, item.packageDigest);
    if (!skillCanBeUsed(latest.item)) throw Object.assign(new Error(), { code: 'CREATOR_SKILL_DISABLED' });
    if (alive.current) onUse(latest.item);
  });

  const useFeatured = (entry: CreatorSkillCatalogItemV2) => void perform(entry.id, async () => {
    const installed = items.find(item => item.id === `official:${entry.id}`);
    let selected: CreatorInstalledSkillV2;
    if (installed && installed.packageDigest !== entry.packageDigest) {
      selected = (await updateCreatorSkillV2(projectId, canvasId, installed.id, installed.packageDigest, entry.packageDigest)).item;
    } else {
      selected = (await installCreatorSkillV2(projectId, canvasId, entry.id, entry.packageDigest)).item;
    }
    const prepared = await prepareCreatorSkillV2(projectId, canvasId, selected.id, selected.packageDigest);
    if (!skillCanBeUsed(prepared.item)) throw Object.assign(new Error(), { code: 'CREATOR_SKILL_DISABLED' });
    if (alive.current) onUse(prepared.item);
  });

  const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    if (!files.length) return;
    void perform('import', async () => {
      const controller = new AbortController();
      uploadAbort.current = controller;
      await importCreatorSkillV2(projectId, canvasId, files, controller.signal);
      if (!alive.current) return;
      setTab('mine');
      setQuery('');
      setNotice(copy('已加入我的技能。选择“使用”后再填写需求；尚未发送或生成。', 'Added to My skills. Choose Use and describe your task; nothing has been sent or generated.'));
      await refresh();
    });
  };

  const status = (item: CreatorInstalledSkillV2, next: 'active' | 'disabled' | 'retained') => void perform(item.id, async () => {
    await setCreatorSkillStatusV2(projectId, canvasId, item.id, item.packageDigest, next);
    if (!alive.current) return;
    setDetail(null);
    setNotice(next === 'retained' ? copy('已从我的技能移除，已有任务和作品仍保留。', 'Removed from My skills. Existing tasks and work are preserved.') : copy('技能状态已更新。', 'Skill status updated.'));
    await refresh();
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const source = tab === 'featured' ? catalog : items;
    return source.filter(item => {
      const presentation = 'origin' in item ? item.definition?.presentation : item.presentation;
      return !needle || `${item.title} ${item.description || ''} ${presentation?.titleEn || ''} ${presentation?.descriptionEn || ''}`.toLocaleLowerCase().includes(needle);
    });
  }, [catalog, items, query, tab]);

  return <section ref={shell} className="t8-skill-market" role="dialog" aria-modal="true" aria-labelledby={titleId}
    data-i18n-skip="true" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (detail) setDetail(null); else onClose(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(shell.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not([type="file"]), summary, [tabindex="0"]') || [])
        .filter(element => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className="t8-skill-market__header">
      <div><BookOpen size={20} aria-hidden="true" /><h2 id={titleId}>{copy('技能市场', 'Skill library')}</h2></div>
      <button type="button" aria-label={copy('关闭技能市场', 'Close skill library')} onClick={onClose}><X size={19} /></button>
    </header>
    <p className="t8-skill-market__intro">{copy('选一种好方法，把你的素材变成作品。', 'Choose a method. Make it yours with your materials.')}</p>
    {detail ? <div className="t8-skill-market__body">
      <button type="button" onClick={() => setDetail(null)}><ChevronLeft size={16} />{copy('返回技能列表', 'Back to skills')}</button>
      <h3>{copy(detail.item.title, detail.item.definition?.presentation?.titleEn || detail.item.title)}</h3><p>{capabilityLabel(detail.item, copy)}</p>
      <p>{copy('来源、适配范围与效果验证是不同的状态。', 'Source, compatibility, and quality verification are separate.')}</p>
      <dl><dt>{copy('版本', 'Version')}</dt><dd>{detail.item.version}</dd><dt>{copy('许可', 'License')}</dt><dd>{detail.item.license || copy('未声明；请自行确认使用权限', 'Not declared; check your usage rights')}</dd></dl>
      {detail.item.diagnostics.length > 0 && <div className="t8-skill-market__warning">{copy('此包有未支持步骤或缺少资料，只能作为参考，不代表原技能已全部执行。', 'This package has unsupported steps or missing resources. Reference use does not mean every original step can run.')}<ul>{detail.item.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}>{diagnosticLabel(item.code, copy)}</li>)}</ul></div>}
      <details><summary>{copy('查看原始说明与文件', 'View original instructions and files')}</summary><pre>{detail.instructions}</pre><ul>{detail.files.map(file => <li key={file.path}>{file.path} · {Math.ceil(file.size / 1024)} KB</li>)}</ul></details>
      <div className="t8-skill-market__actions"><button type="button" className="is-primary" disabled={Boolean(busy) || !skillCanBeUsed(detail.item)} onClick={() => useInstalled(detail.item)}>{copy('使用这个技能', 'Use this skill')}</button><button type="button" disabled={Boolean(busy)} onClick={() => status(detail.item, detail.item.status === 'active' ? 'disabled' : 'active')}>{detail.item.status === 'active' ? copy('禁用', 'Disable') : copy('启用', 'Enable')}</button><button type="button" disabled={Boolean(busy)} onClick={() => status(detail.item, 'retained')}>{copy('移除，保留旧作品', 'Remove, keep existing work')}</button></div>
    </div> : <>
      <div className="t8-skill-market__navigation">
        <div role="tablist" aria-label={copy('技能列表', 'Skill lists')} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'featured' : event.key === 'End' ? 'mine' : tab === 'mine' ? 'featured' : 'mine';
          setTab(next); setLimit(12);
          document.getElementById(`${listId}-${next}`)?.focus();
        }}>{(['featured', 'mine'] as const).map(value => <button key={value} id={`${listId}-${value}`} type="button" role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} aria-controls={listId} onClick={() => { setTab(value); setLimit(12); }}>{value === 'featured' ? copy('精选', 'Featured') : copy('我的', 'My skills')}</button>)}</div>
        <label className="t8-skill-market__search"><Search size={16} aria-hidden="true" /><input ref={search} type="search" value={query} maxLength={100} aria-label={copy('搜索技能', 'Search skills')} placeholder={copy('搜目标或创作方法', 'Search a goal or method')} onChange={event => { setQuery(event.target.value); setLimit(12); }} /></label>
      </div>
      <div className="t8-skill-market__body" id={listId} role="tabpanel" aria-labelledby={`${listId}-${tab}`}>
        {loading && <p role="status"><LoaderCircle size={16} className="animate-spin" />{copy('正在读取技能…', 'Loading skills…')}</p>}
        {loadError && <div className="t8-skill-market__warning" role="status">{copy('部分技能列表暂时未连上。已显示内容仍可查看，普通画布不受影响。', 'Part of the library could not load. You can still browse available items and use the canvas.')}<button type="button" onClick={() => void refresh()} disabled={loading}>{copy('重新读取', 'Retry')}</button></div>}
        {!loading && !filtered.length && <div className="t8-skill-market__empty"><BookOpen size={32} aria-hidden="true" /><h3>{query ? copy('没有找到匹配技能', 'No matching skills') : tab === 'featured' ? copy('精选技能正在准备', 'Featured skills are being prepared') : copy('把常用方法放在这里', 'Keep your creative methods here')}</h3><p>{query ? copy('试试更短的目标词，或清空搜索。', 'Try a shorter goal or clear the search.') : copy('可以从“导入技能”添加已有的 SKILL.md、ZIP 或完整文件夹。', 'Import an existing SKILL.md, ZIP, or complete skill folder.')}</p></div>}
        <div className="t8-skill-market__grid">{filtered.slice(0, limit).map(entry => {
          const installed = tab === 'mine' ? entry as CreatorInstalledSkillV2 : items.find(item => item.id === `official:${entry.id}`);
          const upgrading = tab === 'featured' && installed && installed.packageDigest !== entry.packageDigest;
          const presentation = tab === 'mine' ? installed?.definition?.presentation : (entry as CreatorSkillCatalogItemV2).presentation;
          return <article key={`${tab}:${entry.id}`} className="t8-skill-market__card">
            <div className="t8-skill-market__badges"><span>{tab === 'featured' || installed?.origin === 'official' ? copy('官方来源', 'Official source') : copy('私人导入', 'Private import')}</span><span>{copy('效果未认证', 'Quality unverified')}</span></div>
            <h3>{copy(entry.title, presentation?.titleEn || entry.title)}</h3><p>{copy(entry.description || '查看详情了解具体方法和使用边界。', presentation?.descriptionEn || entry.description || 'See details for the method and its limitations.')}</p>
            {presentation && <dl className="t8-skill-market__io"><dt>{copy('需要', 'Input')}</dt><dd>{copy(presentation.inputZh, presentation.inputEn)}</dd><dt>{copy('得到', 'Output')}</dt><dd>{copy(presentation.outputZh, presentation.outputEn)}</dd></dl>}
            <small>{tab === 'mine' && installed ? capabilityLabel(installed, copy) : (entry as CreatorSkillCatalogItemV2).kind === 'text' ? copy('完整文本作品', 'Complete text work') : (entry as CreatorSkillCatalogItemV2).kind === 'image' ? copy('图片创作', 'Image creation') : copy('视频创作', 'Video creation')}</small>
            <div className="t8-skill-market__actions"><button type="button" className="is-primary" disabled={Boolean(busy) || (tab === 'mine' ? !installed || !skillCanBeUsed(installed) : (entry as CreatorSkillCatalogItemV2).revoked)} onClick={() => tab === 'mine' ? useInstalled(entry as CreatorInstalledSkillV2) : useFeatured(entry as CreatorSkillCatalogItemV2)}>{busy === entry.id ? copy('正在准备…', 'Preparing…') : upgrading ? copy(`更新至 ${entry.version} 并使用`, `Update to ${entry.version} and use`) : installed?.compatibility === 'reference-only' ? copy('用作参考', 'Use as reference') : copy('用这个创作', 'Use this method')}</button>
              {installed && <button type="button" disabled={Boolean(busy)} onClick={() => void perform(installed.id, async () => { const result = await getCreatorSkillDetailsV2(projectId, canvasId, installed.id, installed.packageDigest); if (alive.current) setDetail(result); })}>{copy('详情', 'Details')}</button>}
            </div>
          </article>;
        })}</div>
        {filtered.length > limit && <button type="button" className="t8-skill-market__more" onClick={() => setLimit(value => value + 12)}>{copy('显示更多', 'Show more')}</button>}
      </div>
    </>}
    {error && <p className="t8-skill-market__error" role="alert">{error}</p>}
    {notice && <p className="t8-skill-market__notice" role="status">{notice}</p>}
    <footer className="t8-skill-market__footer">
      <input ref={fileInput} type="file" hidden tabIndex={-1} aria-hidden="true" accept=".md,.zip" onChange={importFiles} />
      <input ref={folderInput} type="file" hidden tabIndex={-1} aria-hidden="true" multiple {...{ webkitdirectory: '' }} onChange={importFiles} />
      <button type="button" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><Download size={16} />{copy('导入技能', 'Import skill')}</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => folderInput.current?.click()}><FolderOpen size={16} />{copy('导入文件夹', 'Import folder')}</button>
      <small>{copy('安装不会发送需求或开始生成', 'Installing never sends or generates')}</small>
    </footer>
  </section>;
}
