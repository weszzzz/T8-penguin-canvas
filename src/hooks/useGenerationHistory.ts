import { useCallback, useEffect, useRef, useState } from 'react';
import { listGenerationHistory } from '../services/api';
import type { GenerationHistoryPage, GenerationHistoryQuery } from '../types/generationHistory';

// Scope changes immediately hide the old page; aborted/late responses never
// leak another canvas's history into the currently displayed drawer.
export function useGenerationHistory(query: GenerationHistoryQuery | null, refreshKey: string) {
  const key = JSON.stringify(query);
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([key, refreshKey, retry]);
  const currentKey = useRef(requestKey);
  currentKey.current = requestKey;
  const [state, setState] = useState<{ key: string; requestKey: string; page?: GenerationHistoryPage; loading: boolean; error?: string }>({ key, requestKey, loading: false });
  const controller = useRef<AbortController | null>(null);
  const pagination = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    if (!query) { setState({ key, requestKey, loading: false }); return () => abort.abort(); }
    setState(previous => ({ key, requestKey, page: previous.key === key ? previous.page : undefined, loading: true }));
    const timer = window.setTimeout(() => {
      listGenerationHistory(query, { signal: abort.signal }).then(page => {
        if (!abort.signal.aborted && currentKey.current === requestKey) setState({ key, requestKey, page, loading: false });
      }).catch(error => {
        if (!abort.signal.aborted && currentKey.current === requestKey) setState(previous => ({
          key, requestKey, page: previous.key === key ? previous.page : undefined, loading: false,
          error: error instanceof Error ? error.message : '历史记录暂时无法读取',
        }));
      });
    }, 250);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [requestKey]);
  const loadMore = useCallback(async () => {
    if (!query || state.key !== key || state.requestKey !== requestKey || currentKey.current !== requestKey
      || state.loading || !state.page?.nextCursor) return;
    const abort = controller.current;
    if (!abort || abort.signal.aborted || pagination.current === abort) return;
    // React state is not a synchronous lock; repeated calls can share a render.
    pagination.current = abort;
    setState(previous => ({ ...previous, loading: true, error: undefined }));
    try {
      const next = await listGenerationHistory({ ...query, cursor: state.page.nextCursor }, { signal: abort.signal });
      if (abort.signal.aborted || currentKey.current !== requestKey) return;
      setState(previous => {
        if (previous.key !== key || previous.requestKey !== requestKey || !previous.page) return previous;
        const known = new Set(previous.page.groups.map(group => group.id));
        return { key, requestKey, loading: false, page: { ...next, groups: [...previous.page.groups, ...next.groups.filter(group => !known.has(group.id))] } };
      });
    } catch (error) {
      if (!abort.signal.aborted && currentKey.current === requestKey) setState(previous => ({ ...previous, loading: false,
        error: error instanceof Error ? error.message : '历史记录暂时无法读取' }));
    } finally {
      if (pagination.current === abort) pagination.current = null;
    }
  }, [key, requestKey, state, query]);
  return { ...(state.key === key ? { ...state, loading: state.loading || (Boolean(query) && state.requestKey !== requestKey) }
    : { key, loading: Boolean(query), page: undefined, error: undefined }), loadMore, reload: () => setRetry(value => value + 1) };
}
