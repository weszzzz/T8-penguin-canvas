import { useTranslation } from 'react-i18next';

type PreviousGenerationData = {
  showingPreviousResult?: unknown;
  videoUrl?: unknown;
  videoUrls?: unknown;
  status?: unknown;
};

/** A retained preview is not proof that every earlier output was archived. */
export default function PreviousGenerationNotice({ data }: { data?: PreviousGenerationData }) {
  const { t } = useTranslation('nodes');
  const hasVideo = (typeof data?.videoUrl === 'string' && Boolean(data.videoUrl.trim()))
    || (Array.isArray(data?.videoUrls) && data.videoUrls.some(url => typeof url === 'string' && url.trim()));
  if (data?.showingPreviousResult !== true || !hasVideo || data.status === 'success') return null;
  const busy = data.status === 'submitting' || data.status === 'polling';
  const description = busy ? 'generation.previousPending'
    : data.status === 'error' ? 'generation.previousFailed' : 'generation.previousIdle';

  return (
    <div
      className="nodrag rounded px-2 py-1.5 text-[11px] leading-4"
      role="status"
      aria-atomic="true"
      data-previous-generation-notice
      style={{
        border: '1px solid var(--t8-border, #71717a)',
        background: 'var(--t8-bg-panel, #ffffff)',
        color: 'var(--t8-text-main, #18181b)',
        overflowWrap: 'anywhere',
      }}
    >
      <strong className="block">{t('generation.previousTitle')}</strong>
      <span className="block">{t(description)}</span>
      <span className="block">{t('generation.previousHistoryHint')}</span>
    </div>
  );
}
