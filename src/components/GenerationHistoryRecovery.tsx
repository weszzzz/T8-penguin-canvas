import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { historyErrorText } from '../i18n/generationHistoryCatalog';
import { terminalHistoryRecoveryFailure } from '../utils/historyRecoveryFailure';
import { HISTORY_RECOVERY_TIMEOUT, HistoryRequestTimeoutError, withHistoryRequestDeadline } from '../utils/historyRequestDeadline';

export default function GenerationHistoryRecovery({ projectId, canvasId, onRecovered }: {
  projectId: string; canvasId: string; onRecovered: () => void;
}) {
  const { t } = useTranslation('canvas');
  const picker = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const stopped = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ key: string; values?: Record<string, string | number> } | null>(null);
  const [blocked, setBlocked] = useState('');
  useEffect(() => () => request.current?.abort(), [projectId, canvasId]);
  const recover = async () => {
    if (request.current || stopped.current || !files.length || blocked) return;
    const abort = new AbortController(); request.current = abort;
    setBusy(true);
    let added = 0, duplicate = 0;
    const failed: File[] = [];
    let terminalMessage = '';
    for (const [index, file] of files.entries()) {
      if (abort.signal.aborted) break;
      setMessage({ key: 'generationHistory.recoveryProgress', values: { index: index + 1, total: files.length, name: file.name } });
      try {
        const body = new FormData(); body.append('file', file);
        const { response, result } = await withHistoryRequestDeadline(300000, abort.signal, async signal => {
          const response = await fetch(`/api/project-runs/generation-history/recover?${new URLSearchParams({ projectId, canvasId })}`, {
            method: 'POST', body, signal, credentials: 'same-origin',
          });
          return { response, result: await response.json() };
        }, HISTORY_RECOVERY_TIMEOUT);
        const terminalFailure = terminalHistoryRecoveryFailure(result);
        if (!response.ok && terminalFailure) {
          terminalMessage = terminalFailure;
          stopped.current = true;
          setBlocked(terminalFailure);
          failed.push(...files.slice(index)); // Includes this unconfirmed file and untouched remaining files.
          break;
        }
        if (!response.ok || !result.success || !result.data?.assetId) throw new Error('找回失败');
        if (result.data.duplicate) duplicate++; else added++;
      } catch (error) {
        if (abort.signal.aborted) break;
        if (error instanceof HistoryRequestTimeoutError) {
          terminalMessage = HISTORY_RECOVERY_TIMEOUT; stopped.current = true; setBlocked(terminalMessage);
          failed.push(...files.slice(index));
          break; // Do not queue more writes while the first write's outcome is unknown.
        }
        failed.push(file);
      }
    }
    if (!abort.signal.aborted) {
      setMessage({ key: terminalMessage ? 'generationHistory.recoveryPartial' : failed.length ? 'generationHistory.recoveryFailed' : 'generationHistory.recoveryDone',
        values: { added, duplicate, failed: failed.length } });
      setFiles(failed); setBusy(false); request.current = null;
      if (added || duplicate || terminalMessage) onRecovered();
    }
  };
  return <div className="t8-history-recovery">
    <input ref={picker} type="file" multiple accept="image/*,video/*,audio/*" hidden disabled={busy || !!blocked} aria-label={t('generationHistory.selectFiles')} onChange={event => {
      const selected = Array.from(event.target.files || []); event.target.value = '';
      if (selected.length > 50 || selected.some(file => file.size > 512 * 1024 * 1024)) { setMessage({ key: 'generationHistory.fileLimit' }); return; }
      setFiles(selected); setMessage(null);
    }} />
    <button type="button" disabled={busy || !!blocked} onClick={() => picker.current?.click()}>{t('generationHistory.recoverFiles')}</button>
    {!!files.length && <div>
      <p>{t('generationHistory.selectedFiles', { total: files.length })}</p>
      <details><summary>{t('generationHistory.viewSelected')}</summary>{files.map((file, index) => <p key={index} data-i18n-skip>{file.name}</p>)}</details>
      <button type="button" disabled={busy || !!blocked} onClick={() => void recover()}>{t(busy ? 'generationHistory.recovering' : 'generationHistory.confirmRecovery')}</button>
      <button type="button" disabled={busy} onClick={() => setFiles([])}>{t('generationHistory.cancel')}</button>
    </div>}
    {message && <p role="status">{t(message.key, message.values)}</p>}
    {blocked && <div><p role="alert">{historyErrorText(blocked, t)}</p><button type="button" onClick={onRecovered}>{t('generationHistory.refresh')}</button></div>}
  </div>;
}
