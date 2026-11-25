/**
 * `<datasquares-chat>` and `<datasquares-embed>` — the DataSquares AI chat and embed for pages without React: plain
 * custom elements, with no framework and nothing to build. One script defines both:
 *
 *   <script type="module" src="https://unpkg.com/@digisquares/datasquares-react@0.5.0/dist/element.js"></script>
 *   <datasquares-chat base-url="https://app.datasquares.ai" token-url="/analytics-token"></datasquares-chat>
 *
 * The same frames, protocol and rules as `<DataSquaresChat>` and `<DataSquaresEmbed>`: each person's signed token,
 * fetched from your server when the frame asks (`token-url`, or a `getToken` function property), never in an address;
 * messages pinned to the element's own iframe and the DataSquares origin; commands that wait until the frame listens
 * (frame-channel.ts). Attributes configure them, methods drive them, and DOM events (`ds-…`, bubbling, `detail`
 * carrying what the React callbacks get) tell your page what happened.
 *
 * `<datasquares-chat follows="my-embed">` follows a `<datasquares-embed id="my-embed">` on the page: the menu item it
 * shows and the filters the person sets become the chat's context.
 *
 * Importing this module defines the two elements once (a page that already has them keeps its own);
 * `defineDataSquaresElements()` does it on demand. It is safe to import where there is no DOM (a server render): it
 * defines nothing there.
 */
import {
  CHAT_CONTEXT_LIMITS,
  EMBED_PROTOCOL_VERSION,
  MAX_CHAT_QUESTION_CHARS,
  MAX_EMBED_TOKEN_CHARS,
  boundedChatCharts,
  boundedChatTables,
  type ChatContext,
  type ChatMode,
  type EmbedFilter,
  type EmbedInMessage,
  type EmbedMenuItem,
  type EmbedOutMessage,
  type EmbedState,
} from './protocol.js'
import { buildChatUrl, buildEmbedUrl, buildSessionEmbedUrl, embedOrigin, type EmbedFont, type EmbedMenuLayout } from './urls.js'
import { DEFAULT_LOAD_TIMEOUT_MS, FrameChannel, type EmbedError, type EmbedStatus } from './frame-channel.js'

export type { ChatChart, ChatContext, ChatMode, ChatTable, EmbedFilter, EmbedMenuItem, EmbedState } from './protocol.js'
export type { EmbedError, EmbedStatus } from './frame-channel.js'

/** A base to extend where custom elements exist; a stand-in class elsewhere, so importing on a server never throws. */
const ElementBase: typeof HTMLElement = typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement

/** The person's token from your server: `GET token-url` (with cookies), its body the token, as text or `{ "token": "…" }`. */
async function tokenFrom(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/plain, application/json' } })
  if (!res.ok) throw new Error(`token-url answered ${res.status}`)
  const text = (await res.text()).trim()
  if (text.startsWith('{')) {
    const token = (JSON.parse(text) as { token?: unknown }).token
    if (typeof token === 'string') return token
    throw new Error('token-url answered JSON without a "token"')
  }
  return text
}

const cssColour = (c: string | null, fallback: string) => (!c ? fallback : /^[0-9a-f]{3,8}$/i.test(c) ? `#${c}` : c)
const cssSize = (v: string | null, fallback: string) => (!v ? fallback : /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v)
const intOf = (v: string | null, fallback: number) => {
  const n = v === null ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** What the frames have in common: the base URL, the token, the channel, the iframe, the events. */
abstract class FrameElement extends ElementBase {
  /**
   * Your function for the person's signed token (instead of `token-url`). Declared, never a class field: a field would
   * wipe a function your page set before the element upgraded (the module script runs after inline scripts).
   */
  declare getToken?: () => Promise<string>
  protected channel: FrameChannel | null = null
  /** The origin the channel is pinned to: a new `base-url` origin makes a new channel and frame. */
  private channelOrigin: string | null = null
  /** Commands sent before there is a channel (the frame not made yet, or the element not connected): sent once it is. */
  private pending: EmbedInMessage[] = []
  protected iframe: HTMLIFrameElement | null = null
  protected root!: ShadowRoot
  protected src = ''
  protected abstract readonly elementName: string
  protected abstract readonly lastWins: ReadonlySet<EmbedInMessage['type']>

  /** `loading`, `ready` or `error`. */
  get status(): EmbedStatus {
    return this.channel?.status ?? 'loading'
  }

  /** The last error, while `status` is `error`. */
  get error(): EmbedError | null {
    return this.channel?.lastError ?? null
  }

  protected get baseUrl(): string {
    return this.getAttribute('base-url') ?? ''
  }

  protected emit<T>(name: string, detail: T, cancelable = false): boolean {
    return this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable }))
  }

  /**
   * Properties your page set before the element upgraded sit on the element itself and hide the class's setters: take
   * each off and set it again, so the setter runs (the custom-elements "lazy property" pattern).
   */
  protected upgradeProperties(names: readonly string[]): void {
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(this, name)) continue
      const self = this as unknown as Record<string, unknown>
      const value = self[name]
      delete self[name]
      self[name] = value
    }
  }

  protected tokenSource(): (() => Promise<string>) | undefined {
    if (this.getToken) return () => this.getToken!()
    const url = this.getAttribute('token-url')
    return url ? () => tokenFrom(url) : undefined
  }

  /** The channel, made once per origin; the iframe made on first need. */
  protected ensureFrame(onMessage: (msg: EmbedOutMessage) => void): HTMLIFrameElement | null {
    let origin: string
    try {
      origin = embedOrigin(this.baseUrl)
    } catch (err) {
      console.error(`[${this.elementName}] ${(err as Error).message.replace('DataSquaresEmbed: baseUrl', 'base-url')}`)
      return null
    }
    // A `base-url` on another origin: the channel only hears its own origin, so the frame starts again with a new one.
    if (this.channel && this.channelOrigin !== origin) {
      this.channel.dispose()
      this.channel = null
      this.iframe?.remove()
      this.iframe = null
      this.src = ''
    }
    if (!this.channel) {
      this.channelOrigin = origin
      this.channel = new FrameChannel({
        embedOrigin: origin,
        getToken: () => {
          const source = this.tokenSource()
          if (!source) return Promise.reject(new Error('Set token-url, or a getToken function, for the person\'s signed token.'))
          return source()
        },
        loadTimeoutMs: intOf(this.getAttribute('load-timeout'), DEFAULT_LOAD_TIMEOUT_MS),
        lastWins: this.lastWins,
        name: this.elementName,
        onMessage,
        onError: (error) => this.emit('ds-error', error),
        onStatusChange: (status) => this.emit('ds-status-change', { status }),
      })
      // What was sent before the channel: it waits in the channel's queue until the frame listens.
      const held = this.pending
      this.pending = []
      for (const msg of held) this.channel.post(msg)
    }
    if (!this.iframe) {
      const iframe = document.createElement('iframe')
      iframe.title = this.getAttribute('frame-title') ?? this.defaultFrameTitle()
      iframe.allow = 'clipboard-write'
      iframe.referrerPolicy = 'strict-origin-when-cross-origin'
      iframe.setAttribute('part', 'frame')
      iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;color-scheme:normal'
      iframe.addEventListener('load', () => this.channel?.frameLoaded())
      this.iframe = iframe
    }
    return this.iframe
  }

  /** Point the iframe at `src`; a new address is a new page in the frame. */
  protected navigate(src: string): void {
    if (!this.iframe || !this.channel) return
    if (src === this.src && this.iframe.isConnected) return
    this.src = src
    this.channel.attach(this.iframe)
    this.iframe.src = src
  }

  /** Load the frame again from the start (a new token). */
  reload(): void {
    if (!this.iframe || !this.channel || !this.src) return
    this.channel.newPage()
    const src = this.src
    this.iframe.src = 'about:blank'
    this.iframe.src = src
  }

  /** Send a command; before there is a channel it is held (only the last of a kind the frame keeps last), and sent then. */
  protected post(msg: EmbedInMessage): void {
    if (this.channel) {
      this.channel.post(msg)
      return
    }
    if (this.lastWins.has(msg.type)) this.pending = this.pending.filter((m) => m.type !== msg.type)
    this.pending.push(msg)
  }

  protected abstract defaultFrameTitle(): string

  disconnectedCallback(): void {
    this.channel?.dispose()
    this.channel = null
    this.channelOrigin = null
    this.iframe = null
    this.src = ''
  }
}

// ─── <datasquares-chat> ─────────────────────────────────────────────────────────────────────────────────────────────

const CHAT_URL_ATTRIBUTES = ['base-url', 'theme', 'primary-color', 'logo-url', 'background', 'font', 'scope', 'item', 'standalone', 'chat-title', 'greeting', 'placeholder', 'suggestions', 'conversation']
const CHAT_LAST_WINS: ReadonlySet<EmbedInMessage['type']> = new Set(['ds:set-mode', 'ds:open-conversation', 'ds:new-conversation', 'ds:set-context'])
const CHAT_MODES: ReadonlySet<string> = new Set(['inline', 'panel', 'fullscreen'])
const SPARKLE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10.5 13.9 12.4 12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/></svg>'

/** `suggestions`: a JSON array of questions, or one question a line. */
function suggestionsOf(v: string | null): string[] {
  if (!v) return []
  const t = v.trim()
  if (t.startsWith('[')) {
    try {
      const list = JSON.parse(t) as unknown
      return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []
    } catch {
      return []
    }
  }
  return t.split('\n').map((s) => s.trim()).filter(Boolean)
}

/** A context within the chat's bounds (it ignores one past them). */
function boundedContext(c: ChatContext | null | undefined): ChatContext | null {
  if (!c || typeof c !== 'object') return null
  const L = CHAT_CONTEXT_LIMITS
  const out: ChatContext = {}
  if (typeof c.itemId === 'string' && c.itemId && c.itemId.length <= L.itemId) out.itemId = c.itemId
  if (typeof c.cardId === 'string' && c.cardId && c.cardId.length <= L.cardId) out.cardId = c.cardId
  if (typeof c.note === 'string' && c.note.trim() && c.note.length <= L.note) out.note = c.note
  if (typeof c.label === 'string' && c.label.trim() && c.label.length <= L.label) out.label = c.label
  const filters = Array.isArray(c.filters) ? c.filters.filter((f) => f && typeof f.fieldId === 'string' && f.fieldId && typeof f.operator === 'string' && f.operator) : []
  if (filters.length > 0) out.filters = filters.slice(0, L.filters)
  return out
}

/**
 * The DataSquares AI chat. Attributes: `base-url` (required), `token-url`, `mode` (`panel` default, `inline`,
 * `fullscreen`), `open` (a panel open), `scope`, `item`, `standalone` (the analyst alone), `chat-title`, `greeting`,
 * `placeholder`, `suggestions` (a JSON array, or one a line), `conversation`, `theme`, `primary-color`, `logo-url`,
 * `background`, `font`, `launcher-label`, `position` (`bottom-right`, `bottom-left`), `panel-width`, `panel-height`,
 * `height` (inline), `z-index`, `load-timeout`, `frame-title`, `follows` (a `<datasquares-embed>`'s id). Properties:
 * `getToken`, `context`, `standalone`, `status`, `error`. Methods: `ask`, `newConversation`, `openConversation`, `setMode`, `setOpen`, `setContext`, `reload`. Events:
 * `ds-ready`, `ds-answer`, `ds-feedback`, `ds-follow-up`, `ds-conversation-change`, `ds-limit`, `ds-mode-change`
 * (cancelable when the person switched in the chat: the switch is undone), `ds-open-change`, `ds-error`,
 * `ds-status-change`.
 */
export class DataSquaresChatElement extends FrameElement {
  static observedAttributes = [...CHAT_URL_ATTRIBUTES, 'mode', 'open', 'position', 'panel-width', 'panel-height', 'height', 'z-index', 'launcher-label', 'follows']
  protected readonly elementName = 'datasquares-chat'
  protected readonly lastWins = CHAT_LAST_WINS
  private box!: HTMLDivElement
  private launcher!: HTMLButtonElement
  private exitTo: 'inline' | 'panel' = 'panel'
  private shownMode: ChatMode | null = null
  private wasOpen = false
  private savedOverflow: string | null = null
  private narrow: MediaQueryList | null = null
  private ctx: ChatContext | null | undefined = undefined
  private unfollow: (() => void) | null = null
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.mode === 'fullscreen') this.switchTo(this.exitTo)
  }
  private readonly onNarrow = () => this.layout()

  constructor() {
    super()
    if (typeof HTMLElement === 'undefined') return
    this.root = this.attachShadow({ mode: 'open' })
    this.root.innerHTML =
      '<style>:host{display:block}:host([hidden]){display:none}.launcher{position:fixed;bottom:20px;display:inline-flex;align-items:center;gap:8px;' +
      'padding:10px 16px;min-height:44px;border:0;border-radius:999px;color:#fff;font:500 14px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08);cursor:pointer}.launcher:focus-visible{outline:2px solid #fff;outline-offset:-4px}</style>'
    this.launcher = document.createElement('button')
    this.launcher.type = 'button'
    this.launcher.className = 'launcher'
    this.launcher.setAttribute('part', 'launcher')
    this.launcher.setAttribute('aria-expanded', 'false')
    this.launcher.addEventListener('click', () => this.setOpen(true))
    this.box = document.createElement('div')
    this.box.setAttribute('part', 'box')
    this.box.id = 'chat'
    this.launcher.setAttribute('aria-controls', 'chat')
    this.root.append(this.launcher, this.box)
  }

  /** How the chat shows: `panel` (default), `inline`, or `fullscreen`. */
  get mode(): ChatMode {
    const m = this.getAttribute('mode')
    return m && CHAT_MODES.has(m) ? (m as ChatMode) : 'panel'
  }
  set mode(next: ChatMode) {
    this.setAttribute('mode', next)
  }

  /** `panel` mode: whether the panel is open. */
  get open(): boolean {
    return this.hasAttribute('open')
  }
  set open(next: boolean) {
    this.toggleAttribute('open', next)
  }

  /** The analyst alone: the chat answers only from the app's data models (`standalone=1`). Only narrows. */
  get standalone(): boolean {
    return this.hasAttribute('standalone')
  }
  set standalone(next: boolean) {
    this.toggleAttribute('standalone', Boolean(next))
  }

  /** What the person is looking at; each question carries it (null clears it). */
  get context(): ChatContext | null {
    return this.ctx ?? null
  }
  set context(next: ChatContext | null) {
    this.setContext(next)
  }

  protected defaultFrameTitle(): string {
    return 'DataSquares AI chat'
  }

  connectedCallback(): void {
    this.upgradeProperties(['getToken', 'context', 'mode', 'open', 'standalone'])
    if (typeof window.matchMedia === 'function') {
      this.narrow = window.matchMedia('(max-width: 640px)')
      this.narrow.addEventListener?.('change', this.onNarrow)
    }
    window.addEventListener('keydown', this.onKey)
    this.exitTo = this.mode === 'inline' ? 'inline' : 'panel'
    this.wasOpen = this.open
    this.follow()
    this.layout()
  }

  disconnectedCallback(): void {
    this.narrow?.removeEventListener?.('change', this.onNarrow)
    window.removeEventListener('keydown', this.onKey)
    this.unfollow?.()
    this.unfollow = null
    this.lockScroll(false)
    super.disconnectedCallback()
    this.box?.replaceChildren()
    this.shownMode = null
    // A frame made after the element moves is a new page: it hears the mode and the context again.
    this.lastSrc = ''
  }

  attributeChangedCallback(name: string, before: string | null, after: string | null): void {
    if (!this.isConnected || before === after) return
    if (name === 'mode' && after === 'fullscreen' && before !== 'fullscreen') this.exitTo = before === 'inline' ? 'inline' : 'panel'
    if (name === 'follows') this.follow()
    this.layout()
  }

  // ── Commands ──

  /** Ask a question as if the person had typed it (a folded panel opens). Waits until the chat listens. */
  ask(question: string): void {
    const q = String(question ?? '').trim()
    if (!q) return
    if (q.length > MAX_CHAT_QUESTION_CHARS) console.warn(`[datasquares-chat] ask(): a question is at most ${MAX_CHAT_QUESTION_CHARS} characters; the chat ignores a longer one.`)
    if (this.mode === 'panel') this.setOpen(true)
    this.post({ type: 'ds:ask', version: EMBED_PROTOCOL_VERSION, question: q })
  }

  newConversation(): void {
    this.post({ type: 'ds:new-conversation', version: EMBED_PROTOCOL_VERSION })
  }

  openConversation(conversationId: string): void {
    this.post({ type: 'ds:open-conversation', version: EMBED_PROTOCOL_VERSION, conversationId })
  }

  /** Show the chat another way. */
  setMode(next: ChatMode): void {
    if (CHAT_MODES.has(next)) this.switchTo(next, false)
  }

  /** `panel` mode: open or fold the panel. */
  setOpen(next: boolean): void {
    if (next === this.open) return
    this.open = next
  }

  /** Tell the chat what the person is looking at (null: nothing). Each question carries it until the next. */
  setContext(next: ChatContext | null): void {
    this.ctx = boundedContext(next)
    this.post({ type: 'ds:set-context', version: EMBED_PROTOCOL_VERSION, context: this.ctx })
  }

  // ── Inside ──

  /** A switch the chat asked for (cancelable by the page), or the page's own. */
  private switchTo(next: ChatMode, fromChat = true): void {
    if (next === this.mode) return
    if (fromChat && !this.emit('ds-mode-change', { mode: next }, true)) return
    if (next === 'panel' && !this.open) this.open = true
    this.mode = next
    if (!fromChat) this.emit('ds-mode-change', { mode: next })
  }

  private chatUrl(): string {
    return buildChatUrl({
      baseUrl: this.baseUrl,
      theme: this.getAttribute('theme') ?? undefined,
      primaryColor: this.getAttribute('primary-color') ?? undefined,
      logoUrl: this.getAttribute('logo-url') ?? undefined,
      background: this.getAttribute('background') ?? undefined,
      font: (this.getAttribute('font') as EmbedFont | null) ?? undefined,
      scope: this.getAttribute('scope') === 'view' ? 'view' : this.getAttribute('scope') === 'menu' ? 'menu' : undefined,
      item: this.getAttribute('item') ?? undefined,
      standalone: this.standalone,
      title: this.getAttribute('chat-title') ?? undefined,
      greeting: this.getAttribute('greeting') ?? undefined,
      placeholder: this.getAttribute('placeholder') ?? undefined,
      suggestions: suggestionsOf(this.getAttribute('suggestions')),
      conversation: this.getAttribute('conversation') ?? undefined,
    })
  }

  private onMessage = (msg: EmbedOutMessage) => {
    switch (msg.type) {
      case 'ds:ready':
        if (msg.contentType === 'chat') this.emit('ds-ready', { items: msg.items ?? [] })
        break
      case 'ds:chat-answer': {
        const charts = boundedChatCharts(msg.charts)
        const tables = boundedChatTables(msg.tables)
        this.emit('ds-answer', {
          question: msg.question,
          answer: msg.answer,
          conversationId: msg.conversationId,
          blocked: msg.blocked,
          followUps: msg.followUps ?? [],
          answerIndex: msg.answerIndex ?? null,
          ...(charts ? { charts } : {}),
          ...(tables ? { tables } : {}),
        })
        break
      }
      case 'ds:chat-feedback':
        this.emit('ds-feedback', { conversationId: msg.conversationId, answerIndex: msg.answerIndex, rating: msg.rating, reason: msg.reason, note: msg.note })
        break
      case 'ds:chat-follow-up':
        this.emit('ds-follow-up', { conversationId: msg.conversationId, question: msg.question, source: msg.source })
        break
      case 'ds:conversation-change':
        this.emit('ds-conversation-change', { conversationId: msg.conversationId })
        break
      case 'ds:chat-limit':
        this.emit('ds-limit', { code: msg.code, scope: msg.scope, message: msg.message })
        break
      case 'ds:mode-request':
        if (msg.mode === 'minimized') {
          if (this.mode === 'panel') this.open = false
        } else this.switchTo(msg.mode)
        break
    }
  }

  /** Draw the launcher and the box for the mode, load the frame on first show, and tell the chat its mode. */
  private layout(): void {
    if (!this.box) return
    const mode = this.mode
    const open = this.open
    const shown = mode !== 'panel' || open
    const z = String(intOf(this.getAttribute('z-index'), 2147483000))
    const side = this.getAttribute('position') === 'bottom-left' ? 'left' : 'right'
    const shadow = '0 12px 40px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08)'

    // The launcher: a folded panel's way in.
    this.launcher.hidden = !(mode === 'panel' && !open)
    this.launcher.style.background = cssColour(this.getAttribute('primary-color'), '#111827')
    this.launcher.style.zIndex = z
    this.launcher.style.left = side === 'left' ? '20px' : ''
    this.launcher.style.right = side === 'right' ? '20px' : ''
    this.launcher.innerHTML = SPARKLE
    this.launcher.append(document.createTextNode(this.getAttribute('launcher-label') ?? 'Ask AI'))

    // The box, by mode.
    const s = this.box.style
    s.cssText = ''
    if (mode === 'inline') Object.assign(s, { position: 'relative', width: '100%', height: cssSize(this.getAttribute('height'), '600px') })
    else if (mode === 'fullscreen') Object.assign(s, { position: 'fixed', inset: '0', zIndex: z })
    else if (this.narrow?.matches) Object.assign(s, { position: 'fixed', left: '0', right: '0', bottom: '0', height: '85vh', zIndex: z, borderRadius: '16px 16px 0 0', boxShadow: shadow, overflow: 'hidden' })
    else {
      Object.assign(s, {
        position: 'fixed',
        bottom: '20px',
        [side]: '20px',
        width: `${intOf(this.getAttribute('panel-width'), 400)}px`,
        height: `${intOf(this.getAttribute('panel-height'), 600)}px`,
        maxWidth: 'calc(100vw - 40px)',
        maxHeight: 'calc(100vh - 40px)',
        zIndex: z,
        borderRadius: '12px',
        boxShadow: shadow,
        overflow: 'hidden',
      })
    }
    if (!shown) s.display = 'none'
    if (mode === 'inline') {
      this.box.removeAttribute('role')
      this.box.removeAttribute('aria-modal')
      this.box.removeAttribute('aria-label')
    } else {
      this.box.setAttribute('role', 'dialog')
      this.box.setAttribute('aria-modal', String(mode === 'fullscreen'))
      this.box.setAttribute('aria-label', this.getAttribute('frame-title') ?? this.defaultFrameTitle())
    }
    this.lockScroll(mode === 'fullscreen')

    // The frame: loaded when the chat is first shown, and kept.
    if (shown) {
      const iframe = this.ensureFrame(this.onMessage)
      if (iframe && !iframe.isConnected) this.box.append(iframe)
      if (iframe) this.navigate(this.chatUrl())
    } else if (this.iframe) this.navigate(this.chatUrl())

    // The chat draws the controls of its mode; a new page hears it (and the context) again, as the channel waits.
    if (this.iframe && (this.shownMode !== mode || this.src !== this.lastSrc)) {
      this.post({ type: 'ds:set-mode', version: EMBED_PROTOCOL_VERSION, mode, ...(mode === 'fullscreen' ? { exitTo: this.exitTo } : {}) })
      if (this.ctx !== undefined && this.src !== this.lastSrc) this.post({ type: 'ds:set-context', version: EMBED_PROTOCOL_VERSION, context: this.ctx })
      this.shownMode = mode
      this.lastSrc = this.src
    }

    // Focus follows the panel: into the chat when it opens, back to the launcher when it folds.
    if (mode === 'panel') {
      if (open && !this.wasOpen) this.iframe?.focus()
      if (!open && this.wasOpen) this.launcher.focus()
    }
    if (open !== this.wasOpen && mode === 'panel') this.emit('ds-open-change', { open })
    this.wasOpen = open
  }
  private lastSrc = ''

  reload(): void {
    super.reload()
    if (!this.iframe) return
    this.post({ type: 'ds:set-mode', version: EMBED_PROTOCOL_VERSION, mode: this.mode, ...(this.mode === 'fullscreen' ? { exitTo: this.exitTo } : {}) })
    if (this.ctx !== undefined) this.post({ type: 'ds:set-context', version: EMBED_PROTOCOL_VERSION, context: this.ctx })
  }

  private lockScroll(on: boolean): void {
    if (on && this.savedOverflow === null) {
      this.savedOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    } else if (!on && this.savedOverflow !== null) {
      document.body.style.overflow = this.savedOverflow
      this.savedOverflow = null
    }
  }

  /** `follows`: the embed's item and filters become the chat's context. */
  private follow(): void {
    this.unfollow?.()
    this.unfollow = null
    const id = this.getAttribute('follows')
    if (!id) return
    let itemId: string | undefined
    let filters: EmbedFilter[] = []
    const tell = () => this.setContext({ ...(itemId ? { itemId } : {}), ...(filters.length ? { filters } : {}) })
    const onReady = (e: Event) => {
      const item = (e as CustomEvent<{ item?: EmbedMenuItem | null }>).detail?.item
      if (item) {
        itemId = item.id
        filters = []
        tell()
      }
    }
    const onItem = (e: Event) => {
      itemId = (e as CustomEvent<{ item: EmbedMenuItem }>).detail.item.id
      filters = []
      tell()
    }
    const onFilters = (e: Event) => {
      filters = (e as CustomEvent<{ filters: EmbedFilter[] }>).detail.filters ?? []
      tell()
    }
    // The events bubble to the document, so the embed is heard even when it is added after the chat.
    const doc = this.ownerDocument
    const only = (handler: (e: Event) => void) => (e: Event) => {
      if ((e.target as Element | null)?.id === id) handler(e)
    }
    const handlers: Array<[string, (e: Event) => void]> = [
      ['ds-ready', only(onReady)],
      ['ds-item-change', only(onItem)],
      ['ds-filter-change', only(onFilters)],
    ]
    for (const [name, h] of handlers) doc.addEventListener(name, h)
    this.unfollow = () => {
      for (const [name, h] of handlers) doc.removeEventListener(name, h)
    }
  }
}

// ─── <datasquares-embed> ────────────────────────────────────────────────────────────────────────────────────────────

const EMBED_URL_ATTRIBUTES = ['base-url', 'share-token', 'content-id', 'theme', 'toolbar', 'primary-color', 'logo-url', 'page', 'tabs', 'background', 'font', 'padding', 'item', 'menu', 'params']
const EMBED_LAST_WINS: ReadonlySet<EmbedInMessage['type']> = new Set(['ds:set-params', 'ds:set-page', 'ds:open'])
const STATE_TIMEOUT_MS = 5_000

const boolAttr = (v: string | null): boolean | undefined => (v === null ? undefined : v !== 'false')

/**
 * A DataSquares dashboard, report or presentation — one, or a menu of them. Attributes: `base-url` (required); for each
 * person, `token-url` (or a `getToken` property); for a share link, `share-token` and `content-id`; `theme`, `toolbar`,
 * `primary-color`, `logo-url`, `page`, `tabs`, `background`, `font`, `padding`, `item`, `menu`, `params` (JSON),
 * `height` (default 600), `auto-height` (grow to the content), `load-timeout`, `frame-title`. Methods: `setParams`,
 * `setPage`, `open`, `refresh`, `getState`, `reload`. Events: `ds-ready`, `ds-item-change`, `ds-page-change`,
 * `ds-point-click`, `ds-filter-change`, `ds-resize`, `ds-error`, `ds-status-change`.
 */
export class DataSquaresEmbedElement extends FrameElement {
  static observedAttributes = [...EMBED_URL_ATTRIBUTES, 'height', 'auto-height']
  protected readonly elementName = 'datasquares-embed'
  protected readonly lastWins = EMBED_LAST_WINS
  private box!: HTMLDivElement
  private pendingState = new Map<string, (state: EmbedState) => void>()
  private stateSeq = 0
  private contentHeight: number | null = null

  constructor() {
    super()
    if (typeof HTMLElement === 'undefined') return
    this.root = this.attachShadow({ mode: 'open' })
    this.root.innerHTML = '<style>:host{display:block}:host([hidden]){display:none}</style>'
    this.box = document.createElement('div')
    this.box.setAttribute('part', 'box')
    this.box.style.position = 'relative'
    this.root.append(this.box)
  }

  protected defaultFrameTitle(): string {
    return 'DataSquares embed'
  }

  connectedCallback(): void {
    this.upgradeProperties(['getToken'])
    this.render()
  }

  attributeChangedCallback(_name: string, before: string | null, after: string | null): void {
    if (this.isConnected && before !== after) this.render()
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.box?.replaceChildren()
    this.pendingState.clear()
  }

  /** Override dashboard parameter values (merged over the address's). */
  setParams(params: Record<string, unknown>): void {
    this.post({ type: 'ds:set-params', version: EMBED_PROTOCOL_VERSION, params })
  }

  /** Show another dashboard page. */
  setPage(pageId: string): void {
    this.post({ type: 'ds:set-page', version: EMBED_PROTOCOL_VERSION, pageId })
  }

  /** A menu token: open another item of the person's menu (an id not in it is ignored). */
  open(itemId: string): void {
    this.post({ type: 'ds:open', version: EMBED_PROTOCOL_VERSION, itemId })
  }

  /** Load the content again (picks up what was published since). */
  refresh(): void {
    this.post({ type: 'ds:refresh', version: EMBED_PROTOCOL_VERSION })
  }

  /** The embed's page and parameter values; rejects after 5 s without an answer. */
  getState(): Promise<EmbedState> {
    const requestId = `s${++this.stateSeq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingState.delete(requestId)
        reject(new Error('The embed did not answer getState() within 5 s.'))
      }, STATE_TIMEOUT_MS)
      this.pendingState.set(requestId, (state) => {
        clearTimeout(timer)
        resolve(state)
      })
      this.post({ type: 'ds:get-state', version: EMBED_PROTOCOL_VERSION, requestId })
    })
  }

  private embedUrl(): string {
    let params: Record<string, string | number | boolean> | undefined
    const rawParams = this.getAttribute('params')
    if (rawParams) {
      try {
        params = JSON.parse(rawParams) as Record<string, string | number | boolean>
      } catch {
        console.warn('[datasquares-embed] params must be a JSON object.')
      }
    }
    const opts = {
      baseUrl: this.baseUrl,
      theme: this.getAttribute('theme') ?? undefined,
      toolbar: boolAttr(this.getAttribute('toolbar')),
      primaryColor: this.getAttribute('primary-color') ?? undefined,
      logoUrl: this.getAttribute('logo-url') ?? undefined,
      page: this.getAttribute('page') ?? undefined,
      tabs: boolAttr(this.getAttribute('tabs')),
      background: this.getAttribute('background') ?? undefined,
      font: (this.getAttribute('font') as EmbedFont | null) ?? undefined,
      padding: (this.getAttribute('padding') as 'none' | 'compact' | 'normal' | null) ?? undefined,
      item: this.getAttribute('item') ?? undefined,
      menu: (this.getAttribute('menu') as EmbedMenuLayout | null) ?? undefined,
      ...(params ? { params } : {}),
    }
    const shareToken = this.getAttribute('share-token')
    const contentId = this.getAttribute('content-id')
    if (shareToken && contentId) {
      if (shareToken.length > MAX_EMBED_TOKEN_CHARS) console.warn('[datasquares-embed] share-token is too long.')
      return buildEmbedUrl({ ...opts, contentId, token: shareToken })
    }
    return buildSessionEmbedUrl(opts)
  }

  private onMessage = (msg: EmbedOutMessage) => {
    switch (msg.type) {
      case 'ds:ready':
        if (msg.contentType === 'chat') return
        this.emit('ds-ready', { contentType: msg.contentType, pages: msg.pages, item: msg.item ?? null, items: msg.items ?? [] })
        break
      case 'ds:item-change':
        this.emit('ds-item-change', { item: msg.item })
        break
      case 'ds:page-change':
        this.emit('ds-page-change', { pageId: msg.pageId })
        break
      case 'ds:point-click':
        this.emit('ds-point-click', { cardId: msg.cardId, value: msg.value })
        break
      case 'ds:filter-change':
        this.emit('ds-filter-change', { filters: msg.filters })
        break
      case 'ds:resize':
        this.contentHeight = msg.height
        if (this.hasAttribute('auto-height')) this.box.style.height = `${Math.max(0, Math.ceil(msg.height))}px`
        this.emit('ds-resize', { height: msg.height })
        break
      case 'ds:state': {
        const done = msg.requestId ? this.pendingState.get(msg.requestId) : undefined
        if (done && msg.requestId) {
          this.pendingState.delete(msg.requestId)
          done(msg.state)
        }
        break
      }
    }
  }

  private render(): void {
    if (!this.box) return
    const auto = this.hasAttribute('auto-height')
    this.box.style.height = auto && this.contentHeight !== null ? `${Math.ceil(this.contentHeight)}px` : cssSize(this.getAttribute('height'), '600px')
    const iframe = this.ensureFrame(this.onMessage)
    if (!iframe) return
    if (!iframe.isConnected) this.box.append(iframe)
    this.navigate(this.embedUrl())
  }
}

/** Define `<datasquares-chat>` and `<datasquares-embed>` (once: a name already defined keeps its own). */
export function defineDataSquaresElements(registry: CustomElementRegistry | undefined = typeof customElements === 'undefined' ? undefined : customElements): void {
  if (!registry) return
  if (!registry.get('datasquares-chat')) registry.define('datasquares-chat', DataSquaresChatElement)
  if (!registry.get('datasquares-embed')) registry.define('datasquares-embed', DataSquaresEmbedElement)
}

defineDataSquaresElements()

declare global {
  interface HTMLElementTagNameMap {
    'datasquares-chat': DataSquaresChatElement
    'datasquares-embed': DataSquaresEmbedElement
  }
}
