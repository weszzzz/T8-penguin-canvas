import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { historyErrorText, historyReferenceLabel } from '../i18n/generationHistoryCatalog';
import type { GenerationHistoryGroup, HistorySettingsReview } from '../types/generationHistory';
import { HistoryReferenceRecoveryRequired } from '../utils/generationHistoryInputDraft';
import { HistoryRecoveryStoppedError } from '../utils/historyRecoveryFailure';

export default function GenerationHistorySettings({ group, prepare, newDraft = false }: {
  group: GenerationHistoryGroup; prepare: (group: GenerationHistoryGroup) => Promise<HistorySettingsReview>;
  newDraft?: boolean;
}) {
  const { t } = useTranslation('canvas');
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const recoveryRequest = useRef<AbortController | null>(null);
  const recoveryStopped = useRef(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const referencePicker = useRef<HTMLInputElement>(null);
  const [missingReference, setMissingReference] = useState<HistoryReferenceRecoveryRequired | null>(null);
  const [recoveryFile, setRecoveryFile] = useState<File | null>(null);
  const [review, setReview] = useState<HistorySettingsReview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loadedReferences, setLoadedReferences] = useState<number[]>([]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; recoveryRequest.current?.abort(); }; }, []);
  const open = async () => {
    if (recoveryStopped.current) return;
    setBusy(true); setError(''); setDone(false); setAcknowledged(false); setLoadedReferences([]); setReview(null);
    setMissingReference(null); setRecoveryFile(null);
    try {
      const result = await prepare(group);
      if (!mounted.current) return;
      setReview(result); dialog.current?.showModal();
    } catch (error) { if (mounted.current) {
      setError(error instanceof Error ? error.message : '读取历史设置失败');
      if (error instanceof HistoryReferenceRecoveryRequired && error.recover) setMissingReference(error);
    } }
    finally { if (mounted.current) setBusy(false); }
  };
  const apply = async () => {
    if (!review || (review.referenceWarning && !acknowledged)) return;
    setBusy(true); setError('');
    try { await review.apply(); if (mounted.current) { setDone(true); dialog.current?.close(); } }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : '填回失败，请重新读取'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const recoverReference = async () => {
    if (recoveryStopped.current || !missingReference?.recover || !recoveryFile || recoveryRequest.current) return;
    const request = new AbortController(); recoveryRequest.current = request; setBusy(true); setError('');
    try {
      await missingReference.recover(recoveryFile, request.signal);
      if (mounted.current) await open(); // Re-read durable mapping and verify every file again before review.
    } catch (error) { if (mounted.current) {
      if (error instanceof HistoryRecoveryStoppedError) {
        recoveryStopped.current = true; setRecoveryBlocked(true);
      }
      setError(error instanceof Error ? error.message : '参考文件找回失败');
    } }
    finally { recoveryRequest.current = null; if (mounted.current) setBusy(false); }
  };
  const isPrimaryField = (field: HistorySettingsReview['fields'][number]) => !field.advanced && (!newDraft || !review?.resolvedFrontendInputs
    || ['prompt', 'model', 'apiModel', 'providerModel', 'duration', 'ratio', 'resolution', 'aspectRatio', 'sizeLevel',
      'imageBuiltinSource', 'videoBuiltinSource', 'size', 'gptImage25Size', 'gptImage25Count', 'gptImage25CustomWidth', 'gptImage25CustomHeight',
      'falMode', 'falSize', 'falCustomW', 'falCustomH', 'falN', 'nbAspect', 'nbResolution', 'requestedImageSize',
      'vfRatio', 'vfDuration', 'vfResolution', 'vfAudio', 'requestedSafetyTolerance',
      'gkfMode', 'gkfRatio', 'gkfDuration', 'gkfResolution', 'soraMode', 'soraRatio', 'soraDuration', 'soraResolution',
      'zhenzhenImageG25Size', 'zhenzhenImageG25Resolution', 'zhenzhenImageG25Count', 'zhenzhenImageG25CustomWidth', 'zhenzhenImageG25CustomHeight'].includes(field.key));
  const renderField = (field: HistorySettingsReview['fields'][number]) => <section key={field.key}>
    <strong>{newDraft && field.key === 'prompt' ? t('generationHistory.effectivePrompt') : t(`generationHistory.field_${field.key}`, { defaultValue: field.label })}</strong><div className="t8-history-settings-diff">
      {!newDraft && <div><span>{t('generationHistory.currentDraft')}</span><pre data-i18n-skip>{field.beforeDefault ? t('generationHistory.unspecified') : field.before}</pre></div>}
      <div><span>{t(newDraft ? 'generationHistory.newDraftValue' : 'generationHistory.restoreValue')}</span><pre data-i18n-skip>{field.afterDefault ? t('generationHistory.unspecified') : field.after}</pre></div>
    </div>
  </section>;
  return <>
    <button className="t8-history-settings-open" type="button" disabled={busy || recoveryBlocked} onClick={() => void open()}>{t(newDraft ? 'generationHistory.newDraft' : 'generationHistory.restoreSettings')}</button>
    {done && <p role="status">{t(newDraft ? 'generationHistory.draftSaved' : 'generationHistory.settingsSaved')}</p>}
    {error && !dialog.current?.open && <p role="alert">{historyErrorText(error, t)}</p>}
    {missingReference && <section className="t8-history-reference-recovery">
      <p>{t('generationHistory.recoverReferenceHint', { label: historyReferenceLabel(missingReference.label, t) })}</p>
      <input ref={referencePicker} type="file" hidden disabled={busy || recoveryBlocked} accept="image/*,video/*,audio/*" aria-label={t('generationHistory.chooseReference', { label: historyReferenceLabel(missingReference.label, t) })} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file && file.size > 512 * 1024 * 1024) { setError('单文件不超过 512 MB'); setRecoveryFile(null); return; }
        setRecoveryFile(file || null); setError('');
      }} />
      <button type="button" disabled={busy || recoveryBlocked} onClick={() => referencePicker.current?.click()}>{t('generationHistory.chooseOriginal')}</button>
      {recoveryFile && <p data-i18n-skip>{recoveryFile.name}</p>}
      <button type="button" disabled={busy || recoveryBlocked || !recoveryFile} onClick={() => void recoverReference()}>{t(busy ? 'generationHistory.checkingOriginal' : 'generationHistory.confirmReference')}</button>
      <button type="button" disabled={busy} onClick={() => { setMissingReference(null); setRecoveryFile(null); setError(''); }}>{t('generationHistory.cancel')}</button>
    </section>}
    <dialog ref={dialog} className={`t8-history-settings-dialog${newDraft ? ' is-new-input' : ''}`} aria-label={t(newDraft ? 'generationHistory.confirmDraftTitle' : 'generationHistory.confirmSettingsTitle')} onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className="t8-history-settings-content">
      <h3>{t(newDraft ? 'generationHistory.newDraft' : 'generationHistory.restoreBasic')}</h3>
      <p>{t(newDraft ? 'generationHistory.draftHint' : 'generationHistory.settingsHint')}</p>
      <p>{t(newDraft ? review?.inputKind === 'standard-image' ? 'generationHistory.standardImageHint'
        : review?.inputKind === 'budget-image' ? 'generationHistory.budgetImageHint'
        : review?.inputKind === 'fal-image' ? 'generationHistory.falImageHint'
        : review?.inputKind === 'banana-image' ? 'generationHistory.bananaImageHint'
        : review?.inputKind === 'standard-video' ? 'generationHistory.standardVideoHint'
        : review?.inputKind === 'fal-video' ? 'generationHistory.falVideoHint'
        : review?.resolvedFrontendInputs ? 'generationHistory.resolvedHint' : 'generationHistory.basicHint' : 'generationHistory.keepCurrentHint')}</p>
      {newDraft && review?.inputKind === 'fal-image' && review.fields.some(field => field.key === 'falSize' && field.after === 'custom')
        && <p>{t('generationHistory.falCustomSizeHint')}</p>}
      {newDraft && review?.inputKind === 'banana-image' && review.fields.some(field => field.key === 'requestedImageSize')
        && <p>{t('generationHistory.bananaLiteSizeHint')}</p>}
      {newDraft && review?.inputKind === 'fal-video' && review.fields.some(field => field.key === 'requestedSafetyTolerance')
        && <p>{t('generationHistory.falVeoSafetyHint')}</p>}
      {review && <>
        <details><summary>{t('generationHistory.fullPrompt')}</summary><pre data-i18n-skip>{review.prompt || t('generationHistory.emptyPrompt')}</pre></details>
        <div className="t8-history-settings-fields">{review.fields.filter(isPrimaryField).map(renderField)}
          {review.fields.some(field => !isPrimaryField(field)) && <details><summary>{t('generationHistory.extraFields', { total: review.fields.filter(field => !isPrimaryField(field)).length })}</summary>
            {review.fields.filter(field => !isPrimaryField(field)).map(renderField)}
          </details>}
        </div>
        {!review.fields.length && <p>{t('generationHistory.sameSettings')}</p>}
        {newDraft && <section className="t8-history-input-references"><h4>{t('generationHistory.references', { total: review.references?.length || 0 })}</h4>
          {review.references?.map((ref, index) => <div key={`${index}:${ref.url}`}><span>{historyReferenceLabel(ref.label, t)}</span>
            {ref.kind === 'image' ? <img src={ref.url} alt={historyReferenceLabel(ref.label, t)}
              onLoad={() => setLoadedReferences(previous => previous.includes(index) ? previous : [...previous, index])}
              onError={() => { setLoadedReferences(previous => previous.filter(item => item !== index)); setError(`${ref.label} 预览失败，请取消后重新检查`); }} /> : <a href={ref.url} target="_blank" rel="noreferrer">{t('generationHistory.previewReference', { label: historyReferenceLabel(ref.label, t) })}</a>}
          </div>)}
        </section>}
        {review.referenceWarning && <label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
          {t('generationHistory.acknowledge')}
        </label>}
        {error && <p role="alert">{historyErrorText(error, t)}</p>}
      </>}
      </div>
      {review && <footer><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>{t('generationHistory.cancel')}</button>
          <button type="button" disabled={busy || !review.fields.length || (review.referenceWarning && !acknowledged)
            || (newDraft && loadedReferences.length < (review.references || []).filter(ref => ref.kind === 'image').length)} onClick={() => void apply()}>{t(busy ? 'generationHistory.saving' : newDraft ? 'generationHistory.confirmDraft' : 'generationHistory.confirmSettings')}</button></footer>
      }
    </dialog>
  </>;
}
