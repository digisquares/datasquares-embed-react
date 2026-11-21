'use client'
/**
 * useDataSquaresEmbed() — the embed's state as React state, so a host renders from it instead of wiring callbacks:
 *
 *   const embed = useDataSquaresEmbed()
 *   <DataSquaresEmbed {...embed.bind} baseUrl="…" getToken={…} />
 *   {embed.status === 'ready' && <PagePicker pages={embed.pages} value={embed.pageId} onChange={embed.setPage} />}
 *
 * Pass your own onReady / onError / onPageChange / onFilterChange / onStatusChange / onPointClick to the hook rather
 * than to the component next to `bind` (a prop written after the spread replaces the hook's).
 */
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import type { DataSquaresEmbedHandle, DataSquaresEmbedProps, EmbedError, EmbedStatus } from './DataSquaresEmbed.js'
import type { EmbedContentType, EmbedFilter, EmbedState } from './protocol.js'

type HookCallbacks = Pick<DataSquaresEmbedProps, 'onReady' | 'onError' | 'onStatusChange' | 'onPageChange' | 'onPointClick' | 'onFilterChange'>

/** Spread onto `<DataSquaresEmbed>`: its ref and the callbacks the hook reads state from. */
export type DataSquaresEmbedBinding = Required<Pick<DataSquaresEmbedProps, 'onReady' | 'onError' | 'onStatusChange' | 'onPageChange' | 'onFilterChange' | 'onPointClick'>> & {
  ref: RefObject<DataSquaresEmbedHandle | null>
}

export interface UseDataSquaresEmbed {
  bind: DataSquaresEmbedBinding
  status: EmbedStatus
  /** The last error, while `status` is `error` (cleared when it loads again). */
  error: EmbedError | null
  /** What the embed shows, once ready. */
  contentType: EmbedContentType | null
  /** A dashboard's pages (none for a report, a one-page dashboard or a presentation). */
  pages: Array<{ id: string; name: string }>
  /** The visible page, once the embed has said (null for content without pages). */
  pageId: string | null
  /** The current cross-filters. */
  filters: EmbedFilter[]
  setParams: (params: Record<string, unknown>) => void
  setPage: (pageId: string) => void
  refresh: () => void
  reload: () => void
  requestFullscreen: () => Promise<void>
  getState: (timeoutMs?: number) => Promise<EmbedState>
}

export function useDataSquaresEmbed(callbacks: HookCallbacks = {}): UseDataSquaresEmbed {
  const ref = useRef<DataSquaresEmbedHandle | null>(null)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const [status, setStatus] = useState<EmbedStatus>('loading')
  const [error, setError] = useState<EmbedError | null>(null)
  const [contentType, setContentType] = useState<EmbedContentType | null>(null)
  const [pages, setPages] = useState<Array<{ id: string; name: string }>>([])
  const [pageId, setPageId] = useState<string | null>(null)
  const [filters, setFilters] = useState<EmbedFilter[]>([])

  const bind = useMemo<DataSquaresEmbedBinding>(
    () => ({
      ref,
      onStatusChange: (next) => {
        setStatus(next)
        if (next !== 'error') setError(null)
        if (next === 'loading') {
          // A new page in the frame: nothing of the old one holds.
          setContentType(null)
          setPages([])
          setPageId(null)
          setFilters([])
        }
        callbacksRef.current.onStatusChange?.(next)
      },
      onReady: (info) => {
        setContentType(info.contentType)
        setPages(info.pages)
        // The page it opened on: the embed says when asked.
        if (info.pages.length > 0) {
          ref.current
            ?.getState()
            .then((state) => setPageId((current) => current ?? state.pageId))
            .catch(() => {})
        }
        callbacksRef.current.onReady?.(info)
      },
      onError: (err) => {
        setError(err)
        callbacksRef.current.onError?.(err)
      },
      onPageChange: (id) => {
        setPageId(id)
        callbacksRef.current.onPageChange?.(id)
      },
      onFilterChange: (next) => {
        setFilters(next)
        callbacksRef.current.onFilterChange?.(next)
      },
      onPointClick: (event) => callbacksRef.current.onPointClick?.(event),
    }),
    [],
  )

  const setParams = useCallback((p: Record<string, unknown>) => ref.current?.setParams(p), [])
  const setPage = useCallback((id: string) => ref.current?.setPage(id), [])
  const refresh = useCallback(() => ref.current?.refresh(), [])
  const reload = useCallback(() => ref.current?.reload(), [])
  const requestFullscreen = useCallback(
    () => ref.current?.requestFullscreen() ?? Promise.reject(new Error('DataSquares embed is not mounted.')),
    [],
  )
  const getState = useCallback(
    (timeoutMs?: number) => ref.current?.getState(timeoutMs) ?? Promise.reject(new Error('DataSquares embed is not mounted.')),
    [],
  )

  return { bind, status, error, contentType, pages, pageId, filters, setParams, setPage, refresh, reload, requestFullscreen, getState }
}
