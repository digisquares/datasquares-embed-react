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
  isEmbedOutMessage,
  type EmbedErrorKind,
  type EmbedFilter,
  type EmbedInMessage,
  type EmbedReadyMessage,
  type EmbedState,
} from './protocol.js'

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
  /** A share link's dashboard or report id (with `token`). */
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
  className?: string
  style?: CSSProperties
  /** Accessible name for the iframe (default "DataSquares dashboard"). */
  title?: string
  /** The embed authorized and rendered. */
  onReady?: (info: { contentType: 'dashboard' | 'report'; pages: Array<{ id: string; name: string }> }) => void
  /** The embed could not render (bad token, blocked origin, network, password). */
  onError?: (error: { kind: EmbedErrorKind }) => void
  /** The visible dashboard page changed. */
  onPageChange?: (pageId: string) => void
  /** A chart data point was clicked. */
  onPointClick?: (event: { cardId: string; value: string }) => void
  /** The cross-filter set changed (chart click, slicer, clear). */
  onFilterChange?: (filters: EmbedFilter[]) => void
}

export interface DataSquaresEmbedHandle {
  /** Override dashboard parameter values (wins over the URL's p_* defaults). */
  setParams: (params: Record<string, unknown>) => void
  /** Switch the visible dashboard page. */
  setPage: (pageId: string) => void
  /** Re-fetch the shared content. */
  refresh: () => void
  /** Current embed state (active page + effective params). */
  getState: (timeoutMs?: number) => Promise<EmbedState>
}

/**
 * The session embed's URL: the options only. The person's signed token is
 * handed over by postMessage when the embed asks for it, never in the URL.
 */
export function buildSessionEmbedUrl(props: {
  baseUrl: string
  theme?: string
  toolbar?: boolean
  primaryColor?: string
  logoUrl?: string
  params?: Record<string, string | number | boolean>
}): string {
  const url = new URL('/embed/session', props.baseUrl)
  if (props.theme) url.searchParams.set('theme', props.theme)
  if (props.toolbar !== undefined) url.searchParams.set('toolbar', String(props.toolbar))
  if (props.primaryColor) url.searchParams.set('primaryColor', props.primaryColor)
  if (props.logoUrl) url.searchParams.set('logoUrl', props.logoUrl)
  for (const [key, value] of Object.entries(props.params ?? {})) {
    url.searchParams.set(`p_${key}`, String(value))
  }
  return url.toString()
}

/** Build a share link's embed URL. Exported for tests; not part of the public API surface. */
export function buildEmbedUrl(props: {
  baseUrl: string
  contentId: string
  token: string
  theme?: string
  toolbar?: boolean
  primaryColor?: string
  logoUrl?: string
  params?: Record<string, string | number | boolean>
}): string {
  const url = new URL(`/embed/${encodeURIComponent(props.contentId)}`, props.baseUrl)
  url.searchParams.set('token', props.token)
  if (props.theme) url.searchParams.set('theme', props.theme)
  if (props.toolbar !== undefined) url.searchParams.set('toolbar', String(props.toolbar))
  if (props.primaryColor) url.searchParams.set('primaryColor', props.primaryColor)
  if (props.logoUrl) url.searchParams.set('logoUrl', props.logoUrl)
  for (const [key, value] of Object.entries(props.params ?? {})) {
    url.searchParams.set(`p_${key}`, String(value))
  }
  return url.toString()
}

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
      className,
      style,
      title = 'DataSquares dashboard',
    } = props

    const iframeRef = useRef<HTMLIFrameElement | null>(null)
    const [reportedHeight, setReportedHeight] = useState<number | null>(null)

    // The one origin this component will talk to or listen for.
    const embedOrigin = useMemo(() => new URL(baseUrl).origin, [baseUrl])

    const sessionMode = typeof getToken === 'function'
    if (!sessionMode && (!token || !contentId)) {
      throw new Error("DataSquaresEmbed: pass getToken (each person's signed token, from your server), or token and contentId (a share link).")
    }
    const src = useMemo(
      () =>
        sessionMode
          ? buildSessionEmbedUrl({ baseUrl, theme, toolbar, primaryColor, logoUrl, params })
          : buildEmbedUrl({ baseUrl, contentId: contentId!, token: token!, theme, toolbar, primaryColor, logoUrl, params }),
      [sessionMode, baseUrl, contentId, token, theme, toolbar, primaryColor, logoUrl, params],
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
    const pendingStateRef = useRef(new Map<string, (state: EmbedState) => void>())

    useEffect(() => {
      const listener = (event: MessageEvent) => {
        // Source first: pins WHICH window (this exact iframe — two embeds on a
        // page must not cross), then origin pins WHO runs in it, then shape.
        if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
        if (event.origin !== embedOrigin) return
        if (!isEmbedOutMessage(event.data)) return

        const msg = event.data
        const cb = callbacksRef.current
        switch (msg.type) {
          case 'ds:ready': {
            const ready = msg as EmbedReadyMessage
            cb.onReady?.({ contentType: ready.contentType, pages: ready.pages })
            break
          }
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
            const target = iframeRef.current?.contentWindow
            void ask().then(
              (signed) => {
                // Exact origin: a frame navigated off DataSquares never receives the person's token.
                if (typeof signed === 'string' && signed) target?.postMessage({ type: 'ds:token', version: 1, token: signed }, embedOrigin)
                else cb.onError?.({ kind: 'invalid' })
              },
              () => cb.onError?.({ kind: 'invalid' }),
            )
            break
          }
          case 'ds:state': {
            if (msg.requestId) {
              const resolve = pendingStateRef.current.get(msg.requestId)
              if (resolve) {
                pendingStateRef.current.delete(msg.requestId)
                resolve(msg.state)
              }
            }
            break
          }
        }
      }
      window.addEventListener('message', listener)
      return () => window.removeEventListener('message', listener)
    }, [embedOrigin])

    const post = useCallback(
      (msg: EmbedInMessage) => {
        // Exact target origin: if the iframe was navigated off DataSquares,
        // the command is dropped by the browser instead of delivered to
        // whatever page now occupies the frame.
        iframeRef.current?.contentWindow?.postMessage(msg, embedOrigin)
      },
      [embedOrigin],
    )

    useImperativeHandle(
      ref,
      (): DataSquaresEmbedHandle => ({
        setParams: (p) => post({ type: 'ds:set-params', version: 1, params: p }),
        setPage: (pageId) => post({ type: 'ds:set-page', version: 1, pageId }),
        refresh: () => post({ type: 'ds:refresh', version: 1 }),
        getState: (timeoutMs = 5000) => {
          const requestId = `dsq-${Date.now()}-${++requestCounter}`
          return new Promise<EmbedState>((resolve, reject) => {
            pendingStateRef.current.set(requestId, resolve)
            setTimeout(() => {
              if (pendingStateRef.current.delete(requestId)) {
                reject(new Error('DataSquares embed did not answer ds:get-state — is it loaded and same-version?'))
              }
            }, timeoutMs)
            post({ type: 'ds:get-state', version: 1, requestId })
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
