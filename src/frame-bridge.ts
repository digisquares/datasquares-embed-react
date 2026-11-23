'use client'
/**
 * The host's half of a DataSquares frame, shared by <DataSquaresEmbed> and <DataSquaresChat>: the pinned message
 * channel, the commands that wait until the frame listens, the person's signed token on request, the load timeout,
 * and the status. Internal: not exported from the package.
 *
 *  - Inbound messages are accepted only from THIS iframe's window, at the DataSquares origin of `baseUrl`, in a shape
 *    the protocol's guard accepts. Outbound commands go to that exact origin, never '*'.
 *  - A command posted before the page in the frame has spoken waits, and goes out when it first speaks (its bridge then
 *    listens). Of the kinds in `lastWins`, only the last waits. A new `src` (or `reload`) is a new page: commands wait
 *    again, and the status is `loading` again.
 *  - A frame that loads but never speaks within `loadTimeoutMs` is `timeout`.
 *  - `ds:token-request` is answered with `getToken()`'s token (ds:token), at the exact origin; `ds:error` is an error;
 *    `ds:ready` is `ready`. Every message, these included, then reaches `onMessage`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { EMBED_PROTOCOL_VERSION, MAX_EMBED_TOKEN_CHARS, isEmbedOutMessage, type EmbedErrorKind, type EmbedInMessage, type EmbedOutMessage } from './protocol.js'
import { DEV } from './dev.js'

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

export const DEFAULT_LOAD_TIMEOUT_MS = 15_000

export interface FrameBridgeOptions {
  /** The DataSquares origin of `baseUrl`: the one origin listened to and posted to. */
  embedOrigin: string
  /** The frame's address: a new one is a new page in the frame. */
  src: string
  getToken?: () => Promise<string>
  loadTimeoutMs: number
  /** Command kinds of which only the last waits for the frame. */
  lastWins: ReadonlySet<EmbedInMessage['type']>
  /** The component's name, for the console in development. */
  name: string
  /** Every message the frame sends, after the bridge's own handling. */
  onMessage: (msg: EmbedOutMessage) => void
  onError?: (error: EmbedError) => void
  onStatusChange?: (status: EmbedStatus) => void
}

export function useFrameBridge(o: FrameBridgeOptions) {
  const { embedOrigin, src, loadTimeoutMs } = o
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // Bumped by reload(): a new key is a new iframe, and so a new page in it.
  const [reloadKey, setReloadKey] = useState(0)
  const [status, setStatusState] = useState<EmbedStatus>('loading')
  const [lastError, setLastError] = useState<EmbedError | null>(null)

  // The latest handlers and token source, so the listener binds once per origin, not once per render.
  const opts = useRef(o)
  opts.current = o

  const statusRef = useRef<EmbedStatus>('loading')
  const setStatus = useCallback((next: EmbedStatus, error: EmbedError | null = null) => {
    setLastError(error)
    if (statusRef.current === next) return
    statusRef.current = next
    setStatusState(next)
    opts.current.onStatusChange?.(next)
  }, [])

  /**
   * An error, heard by the host — or, in development and with no onError, by the console. `whileReady: false` leaves a
   * rendered frame `ready`: a renewal's getToken failing does not end a session that is still showing (the embed says
   * `expired` itself if it ends).
   */
  const reportError = useCallback(
    (error: EmbedError, whileReady = true) => {
      if (whileReady || statusRef.current !== 'ready') setStatus('error', error)
      const onError = opts.current.onError
      if (onError) onError(error)
      else if (DEV) console.warn(`[${opts.current.name}] the embed failed: ${error.kind}`, error.cause ?? '')
    },
    [setStatus],
  )

  // Whether the page in the frame has spoken (so its bridge listens), and the commands waiting for it to.
  const liveRef = useRef(false)
  const queueRef = useRef<EmbedInMessage[]>([])
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const send = useCallback(
    (msg: EmbedInMessage) => {
      // Exact target origin: if the iframe was navigated off DataSquares, the command is dropped by the browser
      // instead of delivered to whatever page now occupies the frame.
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
      // Source first: pins WHICH window (this exact iframe — two embeds on a page must not cross), then origin pins
      // WHO runs in it, then shape.
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      if (event.origin !== embedOrigin) return
      if (!isEmbedOutMessage(event.data)) return

      if (!liveRef.current) {
        liveRef.current = true
        clearTimeout(loadTimerRef.current)
        flush()
      }

      const msg = event.data
      switch (msg.type) {
        case 'ds:ready':
          setStatus('ready')
          break
        case 'ds:error':
          reportError({ kind: msg.kind })
          break
        case 'ds:token-request': {
          const ask = opts.current.getToken
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
      }
      opts.current.onMessage(msg)
    }
    window.addEventListener('message', listener)
    return () => {
      disposed = true
      window.removeEventListener('message', listener)
    }
  }, [embedOrigin, flush, reportError, setStatus])

  /** Send a command now if the frame listens, else when it first speaks. */
  const post = useCallback(
    (msg: EmbedInMessage) => {
      if (liveRef.current) {
        send(msg)
        return
      }
      const waiting = opts.current.lastWins.has(msg.type) ? queueRef.current.filter((m) => m.type !== msg.type) : queueRef.current
      queueRef.current = [...waiting, msg]
    },
    [send],
  )

  /** Drop waiting commands that `keep` refuses (a request that timed out). */
  const dropWaiting = useCallback((keep: (msg: EmbedInMessage) => boolean) => {
    queueRef.current = queueRef.current.filter(keep)
  }, [])

  /** Load the frame again from the start. */
  const reload = useCallback(() => {
    liveRef.current = false
    clearTimeout(loadTimerRef.current)
    setReloadKey((k) => k + 1)
  }, [])

  return { iframeRef, reloadKey, status, lastError, post, dropWaiting, reload, onFrameLoad, reportError }
}
