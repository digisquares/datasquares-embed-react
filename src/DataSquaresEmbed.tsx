'use client'
/**
 * <DataSquaresEmbed> — the React component the DataSquares Embedded product
 * page describes: an iframe wrapper with typed events and host-side control.
 *
 * ── Trust model ─────────────────────────────────────────────────────────
 * The iframe holds the publisher's content; the host page is the less-trusted
 * party from DataSquares' point of view, and the embed is the less-trusted
 * party from the host's. So both directions are pinned:
 *
 *   - Inbound events are accepted only when `event.source` is THIS iframe's
 *     contentWindow AND `event.origin` is the DataSquares origin derived from
 *     `baseUrl`. Two embeds on one page cannot receive each other's events,
 *     and no other frame can speak as the embed.
 *   - Outbound commands are posted with that same exact origin as the target,
 *     never '*': if the iframe has been navigated elsewhere, commands go
 *     nowhere rather than to whatever now lives in it.
 *
 * The embed side independently refuses hosts that are not on the workspace's
 * allowed-domains list — this component doesn't (and couldn't) bypass that.
 *
 * ── Commands before the embed listens ───────────────────────────────────
 * A command posted while the frame is still loading reaches no one: the
 * embed's bridge only listens once its page has mounted. So commands wait in
 * a queue until the embed first speaks (it reports its height as soon as it
 * mounts, before anything else), and go out then. A new `src` loads a new
 * page, and commands wait again. Only the last `setParams`, `setPage` and
 * `refresh` wait — each replaces the one before, as it would in the embed.
 *
 * ── An embed that never speaks ──────────────────────────────────────────
 * The frame loads but its page never says a word when the embed cannot run
 * there: a wrong `baseUrl`, a host page whose Content-Security-Policy keeps
 * DataSquares out of frames, a `no-referrer` policy that hides the host (the
 * embed then stays silent by design), or a network that never answers. The
 * host would hear nothing at all; after `loadTimeoutMs` it hears `timeout`.
 *
 * ── Two keys: a person's signed token ───────────────────────────────────
 * For dashboards embedded in your own product for your own people, pass
 * `getToken`: a function that asks YOUR server for a short-lived token it
 * signed for the current person with your embed app's key (see `./server`).
 * The embed asks for it with `ds:token-request` — when it starts and again
 * before its session ends — and this component answers with `ds:token` at
 * the exact DataSquares origin. The token never rides in a URL, and the
 * app's secret never reaches the browser.
 *
 * ── Why referrerPolicy matters here ─────────────────────────────────────
 * The iframe carries an explicit `strict-origin-when-cross-origin` policy.
 * The embed identifies its host via the frame's referrer/ancestor origin (that
 * is what the workspace allowlist checks), so a site-wide `no-referrer` policy
 * on the host would make the embed unidentifiable — and an unidentifiable host
 * is REFUSED when a restriction is configured. The explicit attribute keeps
 * the origin (and only the origin) flowing regardless of the host's default.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  EMBED_PROTOCOL_VERSION,
  MAX_EMBED_TOKEN_CHARS,
  isEmbedOutMessage,
  type EmbedContentType,
  type EmbedErrorKind,
  type EmbedFilter,
  type EmbedInMessage,
  type EmbedState,
} from './protocol.js'
import { buildEmbedUrl, buildSessionEmbedUrl, embedOrigin as originOf } from './urls.js'
import { DEV, isInsecureRemote, warnOnce } from './dev.js'

/**
 * What `onError` hears: one of the embed's own kinds, or `timeout` — the frame loaded but the embed never spoke within
 * `loadTimeoutMs` (it cannot run there; see the README's troubleshooting).
 */
export type EmbedHostErrorKind = EmbedErrorKind | 'timeout'

/**
 * What `onError` hears. `cause` is set when your own `getToken` failed (it threw, or gave no usable token; `kind` is
 * then `invalid`) and on a `timeout` (an Error naming the likely reasons).
 */
export interface EmbedError {
  kind: EmbedHostErrorKind
  cause?: unknown
}

/** `loading` until the embed has rendered (`ready`) or could not (`error`); a new `src` or `reload()` loads again. */
export type EmbedStatus = 'loading' | 'ready' | 'error'

export interface DataSquaresEmbedProps {
  /** Your DataSquares app URL, e.g. `https://app.datasquares.ai`. */
  baseUrl: string
  /**
   * Two keys: returns a short-lived token YOUR server signed for the current
   * person with your embed app's key (`signEmbedToken` from
   * `@digisquares/datasquares-react/server`). Called when the embed
   * starts and whenever its session needs renewing. The token names the
   * content, so `contentId` and `token` are not used with it.
   */
  getToken?: () => Promise<string>
  /** A share link's dashboard, report or presentation id (with `token`). */
  contentId?: string
  /** A share link's token (the dashboard's Share dialog → Embed). Public: anyone holding it sees the view. */
  token?: string
  /** `light` | `dark`; omit to follow the embed's default. */
  theme?: 'light' | 'dark'
  /** Show the embed toolbar (default true, matching the embed page). */
  toolbar?: boolean
  /** Brand primary color, hex without the hash or any CSS color. */
  primaryColor?: string
  /** Your logo's URL (https), shown in the embed's toolbar. The "Powered by DataSquares" credit always shows. */
  logoUrl?: string
  /** The dashboard page to open on (its id). Changing it reloads the frame; to switch live, call `setPage`. */
  page?: string
  /** Initial dashboard parameter values, rendered into the URL as p_* pairs. */
  params?: Record<string, string | number | boolean>
  /**
   * Grow the iframe to fit content as the embed reports its height
   * (default true). When off, the iframe keeps `height`.
   */
  autoResize?: boolean
  /** Fixed/initial iframe height (default 600). */
  height?: number | string
  /** The iframe's `loading`: `lazy` waits until it nears the viewport (default `eager`). */
  loading?: 'eager' | 'lazy'
  /**
   * How long after the frame loads the embed may stay silent before `onError` hears `timeout`
   * (default 15000 ms; 0 turns it off).
   */
  loadTimeoutMs?: number
  /** Shown over the frame while the embed loads (until it is ready or fails). */
  loadingFallback?: ReactNode
  /**
   * Shown over the frame when the embed fails — except `password-required`, which the embed asks for itself. A
   * function receives the error and `retry` (which reloads the embed).
   */
  errorFallback?: ReactNode | ((error: EmbedError, retry: () => void) => ReactNode)
  className?: string
  style?: CSSProperties
  /** Accessible name for the iframe (default "DataSquares dashboard"). */
  title?: string
  /** The embed authorized and rendered: a dashboard (with its pages), a report, or a presentation (in present mode). */
  onReady?: (info: { contentType: EmbedContentType; pages: Array<{ id: string; name: string }> }) => void
  /**
   * The embed could not render (bad token, blocked origin, network, password,
   * an ended session), never spoke (`timeout`), or your `getToken` failed —
   * then `kind` is `invalid` and `cause` is what it threw.
   */
  onError?: (error: EmbedError) => void
  /** The status changed: `loading`, `ready`, `error`. It starts as `loading`. */
  onStatusChange?: (status: EmbedStatus) => void
  /** The visible dashboard page changed. */
  onPageChange?: (pageId: string) => void
  /** A chart data point was clicked. */
  onPointClick?: (event: { cardId: string; value: string }) => void
  /** The cross-filter set changed (chart click, slicer, clear). */
  onFilterChange?: (filters: EmbedFilter[]) => void
}

export interface DataSquaresEmbedHandle {
  /** Override dashboard parameter values (wins over the URL's p_* defaults). Waits until the embed listens. */
  setParams: (params: Record<string, unknown>) => void
  /** Switch the visible dashboard page. Waits until the embed listens. */
  setPage: (pageId: string) => void
  /** Re-fetch the shared content. Waits until the embed listens. */
  refresh: () => void
  /** Load the embed again from the start (a new page in the frame, a new token with `getToken`). */
  reload: () => void
  /** Show the embed full screen. Rejects when the browser refuses (it must follow a click or key press). */
  requestFullscreen: () => Promise<void>
  /** Current embed state (active page + effective params). Rejects when the embed has not answered within `timeoutMs` (default 5000). */
  getState: (timeoutMs?: number) => Promise<EmbedState>
}

interface PendingState {
  resolve: (state: EmbedState) => void
  timer: ReturnType<typeof setTimeout>
}

/** Commands of these kinds replace a waiting one of the same kind: only the last matters to the embed. */
const LAST_WINS: ReadonlySet<EmbedInMessage['type']> = new Set(['ds:set-params', 'ds:set-page', 'ds:refresh'])

const DEFAULT_LOAD_TIMEOUT_MS = 15_000

let requestCounter = 0

export const DataSquaresEmbed = forwardRef<DataSquaresEmbedHandle, DataSquaresEmbedProps>(
  function DataSquaresEmbed(props, ref) {
    const {
      baseUrl,
      getToken,
      contentId,
      token,
      theme,
      toolbar,
      primaryColor,
      logoUrl,
      page,
      params,
      autoResize = true,
      height = 600,
      loading,
      loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
      loadingFallback,
      errorFallback,
      className,
      style,
      title = 'DataSquares dashboard',
    } = props

    const iframeRef = useRef<HTMLIFrameElement | null>(null)
    const [reportedHeight, setReportedHeight] = useState<number | null>(null)
    // Bumped by reload(): a new key is a new iframe, and so a new page in it.
    const [reloadKey, setReloadKey] = useState(0)
    const [status, setStatusState] = useState<EmbedStatus>('loading')
    const [lastError, setLastError] = useState<EmbedError | null>(null)
    const warned = useRef(new Set<string>()).current

    // The one origin this component will talk to or listen for (throws, with words, on a bad baseUrl).
    const embedOrigin = useMemo(() => originOf(baseUrl), [baseUrl])

    const sessionMode = typeof getToken === 'function'
    if (!sessionMode && (!token || !contentId)) {
      throw new Error("DataSquaresEmbed: pass getToken (each person's signed token, from your server), or token and contentId (a share link).")
    }
    if (DEV) {
      if (sessionMode && (token || contentId)) {
        warnOnce(warned, 'both', 'getToken is set, so token and contentId are ignored: the signed token names the content.')
      }
      if (isInsecureRemote(baseUrl)) {
        warnOnce(warned, 'http', `baseUrl ${embedOrigin} is plain http: tokens would cross the network unencrypted. Use https outside local development.`)
      }
    }

    // A string key, so an inline `params={{ … }}` object does not rebuild the URL each render.
    const paramsKey = params ? JSON.stringify(params) : ''
    const src = useMemo(
      () =>
        sessionMode
          ? buildSessionEmbedUrl({ baseUrl, theme, toolbar, primaryColor, logoUrl, page, params })
          : buildEmbedUrl({ baseUrl, contentId: contentId!, token: token!, theme, toolbar, primaryColor, logoUrl, page, params }),
      // `params` is keyed by its contents (paramsKey), not its identity.
      [sessionMode, baseUrl, contentId, token, theme, toolbar, primaryColor, logoUrl, page, paramsKey],
    )

    // The current getToken, so the message listener below binds once per origin.
    const getTokenRef = useRef(getToken)
    getTokenRef.current = getToken

    // Callbacks live in a ref so the message listener binds once per origin,
    // not once per render of a possibly-inline handler.
    const callbacksRef = useRef<
      Pick<DataSquaresEmbedProps, 'onReady' | 'onError' | 'onStatusChange' | 'onPageChange' | 'onPointClick' | 'onFilterChange'>
    >({})
    callbacksRef.current = {
      onReady: props.onReady,
      onError: props.onError,
      onStatusChange: props.onStatusChange,
      onPageChange: props.onPageChange,
      onPointClick: props.onPointClick,
      onFilterChange: props.onFilterChange,
    }

    const statusRef = useRef<EmbedStatus>('loading')
    const setStatus = useCallback((next: EmbedStatus, error: EmbedError | null = null) => {
      setLastError(error)
      if (statusRef.current === next) return
      statusRef.current = next
      setStatusState(next)
      callbacksRef.current.onStatusChange?.(next)
    }, [])

    /**
     * An error, heard by the host — or, in development and with no onError, by the console. `whileReady: false` leaves a
     * rendered embed `ready`: a renewal's getToken failing does not end a session that is still showing (the embed says
     * `expired` itself if it ends).
     */
    const reportError = useCallback(
      (error: EmbedError, whileReady = true) => {
        if (whileReady || statusRef.current !== 'ready') setStatus('error', error)
        const onError = callbacksRef.current.onError
        if (onError) onError(error)
        else if (DEV) console.warn(`[DataSquaresEmbed] the embed failed: ${error.kind}`, error.cause ?? '')
      },
      [setStatus],
    )

    // Pending ds:get-state requests by requestId.
    const pendingStateRef = useRef(new Map<string, PendingState>())

    // Whether the page in the frame has spoken (so its bridge listens), and the commands waiting for it to.
    const liveRef = useRef(false)
    const queueRef = useRef<EmbedInMessage[]>([])
    const loadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    const send = useCallback(
      (msg: EmbedInMessage) => {
        // Exact target origin: if the iframe was navigated off DataSquares,
        // the command is dropped by the browser instead of delivered to
        // whatever page now occupies the frame.
        iframeRef.current?.contentWindow?.postMessage(msg, embedOrigin)
      },
      [embedOrigin],
    )

    const flush = useCallback(() => {
      const waiting = queueRef.current
      queueRef.current = []
      for (const msg of waiting) send(msg)
    }, [send])

    // A new src (or a reload) is a new page in the frame: it must speak again before commands go out.
    useEffect(() => {
      liveRef.current = false
      setStatus('loading')
      return () => clearTimeout(loadTimerRef.current)
    }, [src, embedOrigin, reloadKey, setStatus])

    // The frame finished loading: its page now has loadTimeoutMs to speak.
    const onFrameLoad = useCallback(() => {
      clearTimeout(loadTimerRef.current)
      if (liveRef.current || loadTimeoutMs <= 0) return
      loadTimerRef.current = setTimeout(() => {
        if (liveRef.current) return
        reportError({
          kind: 'timeout',
          cause: new Error(
            `The DataSquares embed at ${embedOrigin} loaded but did not respond within ${loadTimeoutMs} ms. Check that baseUrl is right, ` +
              "that this page's Content-Security-Policy allows it in frame-src, that this site is on the embed's allowed domains, " +
              'and that no referrerpolicy="no-referrer" hides this page from it.',
          ),
        })
      }, loadTimeoutMs)
    }, [embedOrigin, loadTimeoutMs, reportError])

    useEffect(() => {
      let disposed = false
      const listener = (event: MessageEvent) => {
        // Source first: pins WHICH window (this exact iframe — two embeds on a
        // page must not cross), then origin pins WHO runs in it, then shape.
        if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
        if (event.origin !== embedOrigin) return
        if (!isEmbedOutMessage(event.data)) return

        if (!liveRef.current) {
          liveRef.current = true
          clearTimeout(loadTimerRef.current)
          flush()
        }

        const msg = event.data
        const cb = callbacksRef.current
        switch (msg.type) {
          case 'ds:ready':
            setStatus('ready')
            cb.onReady?.({ contentType: msg.contentType, pages: msg.pages.map((p) => ({ id: p.id, name: p.name })) })
            break
          case 'ds:resize':
            setReportedHeight(msg.height)
            break
          case 'ds:error':
            reportError({ kind: msg.kind })
            break
          case 'ds:page-change':
            cb.onPageChange?.(msg.pageId)
            break
          case 'ds:point-click':
            cb.onPointClick?.({ cardId: msg.cardId, value: msg.value })
            break
          case 'ds:filter-change':
            cb.onFilterChange?.(msg.filters)
            break
          case 'ds:token-request': {
            const ask = getTokenRef.current
            if (!ask) break
            const target = iframeRef.current.contentWindow
            const fail = (cause: unknown) => {
              if (!disposed) reportError({ kind: 'invalid', cause }, false)
            }
            let asked: Promise<string>
            try {
              asked = Promise.resolve(ask())
            } catch (err) {
              fail(err)
              break
            }
            void asked.then((signed) => {
              // Unmounted, or the frame now holds another origin's listener: the answer goes nowhere.
              if (disposed) return
              if (typeof signed !== 'string' || signed.length === 0 || signed.length > MAX_EMBED_TOKEN_CHARS) {
                fail(new TypeError(`getToken must resolve to a signed token (1 to ${MAX_EMBED_TOKEN_CHARS} characters).`))
                return
              }
              // Exact origin: a frame navigated off DataSquares never receives the person's token.
              target?.postMessage({ type: 'ds:token', version: EMBED_PROTOCOL_VERSION, token: signed }, embedOrigin)
            }, fail)
            break
          }
          case 'ds:state': {
            if (msg.requestId) {
              const pending = pendingStateRef.current.get(msg.requestId)
              if (pending) {
                pendingStateRef.current.delete(msg.requestId)
                clearTimeout(pending.timer)
                pending.resolve(msg.state)
              }
            }
            break
          }
        }
      }
      window.addEventListener('message', listener)
      return () => {
        disposed = true
        window.removeEventListener('message', listener)
      }
    }, [embedOrigin, flush, reportError, setStatus])

    const post = useCallback(
      (msg: EmbedInMessage) => {
        if (liveRef.current) {
          send(msg)
          return
        }
        const waiting = LAST_WINS.has(msg.type) ? queueRef.current.filter((m) => m.type !== msg.type) : queueRef.current
        queueRef.current = [...waiting, msg]
      },
      [send],
    )

    const reload = useCallback(() => {
      liveRef.current = false
      clearTimeout(loadTimerRef.current)
      setReportedHeight(null)
      setReloadKey((k) => k + 1)
    }, [])

    useImperativeHandle(
      ref,
      (): DataSquaresEmbedHandle => ({
        setParams: (p) => post({ type: 'ds:set-params', version: EMBED_PROTOCOL_VERSION, params: p }),
        setPage: (pageId) => post({ type: 'ds:set-page', version: EMBED_PROTOCOL_VERSION, pageId }),
        refresh: () => post({ type: 'ds:refresh', version: EMBED_PROTOCOL_VERSION }),
        reload,
        requestFullscreen: async () => {
          const frame = iframeRef.current
          if (!frame) throw new Error('DataSquares embed is not mounted.')
          if (typeof frame.requestFullscreen !== 'function') throw new Error('This browser cannot show an element full screen.')
          await frame.requestFullscreen()
        },
        getState: (timeoutMs = 5000) => {
          const requestId = `dsq-${Date.now()}-${++requestCounter}`
          return new Promise<EmbedState>((resolve, reject) => {
            const timer = setTimeout(() => {
              if (pendingStateRef.current.delete(requestId)) {
                queueRef.current = queueRef.current.filter((m) => !(m.type === 'ds:get-state' && m.requestId === requestId))
                reject(new Error('DataSquares embed did not answer ds:get-state — is it loaded and same-version?'))
              }
            }, timeoutMs)
            pendingStateRef.current.set(requestId, { resolve, timer })
            post({ type: 'ds:get-state', version: EMBED_PROTOCOL_VERSION, requestId })
          })
        },
      }),
      [post, reload],
    )

    const frame = (
      <iframe
        key={reloadKey}
        ref={iframeRef}
        src={src}
        title={title}
        className={className}
        loading={loading}
        onLoad={onFrameLoad}
        style={{
          width: '100%',
          border: 0,
          height: autoResize && reportedHeight !== null ? reportedHeight : height,
          ...style,
        }}
        allow="fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    )

    // No fallbacks: the bare iframe, as before (className and style stay on it).
    if (loadingFallback === undefined && errorFallback === undefined) return frame

    let overlay: ReactNode = null
    if (status === 'loading') overlay = loadingFallback ?? null
    else if (status === 'error' && lastError && lastError.kind !== 'password-required') {
      overlay = typeof errorFallback === 'function' ? errorFallback(lastError, reload) : (errorFallback ?? null)
    }
    return (
      <div style={{ position: 'relative', width: '100%' }} aria-busy={status === 'loading'} data-ds-embed-status={status}>
        {frame}
        {overlay !== null && overlay !== undefined && (
          <div style={{ position: 'absolute', inset: 0 }} data-ds-embed-overlay={status}>
            {overlay}
          </div>
        )}
      </div>
    )
  },
)
