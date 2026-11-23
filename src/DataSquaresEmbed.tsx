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
 * ── A menu ──────────────────────────────────────────────────────────────
 * A token whose content is `{ type: 'menu' }` opens the embed app's menu: the
 * embed draws it (sidebar, tabs, dropdown, gallery — the app's layout, or the
 * `menu` prop), or, with `menu="none"`, your page draws its own from
 * `onReady`'s `items` and opens one with `open(id)`. Another item opens in the
 * same frame and session, without a new token; `onItemChange` hears it.
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
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  EMBED_PROTOCOL_VERSION,
  type EmbedContentType,
  type EmbedFilter,
  type EmbedInMessage,
  type EmbedMenuItem,
  type EmbedOutMessage,
  type EmbedState,
} from './protocol.js'
import { buildEmbedUrl, buildSessionEmbedUrl, embedOrigin as originOf, type EmbedFont, type EmbedMenuLayout } from './urls.js'
import { DEV, isInsecureRemote, warnOnce } from './dev.js'
import { DEFAULT_LOAD_TIMEOUT_MS, useFrameBridge, type EmbedError, type EmbedStatus } from './frame-bridge.js'

export type { EmbedError, EmbedHostErrorKind, EmbedStatus } from './frame-bridge.js'

/** What `onReady` hears. */
export interface EmbedReadyInfo {
  /** What shows: a dashboard, a report, a presentation, or `menu` while the embed's gallery shows and no item is open. */
  contentType: EmbedContentType | 'menu'
  /** A dashboard's pages (none for a report, a one-page dashboard or a presentation). */
  pages: Array<{ id: string; name: string }>
  /** A menu token: the item shown (null while a gallery shows); null for a token naming one item. */
  item: EmbedMenuItem | null
  /** A menu token: the person's menu, in order; empty for a token naming one item. */
  items: EmbedMenuItem[]
}

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
  /** `light` | `dark` | `auto` (follows the viewer's system); omit for the embed app's look, else light. */
  theme?: 'light' | 'dark' | 'auto'
  /** Show the embed toolbar (default true, matching the embed page). */
  toolbar?: boolean
  /** Brand primary color, hex without the hash or any CSS color. */
  primaryColor?: string
  /** Your logo's URL (https), shown in the embed's toolbar. The "Powered by DataSquares" credit always shows. */
  logoUrl?: string
  /** The dashboard page to open on (its id). Changing it reloads the frame; to switch live, call `setPage`. */
  page?: string
  /** Show a dashboard's page tabs (omit for the embed app's look, else shown); hidden, your page can still `setPage`. */
  tabs?: boolean
  /** `default`, `transparent` (your page shows through the frame), or a colour as hex. */
  background?: string
  /** A font the embed bundles, or `system` (the viewer's own). */
  font?: EmbedFont
  /** Space around the content: `none`, `compact` or `normal`. */
  padding?: 'none' | 'compact' | 'normal'
  /**
   * A menu token: the item to open first (its content id); default the menu's first, or the gallery. Changing it reloads
   * the frame; to switch live, call `open`.
   */
  item?: string
  /** A menu token: how the embed draws the menu (default: the embed app's); `none` when your page draws its own. */
  menu?: EmbedMenuLayout
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
  /**
   * The embed authorized and rendered: a dashboard (with its pages), a report, a presentation (in present mode), or a
   * menu's gallery; with a menu token, the item shown and the person's items.
   */
  onReady?: (info: EmbedReadyInfo) => void
  /** A menu token: another item of the menu is shown (picked in the embed's menu, or opened with `open`). */
  onItemChange?: (item: EmbedMenuItem) => void
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
  /** A menu token: open another item of the person's menu, in the same frame and session. Waits until the embed listens. */
  open: (itemId: string) => void
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
const LAST_WINS: ReadonlySet<EmbedInMessage['type']> = new Set(['ds:set-params', 'ds:set-page', 'ds:refresh', 'ds:open'])

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
      tabs,
      background,
      font,
      padding,
      item,
      menu,
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

    const [reportedHeight, setReportedHeight] = useState<number | null>(null)
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
      () => {
        const look = { baseUrl, theme, toolbar, primaryColor, logoUrl, page, tabs, background, font, padding, params }
        return sessionMode
          ? buildSessionEmbedUrl({ ...look, item, menu })
          : buildEmbedUrl({ ...look, contentId: contentId!, token: token! })
      },
      // `params` is keyed by its contents (paramsKey), not its identity.
      [sessionMode, baseUrl, contentId, token, theme, toolbar, primaryColor, logoUrl, page, tabs, background, font, padding, item, menu, paramsKey],
    )

    // Callbacks live in a ref so the frame's messages reach the latest ones, not those of the render it bound in.
    const callbacksRef = useRef<
      Pick<DataSquaresEmbedProps, 'onReady' | 'onItemChange' | 'onError' | 'onStatusChange' | 'onPageChange' | 'onPointClick' | 'onFilterChange'>
    >({})
    callbacksRef.current = {
      onReady: props.onReady,
      onItemChange: props.onItemChange,
      onError: props.onError,
      onStatusChange: props.onStatusChange,
      onPageChange: props.onPageChange,
      onPointClick: props.onPointClick,
      onFilterChange: props.onFilterChange,
    }

    // Pending ds:get-state requests by requestId.
    const pendingStateRef = useRef(new Map<string, PendingState>())
    // The person's menu as the embed last said (empty for one item): open() checks an id against it in development.
    const itemsRef = useRef<EmbedMenuItem[] | null>(null)

    const onMessage = (msg: EmbedOutMessage) => {
      const cb = callbacksRef.current
      switch (msg.type) {
        case 'ds:ready':
          // The chat's ready (<DataSquaresChat>) is not this component's.
          if (msg.contentType === 'chat') break
          itemsRef.current = msg.items ?? []
          cb.onReady?.({
            contentType: msg.contentType,
            pages: msg.pages.map((p) => ({ id: p.id, name: p.name })),
            item: msg.item ?? null,
            items: msg.items ?? [],
          })
          break
        case 'ds:item-change':
          cb.onItemChange?.(msg.item)
          break
        case 'ds:resize':
          setReportedHeight(msg.height)
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

    const bridge = useFrameBridge({
      embedOrigin,
      src,
      getToken,
      loadTimeoutMs,
      lastWins: LAST_WINS,
      name: 'DataSquaresEmbed',
      onMessage,
      // With no onError of the host's, the bridge writes a failure to the console in development.
      onError: props.onError ? (error) => callbacksRef.current.onError?.(error) : undefined,
      onStatusChange: (next) => callbacksRef.current.onStatusChange?.(next),
    })
    const { iframeRef, reloadKey, status, lastError, post, dropWaiting, onFrameLoad } = bridge

    const reload = useCallback(() => {
      itemsRef.current = null
      setReportedHeight(null)
      bridge.reload()
    }, [bridge.reload])

    useImperativeHandle(
      ref,
      (): DataSquaresEmbedHandle => ({
        setParams: (p) => post({ type: 'ds:set-params', version: EMBED_PROTOCOL_VERSION, params: p }),
        setPage: (pageId) => post({ type: 'ds:set-page', version: EMBED_PROTOCOL_VERSION, pageId }),
        refresh: () => post({ type: 'ds:refresh', version: EMBED_PROTOCOL_VERSION }),
        open: (itemId) => {
          if (DEV && itemsRef.current && !itemsRef.current.some((i) => i.id === itemId)) {
            warnOnce(
              warned,
              `open:${itemId}`,
              itemsRef.current.length === 0
                ? `open(${JSON.stringify(itemId)}): this embed shows one item. A token whose content is { type: 'menu' } opens a menu.`
                : `open(${JSON.stringify(itemId)}): no item of this person's menu has that id; the embed ignores it.`,
            )
          }
          post({ type: 'ds:open', version: EMBED_PROTOCOL_VERSION, itemId })
        },
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
                dropWaiting((m) => !(m.type === 'ds:get-state' && m.requestId === requestId))
                reject(new Error('DataSquares embed did not answer ds:get-state — is it loaded and same-version?'))
              }
            }, timeoutMs)
            pendingStateRef.current.set(requestId, { resolve, timer })
            post({ type: 'ds:get-state', version: EMBED_PROTOCOL_VERSION, requestId })
          })
        },
      }),
      [post, reload, warned, dropWaiting, iframeRef],
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
