/**
 * The host's half of a DataSquares frame, with no framework: what the web components (element.ts) talk to the frame
 * through. The same rules as the React components' bridge (frame-bridge.ts), which keeps them for React's lifecycle:
 *
 *  - Inbound messages are accepted only from the attached iframe's window, at the DataSquares origin of `baseUrl`, in a
 *    shape the protocol's guard accepts. Outbound commands go to that exact origin, never '*'.
 *  - A command posted before the page in the frame has spoken waits, and goes out when it first speaks. Of the kinds in
 *    `lastWins`, only the last waits. `newPage()` (a new address, a reload) makes commands wait again, and the status
 *    `loading` again.
 *  - A frame that loads but never speaks within `loadTimeoutMs` is `timeout`.
 *  - `ds:token-request` is answered with `getToken()`'s token (ds:token), at the exact origin; `ds:error` is an error;
 *    `ds:ready` is `ready`. Every message, these included, then reaches `onMessage`.
 */
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

export interface FrameChannelOptions {
  /** The DataSquares origin of `baseUrl`: the one origin listened to and posted to. */
  embedOrigin: string
  /** The person's signed token, asked for when the frame asks (session embeds and the chat). */
  getToken?: () => Promise<string>
  loadTimeoutMs: number
  /** Command kinds of which only the last waits for the frame. */
  lastWins: ReadonlySet<EmbedInMessage['type']>
  /** The element's name, for the console in development. */
  name: string
  onMessage: (msg: EmbedOutMessage) => void
  onError?: (error: EmbedError) => void
  onStatusChange?: (status: EmbedStatus) => void
}

export class FrameChannel {
  status: EmbedStatus = 'loading'
  lastError: EmbedError | null = null
  private iframe: HTMLIFrameElement | null = null
  private live = false
  private queue: EmbedInMessage[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private readonly listener = (event: MessageEvent) => this.receive(event)

  constructor(private readonly o: FrameChannelOptions) {
    window.addEventListener('message', this.listener)
  }

  /** The iframe the channel talks to. A new one is a new page. */
  attach(iframe: HTMLIFrameElement | null): void {
    this.iframe = iframe
    this.newPage()
  }

  /** A new page in the frame (a new address, a reload): it must speak again before commands go out. */
  newPage(): void {
    this.live = false
    clearTimeout(this.timer)
    this.setStatus('loading')
  }

  /** The frame finished loading: its page now has loadTimeoutMs to speak. */
  frameLoaded(): void {
    clearTimeout(this.timer)
    const { loadTimeoutMs, embedOrigin } = this.o
    if (this.live || loadTimeoutMs <= 0) return
    this.timer = setTimeout(() => {
      if (this.live) return
      this.report({
        kind: 'timeout',
        cause: new Error(
          `The DataSquares embed at ${embedOrigin} loaded but did not respond within ${loadTimeoutMs} ms. Check that base-url is right, ` +
            "that this page's Content-Security-Policy allows it in frame-src, that this site is on the embed's allowed domains, " +
            'and that no referrerpolicy="no-referrer" hides this page from it.',
        ),
      })
    }, loadTimeoutMs)
  }

  /** Send a command now if the frame listens, else when it first speaks. */
  post(msg: EmbedInMessage): void {
    if (this.live) {
      this.send(msg)
      return
    }
    const waiting = this.o.lastWins.has(msg.type) ? this.queue.filter((m) => m.type !== msg.type) : this.queue
    this.queue = [...waiting, msg]
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    window.removeEventListener('message', this.listener)
  }

  private send(msg: EmbedInMessage): void {
    // Exact target origin: a frame navigated off DataSquares never receives the command.
    this.iframe?.contentWindow?.postMessage(msg, this.o.embedOrigin)
  }

  private setStatus(next: EmbedStatus, error: EmbedError | null = null): void {
    this.lastError = error
    if (this.status === next) return
    this.status = next
    this.o.onStatusChange?.(next)
  }

  /** An error, heard by the host or, with no handler, by the console in development. `whileReady: false` keeps a shown frame ready. */
  private report(error: EmbedError, whileReady = true): void {
    if (whileReady || this.status !== 'ready') this.setStatus('error', error)
    if (this.o.onError) this.o.onError(error)
    else if (DEV) console.warn(`[${this.o.name}] the embed failed: ${error.kind}`, error.cause ?? '')
  }

  private receive(event: MessageEvent): void {
    // Source first (this exact iframe: two on a page must not cross), then origin (who runs in it), then shape.
    if (!this.iframe || event.source !== this.iframe.contentWindow) return
    if (event.origin !== this.o.embedOrigin) return
    if (!isEmbedOutMessage(event.data)) return
    if (!this.live) {
      this.live = true
      clearTimeout(this.timer)
      const waiting = this.queue
      this.queue = []
      for (const msg of waiting) this.send(msg)
    }
    const msg = event.data
    switch (msg.type) {
      case 'ds:ready':
        this.setStatus('ready')
        break
      case 'ds:error':
        this.report({ kind: msg.kind })
        break
      case 'ds:token-request':
        this.answerTokenRequest()
        break
    }
    this.o.onMessage(msg)
  }

  private answerTokenRequest(): void {
    const ask = this.o.getToken
    if (!ask) return
    const target = this.iframe?.contentWindow
    const fail = (cause: unknown) => {
      if (!this.disposed) this.report({ kind: 'invalid', cause }, false)
    }
    let asked: Promise<string>
    try {
      asked = Promise.resolve(ask())
    } catch (err) {
      fail(err)
      return
    }
    void asked.then((signed) => {
      if (this.disposed) return
      if (typeof signed !== 'string' || signed.length === 0 || signed.length > MAX_EMBED_TOKEN_CHARS) {
        fail(new TypeError(`The token must be a signed token (1 to ${MAX_EMBED_TOKEN_CHARS} characters).`))
        return
      }
      // Exact origin: a frame navigated off DataSquares never receives the person's token.
      target?.postMessage({ type: 'ds:token', version: EMBED_PROTOCOL_VERSION, token: signed }, this.o.embedOrigin)
    }, fail)
  }
}
