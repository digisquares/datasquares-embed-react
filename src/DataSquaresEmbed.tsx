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

/** What `onError` hears. `cause` is set only when your own `getToken` failed (it threw, or gave no usable token). */
export interface EmbedError {
  kind: EmbedErrorKind
  cause?: unknown
}

export interface DataSquaresEmbedProps {
  /** Your DataSquares app URL, e.g. `https://app.datasquares.ai`. */
  baseUrl: string
  /**
   * Two keys: returns a short-lived token YOUR server signed for the current
   * person with your embed app's key (`signEmbedToken` from
   * `@digisquares/datasquares-embed-react/server`). Called when the embed
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
  /** White-label logo URL (https). */
  logoUrl?: string
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
  className?: string
  style?: CSSProperties
  /** Accessible name for the iframe (default "DataSquares dashboard"). */
  title?: string
  /** The embed authorized and rendered: a dashboard (with its pages), a report, or a presentation (in present mode). */
  onReady?: (info: { contentType: EmbedContentType; pages: Array<{ id: string; name: string }> }) => void
  /**
   * The embed could not render (bad token, blocked origin, network, password,
   * an ended session), or your `getToken` failed — then `kind` is `invalid`
   * and `cause` is what it threw.
   */
  onError?: (error: EmbedError) => void
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
  /** Current embed state (active page + effective params). Rejects when the embed has not answered within `timeoutMs` (default 5000). */
  getState: (timeoutMs?: number) => Promise<EmbedState>
}

interface PendingState {
  resolve: (state: EmbedState) => void
  timer: ReturnType<typeof setTimeout>
}

/** Commands of these kinds replace a waiting one of the same kind: only the last matters to the embed. */
const LAST_WINS: ReadonlySet<EmbedInMessage['type']> = new Set(['ds:set-params', 'ds:set-page', 'ds:refresh'])

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
      params,
      autoResize = true,
      height = 600,
      loading,
      className,
      style,
      title = 'DataSquares dashboard',
    } = props

    const iframeRef = useRef<HTMLIFrameElement | null>(null)
    const [reportedHeight, setReportedHeight] = useState<number | null>(null)

    // The one origin this component will talk to or listen for (throws, with words, on a bad baseUrl).
    const embedOrigin = useMemo(() => originOf(baseUrl), [baseUrl])

    const sessionMode = typeof getToken === 'function'
    if (!sessionMode && (!token || !contentId)) {
      throw new Error("DataSquaresEmbed: pass getToken (each person's signed token, from your server), or token and contentId (a share link).")
    }
    // A string key, so an inline `params={{ … }}` object does not rebuild the URL each render.
    const paramsKey = params ? JSON.stringify(params) : ''
    const src = useMemo(
      () =>
        sessionMode
          ? buildSessionEmbedUrl({ baseUrl, theme, toolbar, primaryColor, logoUrl, params })
          : buildEmbedUrl({ baseUrl, contentId: contentId!, token: token!, theme, toolbar, primaryColor, logoUrl, params }),
      // `params` is keyed by its contents (paramsKey), not its identity.
      [sessionMode, baseUrl, contentId, token, theme, toolbar, primaryColor, logoUrl, paramsKey],
    )

    // The current getToken, so the message listener below binds once per origin.
    const getTokenRef = useRef(getToken)
    getTokenRef.current = getToken

    // Callbacks live in a ref so the message listener binds once per origin,
    // not once per render of a possibly-inline handler.
    const callbacksRef = useRef<Pick<DataSquaresEmbedProps, 'onReady' | 'onError' | 'onPageChange' | 'onPointClick' | 'onFilterChange'>>({})
    callbacksRef.current = {
      onReady: props.onReady,
      onError: props.onError,
      onPageChange: props.onPageChange,
      onPointClick: props.onPointClick,
      onFilterChange: props.onFilterChange,
    }

    // Pending ds:get-state requests by requestId.
    const pendingStateRef = useRef(new Map<string, PendingState>())

    // Whether the page in the frame has spoken (so its bridge listens), and the commands waiting for it to.
    const liveRef = useRef(false)
    const queueRef = useRef<EmbedInMessage[]>([])

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

    // A new src is a new page in the frame: it must speak again before commands go out.
    useEffect(() => {
      liveRef.current = false
    }, [src, embedOrigin])

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
          flush()
        }

        const msg = event.data
        const cb = callbacksRef.current
        switch (msg.type) {
          case 'ds:ready':
            cb.onReady?.({ contentType: msg.contentType, pages: msg.pages.map((p) => ({ id: p.id, name: p.name })) })
            break
          case 'ds:resize':
            setReportedHeight(msg.height)
            break
          case 'ds:error':
            cb.onError?.({ kind: msg.kind })
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
              if (!disposed) callbacksRef.current.onError?.({ kind: 'invalid', cause })
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
    }, [embedOrigin, flush])

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

    useImperativeHandle(
      ref,
      (): DataSquaresEmbedHandle => ({
        setParams: (p) => post({ type: 'ds:set-params', version: EMBED_PROTOCOL_VERSION, params: p }),
        setPage: (pageId) => post({ type: 'ds:set-page', version: EMBED_PROTOCOL_VERSION, pageId }),
        refresh: () => post({ type: 'ds:refresh', version: EMBED_PROTOCOL_VERSION }),
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
      [post],
    )

    return (
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        className={className}
        loading={loading}
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
  },
)
