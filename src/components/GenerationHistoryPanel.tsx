import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import GenerationHistoryRecords from './GenerationHistoryRecords';
import GenerationHistoryRecovery from './GenerationHistoryRecovery';
import type { GenerationHistoryGroup, GenerationHistoryOutput, GenerationHistorySourceIdentity, HistorySettingsReview } from '../types/generationHistory';
import {
  Box,
  Crosshair,
  ExternalLink,
  FileText,
  History,
  Image as ImageIcon,
  Music,
  Video,
  X,
} from 'lucide-react';
import {
  GENERATION_HISTORY_KIND_ORDER,
  GENERATION_HISTORY_LIMITS,
  countGenerationHistoryByKind,
  type GenerationHistoryItem,
  type GenerationHistoryKind,
  type GenerationHistoryTab,
} from '../utils/generationHistory';

interface GenerationHistoryPanelProps {
  open: boolean;
  items: GenerationHistoryItem[];
  onClose: () => void;
  onFocusNode: (nodeId: string, expected?: GenerationHistorySourceIdentity) => void;
  projectId: string | null;
  canvasId: string | null;
  refreshKey: string;
  nodeId?: string;
  nodeEntityUid?: string;
  onClearNodeFilter: () => void;
  onPlace: (output: GenerationHistoryOutput) => Promise<void>;
  onPrepareSettings?: (group: GenerationHistoryGroup) => Promise<HistorySettingsReview>;
  onPrepareInputDraft?: (group: GenerationHistoryGroup) => Promise<HistorySettingsReview>;
  onCount: (count: number) => void;
  generationCount: number;
}

function HistoryKindIcon({ kind, size = 15 }: { kind: GenerationHistoryTab; size?: number }) {
  if (kind === 'image') return <ImageIcon size={size} />;
  if (kind === 'video') return <Video size={size} />;
  if (kind === 'audio') return <Music size={size} />;
  if (kind === 'text') return <FileText size={size} />;
  if (kind === 'model3d') return <Box size={size} />;
  return <History size={size} />;
}

function renderPreview(item: GenerationHistoryItem) {
  if (item.kind === 'image' && item.url) {
    return (
      <img
        src={item.url}
        alt={item.title}
        loading="lazy"
        className="t8-generation-history-thumb"
      />
    );
  }
  if (item.kind === 'video' && item.url) {
    return (
      <video
        src={item.url}
        className="t8-generation-history-thumb"
        controls
        muted
        preload="metadata"
      />
    );
  }
  if (item.kind === 'audio' && item.url) {
    return (
      <div className="t8-generation-history-audio">
        <Music size={18} />
        <audio src={item.url} controls preload="none" />
      </div>
    );
  }
  if (item.kind === 'text') {
    return <p className="t8-generation-history-text" data-i18n-skip>{item.textPreview}</p>;
  }
  return (
    <div className="t8-generation-history-file">
      <HistoryKindIcon kind={item.kind} size={18} />
      <span data-i18n-skip>{item.fileName || item.title}</span>
    </div>
  );
}

export default function GenerationHistoryPanel({
  open,
  items,
  onClose,
  onFocusNode,
  projectId, canvasId, refreshKey, nodeId, nodeEntityUid, onClearNodeFilter, onPlace, onPrepareSettings, onPrepareInputDraft, onCount, generationCount,
}: GenerationHistoryPanelProps) {
  const { t } = useTranslation('canvas');
  const [source, setSource] = useState<'generated' | 'current'>('generated');
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const nodeScopeKey = JSON.stringify([nodeId, nodeEntityUid]);
  const [filteredCount, setFilteredCount] = useState<{ key: string; count: number } | null>(null);
  useEffect(() => { if (open) setSource('generated'); }, [open, nodeId, nodeEntityUid, canvasId]);
  const [activeKind, setActiveKind] = useState<GenerationHistoryTab>('all');
  const [visibleLimit, setVisibleLimit] = useState(GENERATION_HISTORY_LIMITS.visiblePageSize);
  const [panelPosition, setPanelPosition] = useState({ top: 64, right: 12, maxHeight: 620 });
  const counts = useMemo(() => countGenerationHistoryByKind(items), [items]);
  const tabs = useMemo<GenerationHistoryTab[]>(() => ['all', ...GENERATION_HISTORY_KIND_ORDER], []);
  const filteredItems = useMemo(
    () => (activeKind === 'all' ? items : items.filter((item) => item.kind === activeKind)),
    [activeKind, items],
  );
  const visibleItems = filteredItems.slice(0, visibleLimit);
  const hasMore = visibleItems.length < filteredItems.length;

  useEffect(() => {
    if (open) setVisibleLimit(GENERATION_HISTORY_LIMITS.visiblePageSize);
  }, [activeKind, open, items.length]);

  useLayoutEffect(() => {
    if (!open || typeof window === 'undefined') return;
    let raf = 0;
    const updatePosition = () => {
      const toolbar = document.querySelector('.t8-canvas-toolbar');
      const rect = toolbar?.getBoundingClientRect();
      const top = Math.max(56, Math.round((rect?.bottom ?? 52) + 8));
      const right = Math.max(10, Math.round(window.innerWidth - (rect?.right ?? window.innerWidth - 12)));
      setPanelPosition({
        top,
        right,
        maxHeight: Math.max(220, Math.round(window.innerHeight - top - 12)),
      });
    };
    const schedule = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updatePosition);
    };
    updatePosition();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [open]);

  if (!open) return null;

  return (
    <aside
      className="t8-generation-history-panel nodrag nopan"
      data-canvas-floating-ui="generation-history"
      role="dialog"
      aria-label={t('generationHistory.title')}
      style={{
        top: panelPosition.top,
        right: panelPosition.right,
        maxHeight: panelPosition.maxHeight,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className="t8-generation-history-header">
        <div>
          <span>{t('generationHistory.title')}</span>
          <strong>{source === 'generated' ? (nodeId ? (filteredCount?.key === nodeScopeKey ? filteredCount.count : '—') : generationCount) : counts.all}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label={t('generationHistory.close')} title={t('generationHistory.close')}>
          <X size={15} />
        </button>
      </header>

      <nav className="t8-generation-history-tabs" aria-label={t('generationHistory.source')}>
        <button type="button" aria-pressed={source === 'generated'} onClick={() => setSource('generated')}>{t('generationHistory.generated')}</button>
        <button type="button" aria-pressed={source === 'current'} onClick={() => setSource('current')}>{t('generationHistory.current')}</button>
      </nav>
      {nodeId && source === 'generated' && <div className="t8-generation-history-actions"><span>{t('generationHistory.onlyNode')}</span><button type="button" onClick={onClearNodeFilter}>{t('generationHistory.wholeCanvas')}</button></div>}
      {source === 'generated' && projectId && canvasId && <GenerationHistoryRecovery key={`${projectId}:${canvasId}`} projectId={projectId} canvasId={canvasId} onRecovered={() => { setRecoveryEpoch(value => value + 1); onClearNodeFilter(); }} />}
      {source === 'generated' ? (projectId && canvasId
        ? <GenerationHistoryRecords key={`${projectId}:${canvasId}:${nodeScopeKey}`} projectId={projectId} canvasId={canvasId} nodeId={nodeId} nodeEntityUid={nodeEntityUid} refreshKey={`${refreshKey}:${recoveryEpoch}`} onFocusNode={onFocusNode} onPlace={onPlace} onPrepareSettings={onPrepareSettings} onPrepareInputDraft={onPrepareInputDraft} onCount={count => {
          if (nodeId) setFilteredCount(previous => previous?.key === nodeScopeKey && previous.count === count ? previous : { key: nodeScopeKey, count });
          else onCount(count);
        }} />
        : <p role="status">{t('generationHistory.canvasLoading')}</p>) : <>
      <nav className="t8-generation-history-tabs" aria-label={t('generationHistory.categories')}>
        {tabs.map((kind) => (
          <button
            key={kind}
            type="button"
            className={activeKind === kind ? 'is-active' : ''}
            data-history-kind={kind}
            onClick={() => setActiveKind(kind)}
            aria-pressed={activeKind === kind}
            title={t(`generationHistory.${kind}`)}
          >
            <HistoryKindIcon kind={kind} size={14} />
            <span>{t(`generationHistory.${kind}`)}</span>
            <b>{counts[kind]}</b>
          </button>
        ))}
      </nav>

      <div className="t8-generation-history-grid" data-history-visible-count={visibleItems.length}>
        {visibleItems.map((item) => (
          <article key={item.id} className="t8-generation-history-item" data-history-kind={item.kind as GenerationHistoryKind}>
            <div className="t8-generation-history-preview">{renderPreview(item)}</div>
            <div className="t8-generation-history-meta">
              <div className="t8-generation-history-title" title={item.title} data-i18n-skip>
                <HistoryKindIcon kind={item.kind} size={13} />
                <span>{item.title}</span>
              </div>
              <div className="t8-generation-history-source" title={item.subtitle} data-i18n-skip>
                {item.subtitle}
              </div>
              <div className="t8-generation-history-actions">
                <button type="button" onClick={() => onFocusNode(item.nodeId)} title={t('generationHistory.locateSource')}>
                  <Crosshair size={12} />
                  <span>{t('generationHistory.locate')}</span>
                </button>
                {item.url && (
                  <a href={item.url} target="_blank" rel="noreferrer" title={t('generationHistory.openAsset')}>
                    <ExternalLink size={12} />
                    <span>{t('generationHistory.open')}</span>
                  </a>
                )}
              </div>
            </div>
          </article>
        ))}
        {visibleItems.length === 0 && (
          <div className="t8-generation-history-empty">
            <History size={18} />
            <span>{t('generationHistory.emptyCurrent')}</span>
          </div>
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          className="t8-generation-history-more"
          onClick={() => setVisibleLimit((value) => value + GENERATION_HISTORY_LIMITS.visiblePageSize)}
        >
          {t('generationHistory.moreCurrent')}
        </button>
      )}
      </>}
    </aside>
  );
}
