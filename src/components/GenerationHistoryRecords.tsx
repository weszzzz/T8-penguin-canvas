import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { historyErrorText } from '../i18n/generationHistoryCatalog';
import { listGenerationHistory } from '../services/api';
import { useGenerationHistory } from '../hooks/useGenerationHistory';
import GenerationHistorySettings from './GenerationHistorySettings';
import { supportsHistorySettings, supportsHistoryInputDraft } from '../utils/generationHistorySettings';
import type { HistorySettingsReview } from '../types/generationHistory';
import type { GenerationHistoryGroup, GenerationHistoryOutput, GenerationHistoryQuery, GenerationHistorySourceIdentity, HistoryKindFilter } from '../types/generationHistory';

const tabs: HistoryKindFilter[] = ['all', 'image', 'video', 'audio', 'text', 'model3d', 'other'];

function OutputPreview({ output, unavailable, onUnavailable, onRetry }: {
  output: GenerationHistoryOutput; unavailable: boolean; onUnavailable: () => void; onRetry: () => void;
}) {
  const { t } = useTranslation('canvas');
  const dialog = useRef<HTMLDialogElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const fail = () => { dialog.current?.close(); setPreviewOpen(false); onUnavailable(); };
  if (!output.mediaUrl) return <p className="t8-history-unavailable">{t(output.availability === 'changed' ? 'generationHistory.changed' : 'generationHistory.unavailable')} · <span data-i18n-skip>{output.title}</span></p>;
  if (unavailable) return <div className="t8-history-unavailable" role="status"><p>{t('generationHistory.previewUnavailable')}</p><button type="button" onClick={onRetry}>{t('generationHistory.retryPreview')}</button></div>;
  if (output.kind === 'image') return <>
    <button className="t8-history-image-open" type="button" title={t('generationHistory.enlarge')} aria-label={t('generationHistory.enlargeNamed', { title: output.title })} onClick={() => { setPreviewOpen(true); dialog.current?.showModal(); }}><img src={output.mediaUrl} alt={output.title} loading="lazy" onError={fail} /></button>
    <dialog ref={dialog} className="t8-history-image-dialog" aria-label={output.title} onClose={() => setPreviewOpen(false)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <form method="dialog"><button type="submit" autoFocus>{t('generationHistory.closePreview')}</button></form>
      {previewOpen && <img src={output.mediaUrl} alt={output.title} onError={fail} />}
    </dialog>
  </>;
  if (output.kind === 'video') return <video src={output.mediaUrl} controls preload="none" aria-label={output.title} onError={fail} />;
  if (output.kind === 'audio') return <audio src={output.mediaUrl} controls preload="none" aria-label={output.title} onError={fail} />;
  return <a href={output.mediaUrl} target="_blank" rel="noreferrer">{t('generationHistory.viewNamed', { title: output.title })}</a>;
}

function HistoryCard({ group, query, onFocusNode, onPlace, onPrepareSettings, onPrepareInputDraft }: {
  group: GenerationHistoryGroup; query: GenerationHistoryQuery;
  onFocusNode: (id: string, expected?: GenerationHistorySourceIdentity) => void;
  onPlace: (output: GenerationHistoryOutput) => Promise<void>;
  onPrepareSettings?: (group: GenerationHistoryGroup) => Promise<HistorySettingsReview>;
  onPrepareInputDraft?: (group: GenerationHistoryGroup) => Promise<HistorySettingsReview>;
}) {
  const { t, i18n } = useTranslation('canvas');
  const [expanded, setExpanded] = useState<GenerationHistoryOutput[]>([]);
  const [more, setMore] = useState(group.hasMoreOutputs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [placed, setPlaced] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState<Record<string, boolean>>({});
  const expansion = useRef<AbortController | null>(null);
  useEffect(() => {
    setExpanded([]); setMore(group.hasMoreOutputs);
    return () => { expansion.current?.abort(); };
  }, [group]);
  const outputs = [...group.outputs, ...expanded];
  const expand = async () => {
    setBusy(true); setError('');
    const abort = new AbortController();
    expansion.current?.abort(); expansion.current = abort;
    try {
      const result = await listGenerationHistory({ ...query, groupId: group.id, outputOffset: outputs.length }, { signal: abort.signal });
      if (abort.signal.aborted) return;
      const next = result.groups[0];
      setExpanded(previous => [...previous, ...next.outputs]); setMore(next.hasMoreOutputs);
    } catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '展开失败，请重试'); }
    finally { if (expansion.current === abort) setBusy(false); }
  };
  const place = async (output: GenerationHistoryOutput) => {
    setBusy(true); setError('');
    try { await onPlace(output); setPlaced(previous => [...previous, output.assetId]); }
    catch (error) { setError(error instanceof Error ? error.message : '未能放到画布，请重试'); }
    finally { setBusy(false); }
  };
  return <article className="t8-history-record" data-history-group={group.id}>
    <header><time dateTime={new Date(group.createdAt).toISOString()}>{group.recovered ? t('generationHistory.recoveredAt', { time: new Date(group.createdAt).toLocaleString(i18n.resolvedLanguage) }) : new Date(group.createdAt).toLocaleString(i18n.resolvedLanguage)}</time><span>{t('generationHistory.outputCount', { total: group.outputCount })}</span></header>
    <p className="t8-generation-history-source">{group.recovered ? t('generationHistory.localRecovery') : <><span data-i18n-skip>{group.model || group.nodeType || t('generationHistory.unknownModel')}</span>{!group.sourceNodeExists ? t(group.nodeEntityUid ? 'generationHistory.deletedSource' : 'generationHistory.uncertainSource') : ''}</>}</p>
    {group.promptPreview && <p className="t8-history-prompt" title={group.promptPreview} data-i18n-skip>{group.promptPreview}</p>}
    <div className={`t8-history-record-outputs${outputs.length > 1 ? ' is-batch' : ''}`}>{outputs.map(output => <div key={`${output.assetId}:${output.outputOrdinal}`}>
      <OutputPreview output={output} unavailable={!!unavailable[output.assetId]}
        onUnavailable={() => setUnavailable(previous => ({ ...previous, [output.assetId]: true }))}
        onRetry={() => setUnavailable(previous => ({ ...previous, [output.assetId]: false }))} />
      <div className="t8-generation-history-actions"><button type="button" disabled={busy || !output.mediaUrl || unavailable[output.assetId] || placed.includes(output.assetId) || !['image', 'video', 'audio', 'model3d'].includes(output.kind)} onClick={() => void place(output)}>
        {t(placed.includes(output.assetId) ? 'generationHistory.placed' : 'generationHistory.place')}
      </button></div>
    </div>)}</div>
    {more && <button className="t8-generation-history-more" type="button" disabled={busy} onClick={() => void expand()}>{t('generationHistory.expand')}</button>}
    <details><summary>{t('generationHistory.information')}</summary><p>{t('generationHistory.provider')}<span data-i18n-skip>{group.provider || t('generationHistory.unrecorded')}</span></p><p>{t('generationHistory.model')}<span data-i18n-skip>{group.model || t('generationHistory.unrecorded')}</span></p><p data-i18n-skip>{group.promptPreview || t('generationHistory.promptUnrecorded')}</p>
      {!group.snapshotAvailable && <p>{t('generationHistory.snapshotUnavailable')}</p>}
      {onPrepareSettings && group.snapshotAvailable && group.sourceNodeExists && supportsHistorySettings(group.nodeType)
        && <GenerationHistorySettings group={group} prepare={onPrepareSettings} />}
      {onPrepareInputDraft && group.snapshotAvailable && supportsHistoryInputDraft(group.nodeType)
        && <GenerationHistorySettings group={group} prepare={onPrepareInputDraft} newDraft />}
      {group.sourceNodeExists && group.nodeId && group.nodeEntityUid && <button type="button" onClick={() => onFocusNode(group.nodeId!, { projectId: query.projectId, canvasId: query.canvasId, nodeEntityUid: group.nodeEntityUid! })}>{t('generationHistory.locateSource')}</button>}
    </details>
    {error && <p role="alert">{historyErrorText(error, t)}</p>}
  </article>;
}

export default function GenerationHistoryRecords({ projectId, canvasId, nodeId, nodeEntityUid, refreshKey, onFocusNode, onPlace, onPrepareSettings, onPrepareInputDraft, onCount }: {
  projectId: string; canvasId: string; nodeId?: string; nodeEntityUid?: string; refreshKey: string;
  onFocusNode: (id: string, expected?: GenerationHistorySourceIdentity) => void;
  onPlace: (output: GenerationHistoryOutput) => Promise<void>;
  onPrepareSettings?: (group: GenerationHistoryGroup) => Promise<HistorySettingsReview>;
  onPrepareInputDraft?: (group: GenerationHistoryGroup) => Promise<HistorySettingsReview>;
  onCount: (count: number) => void;
}) {
  const { t } = useTranslation('canvas');
  const [kind, setKind] = useState<HistoryKindFilter>('all');
  const query = { projectId, canvasId, ...(nodeId ? { nodeId, nodeEntityUid } : {}), kind };
  const { page, loading, error, loadMore, reload } = useGenerationHistory(query, refreshKey);
  useEffect(() => { if (page) onCount(page.counts.all); }, [page, onCount]);
  return <>
    <nav className="t8-generation-history-tabs" aria-label={t('generationHistory.generationCategories')}>{tabs.filter(value => value !== 'other' || page?.counts.other).map(value => <button type="button" key={value} aria-pressed={kind === value} className={kind === value ? 'is-active' : ''} onClick={() => setKind(value)}>{t(`generationHistory.${value}`)} <b>{page?.counts[value] ?? '—'}</b></button>)}</nav>
    <div className="t8-generation-history-grid" aria-busy={loading}>
      {page?.groups.map(group => <HistoryCard key={`${projectId}:${canvasId}:${nodeId || ''}:${nodeEntityUid || ''}:${kind}:${group.id}`} group={group} query={query} onFocusNode={onFocusNode} onPlace={onPlace} onPrepareSettings={onPrepareSettings} onPrepareInputDraft={onPrepareInputDraft} />)}
      {!loading && !error && !page?.groups.length && <div className="t8-generation-history-empty">{t('generationHistory.emptyGenerated')}</div>}
      {loading && <p role="status">{t('generationHistory.loading')}</p>}
      {error && <div role="alert"><p>{historyErrorText(error, t)}</p><button type="button" onClick={reload}>{t('generationHistory.retryLoad')}</button></div>}
    </div>
    {page?.nextCursor && <button type="button" className="t8-generation-history-more" disabled={loading} onClick={() => void loadMore()}>{t('generationHistory.older')}</button>}
  </>;
}
