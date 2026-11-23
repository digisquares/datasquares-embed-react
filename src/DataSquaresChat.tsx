'use client'
/**
 * <DataSquaresChat> — the DataSquares AI chat in your page: the same chat as DataSquares' own, running in a DataSquares
 * frame, answering from the dashboards and reports each person's signed token names (one of them, or the embed app's
 * menu: all of its dashboards and reports), under their own row rules and the app's AI budgets.
 *
 * ── Three ways to show it, switchable at any time ───────────────────────
 *   - `inline`: it fills a box of your page (`height`).
 *   - `panel` (the default): a launcher button in a corner opens a floating panel; on a narrow screen the panel is a
 *     sheet from the bottom. The chat's own Minimize folds it back to the launcher.
 *   - `fullscreen`: it covers the window; the chat's Exit and Esc go back to the mode it came from.
 * The frame is the same one in every mode, so a conversation carries on across a switch. In `panel` mode the frame
 * loads when the panel first opens, and stays loaded (hidden) while it is folded.
 *
 * `mode` and `open` may be controlled (with `onModeChange` / `onOpenChange`, which hear the person's own switches in
 * the chat), or left to the component (`defaultMode`, `defaultOpen`).
 *
 * ── The same channel as <DataSquaresEmbed> ─────────────────────────────
 * Messages are pinned to this iframe's window and the DataSquares origin of `baseUrl`; commands wait until the chat
 * listens; the person's signed token is handed over when the chat asks (`getToken`, the same server route as the
 * embed's), never in a URL; a chat that never speaks is `timeout` (frame-bridge.ts).
 *
 * ── What the person is looking at ───────────────────────────────────────
 * `context` (or `setContext()`) tells the chat which menu item the person is on, a card, the filters they have on, a
 * short note: each question carries it, and the chat shows it on a chip the person can set aside. With
 * `<DataSquaresEmbed>` beside it, pass its `onItemChange` and `onFilterChange` along. A hint, never access.
 *
 * ── What you hear ───────────────────────────────────────────────────────
 * Each answer (`onAnswer`, with the follow-ups it offers), each rating (`onFeedback`: helpful or not, why, and the
 * person's note, which only you get), each follow-up or suggestion picked (`onFollowUp`), each conversation change and
 * each limit reached.
 */
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CHAT_CONTEXT_LIMITS,
  EMBED_PROTOCOL_VERSION,
  MAX_CHAT_QUESTION_CHARS,
  type ChatContext,
  type ChatFeedbackReason,
  type ChatMode,
  type EmbedInMessage,
  type EmbedMenuItem,
  type EmbedOutMessage,
} from './protocol.js'
import { buildChatUrl, embedOrigin as originOf, type EmbedFont } from './urls.js'
import { DEV, isInsecureRemote, warnOnce } from './dev.js'
import { DEFAULT_LOAD_TIMEOUT_MS, useFrameBridge, type EmbedError, type EmbedStatus } from './frame-bridge.js'

export type { ChatContext, ChatFeedbackReason, ChatMode } from './protocol.js'

/** What `onReady` hears: the menu the chat asks about (empty when it asks about one dashboard or report). */
export interface ChatReadyInfo {
  items: EmbedMenuItem[]
}

/** A finished answer, as the chat kept it (`blocked`: it was withheld). */
export interface ChatAnswer {
  question: string
  answer: string
  conversationId: string | null
  blocked: boolean
  /** The follow-up questions it offers. */
  followUps: string[]
  /** Its number in the conversation (0 first), as `onFeedback` names it; null when it was not kept. */
  answerIndex: number | null
}

/** The person rated an answer. */
export interface ChatFeedback {
  conversationId: string
  answerIndex: number
  rating: 'up' | 'down'
  /** Why it was not helpful (a `down` rating). */
  reason: ChatFeedbackReason | null
  /** What the person typed about it. Only you get it: DataSquares keeps the rating and the reason, never the note. */
  note: string | null
}

/** The person picked a question instead of typing it. */
export interface ChatFollowUp {
  conversationId: string | null
  question: string
  /** `follow-up`: offered under an answer; `suggestion`: one of the questions to start with. */
  source: 'follow-up' | 'suggestion'
}

/** One of the embed app's monthly budgets or hourly limits stopped a question: the person's, or their organization's. */
export interface ChatLimit {
  code: 'EMBED_AI_BUDGET_REACHED' | 'EMBED_AI_RATE_LIMITED'
  scope: 'person' | 'tenant' | null
  message: string
}

export interface DataSquaresChatProps {
  /** Your DataSquares app URL, e.g. `https://app.datasquares.ai`. */
  baseUrl: string
  /**
   * Returns a short-lived token YOUR server signed for the current person with your embed app's key — the same route
   * as `<DataSquaresEmbed>`'s. Its `content` decides what the chat asks about: one dashboard or report, or the app's
   * menu. The token's role must be `viewer_ai`, and the app's Ask AI on.
   */
  getToken: () => Promise<string>
  /** How the chat shows now (controlled; pair with `onModeChange`). */
  mode?: ChatMode
  /** How the chat shows first, when `mode` is not controlled (default `panel`). */
  defaultMode?: ChatMode
  /** The mode changed: the person's own switch in the chat, or `setMode`. */
  onModeChange?: (mode: ChatMode) => void
  /** `panel` mode: whether the panel is open (controlled; pair with `onOpenChange`). */
  open?: boolean
  /** `panel` mode: open the panel at first (default false: the launcher shows). */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** A menu token: `view` keeps the chat on the item the session opens (`item`); default the whole menu. */
  scope?: 'view' | 'menu'
  /** A menu token: the item the session opens (its content id). */
  item?: string
  /** The chat's heading (default "Ask AI"). */
  title?: string
  /** What the empty chat says. */
  greeting?: string
  /** The question field's placeholder. */
  placeholder?: string
  /** Up to four questions to start with (default: questions about the menu's first items). */
  suggestions?: readonly string[]
  /** One of the person's earlier conversations to open first (its id, from `onConversationChange`). */
  conversation?: string
  /**
   * What the person is looking at in your page (the menu item, a card, their filters, a note); each question carries it.
   * Compared by its contents; null clears it. `setContext()` does the same imperatively.
   */
  context?: ChatContext | null
  /** `light`, `dark`, or `auto` (follows the viewer's system); omit for the embed app's look. */
  theme?: 'light' | 'dark' | 'auto'
  /** Your brand colour: hex without the hash, or any CSS colour. Also the launcher's. */
  primaryColor?: string
  /** Your logo (https), in the chat's heading. The "Powered by DataSquares" credit always shows. */
  logoUrl?: string
  /** `default`, `transparent` (your page shows through), or a colour as hex. */
  background?: string
  font?: EmbedFont
  /** The launcher's words (default "Ask AI"). */
  launcherLabel?: string
  /** Where the launcher and the panel sit (default `bottom-right`). */
  position?: 'bottom-right' | 'bottom-left'
  /** The panel's size in px (default 400 × 600; never more than the window). */
  panelWidth?: number
  panelHeight?: number
  /** `inline` mode: the box's height (default 600). */
  height?: number | string
  /** The stacking order of the launcher, the panel and full screen (default 2147483000). */
  zIndex?: number
  /** How long after the frame loads the chat may stay silent before `onError` hears `timeout` (default 15000; 0: off). */
  loadTimeoutMs?: number
  /** Shown over the frame while the chat loads. */
  loadingFallback?: ReactNode
  /** Shown over the frame when the chat fails; a function receives the error and `retry`. */
  errorFallback?: ReactNode | ((error: EmbedError, retry: () => void) => ReactNode)
  /** On the box that holds the frame (every mode). */
  className?: string
  style?: CSSProperties
  /** Accessible name for the iframe (default "DataSquares AI chat"). */
  frameTitle?: string
  /** The chat is ready to answer; with a menu token, the menu it asks about. */
  onReady?: (info: ChatReadyInfo) => void
  /** An answer is finished. */
  onAnswer?: (answer: ChatAnswer) => void
  /** The chat shows another conversation (a new one: null until its first answer). */
  onConversationChange?: (conversationId: string | null) => void
  /** A budget or an hourly limit of the embed app's stopped a question; the chat says so in its own words. */
  onLimitReached?: (limit: ChatLimit) => void
  /** The person rated an answer (helpful or not, why, and their note). */
  onFeedback?: (feedback: ChatFeedback) => void
  /** The person picked a follow-up under an answer, or one of the suggestions. */
  onFollowUp?: (pick: ChatFollowUp) => void
  /** The chat could not start (a bad token, a site not allowed, no Ask AI: `forbidden`), never spoke, or getToken failed. */
  onError?: (error: EmbedError) => void
  onStatusChange?: (status: EmbedStatus) => void
}

export interface DataSquaresChatHandle {
  /** Ask a question as if the person had typed it (a folded panel opens). Waits until the chat listens. */
  ask: (question: string) => void
  /** Start a new conversation. */
  newConversation: () => void
  /** Open one of the person's earlier conversations. */
  openConversation: (conversationId: string) => void
  /** Show the chat another way. */
  setMode: (mode: ChatMode) => void
  /** Tell the chat what the person is looking at (null: nothing). Each question carries it until the next. */
  setContext: (context: ChatContext | null) => void
  /** `panel` mode: open or fold the panel. */
  setOpen: (open: boolean) => void
  /** Load the chat again from the start (a new token). */
  reload: () => void
}

/** Commands of these kinds replace a waiting one of the same kind. */
const LAST_WINS: ReadonlySet<EmbedInMessage['type']> = new Set(['ds:set-mode', 'ds:open-conversation', 'ds:new-conversation', 'ds:set-context'])

/** A context within the chat's bounds: what is past them is left out (and, in development, said). */
function boundedContext(c: ChatContext | null, warn: (text: string) => void): ChatContext | null {
  if (!c) return null
  const out: ChatContext = {}
  const L = CHAT_CONTEXT_LIMITS
  const text = (key: 'itemId' | 'cardId' | 'note' | 'label', max: number) => {
    const v = c[key]
    if (typeof v !== 'string' || !v.trim()) return
    if (v.length > max) warn(`setContext(): ${key} is at most ${max} characters; it was left out.`)
    else out[key] = v
  }
  text('itemId', L.itemId)
  text('cardId', L.cardId)
  text('note', L.note)
  text('label', L.label)
  if (Array.isArray(c.filters) && c.filters.length > 0) {
    const ok = c.filters.filter((f) => f && typeof f.fieldId === 'string' && f.fieldId && typeof f.operator === 'string' && f.operator)
    if (ok.length < c.filters.length) warn('setContext(): a filter needs a fieldId and an operator; those without were left out.')
    if (ok.length > L.filters) warn(`setContext(): at most ${L.filters} filters; the rest were left out.`)
    if (ok.length > 0) out.filters = ok.slice(0, L.filters)
  }
  return out
}

const NARROW = '(max-width: 640px)'

/** Whether the window is phone-narrow (never, where there is no matchMedia: a server render, a test's DOM). */
function useNarrow(): boolean {
  const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null)
  const [narrow, setNarrow] = useState(() => query()?.matches ?? false)
  useEffect(() => {
    const mql = query()
    if (!mql) return
    const on = () => setNarrow(mql.matches)
    on()
    mql.addEventListener?.('change', on)
    return () => mql.removeEventListener?.('change', on)
  }, [])
  return narrow
}

const cssColour = (c: string | undefined, fallback: string) => (!c ? fallback : /^[0-9a-f]{3,8}$/i.test(c) ? `#${c}` : c)

function Sparkle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.6L19.5 10.5 13.9 12.4 12 18l-1.9-5.6L4.5 10.5l5.6-1.9z" />
    </svg>
  )
}

export const DataSquaresChat = forwardRef<DataSquaresChatHandle, DataSquaresChatProps>(function DataSquaresChat(props, ref) {
  const {
    baseUrl,
    getToken,
    defaultMode = 'panel',
    defaultOpen = false,
    scope,
    item,
    title,
    greeting,
    placeholder,
    suggestions,
    conversation,
    theme,
    primaryColor,
    logoUrl,
    background,
    font,
    launcherLabel = 'Ask AI',
    position = 'bottom-right',
    panelWidth = 400,
    panelHeight = 600,
    height = 600,
    zIndex = 2147483000,
    loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
    loadingFallback,
    errorFallback,
    className,
    style,
    frameTitle = 'DataSquares AI chat',
  } = props
  const warned = useRef(new Set<string>()).current
  const embedOrigin = useMemo(() => originOf(baseUrl), [baseUrl])
  if (typeof getToken !== 'function') throw new Error("DataSquaresChat: pass getToken (each person's signed token, from your server).")
  if (DEV && isInsecureRemote(baseUrl)) {
    warnOnce(warned, 'http', `baseUrl ${embedOrigin} is plain http: tokens would cross the network unencrypted. Use https outside local development.`)
  }

  // ── Mode and open: the host's when it controls them, else the component's ──
  const [ownMode, setOwnMode] = useState<ChatMode>(defaultMode)
  const [ownOpen, setOwnOpen] = useState(defaultOpen)
  const mode = props.mode ?? ownMode
  const open = props.open ?? ownOpen
  const callbacks = useRef(props)
  callbacks.current = props
  const changeMode = useCallback((next: ChatMode) => {
    setOwnMode(next)
    callbacks.current.onModeChange?.(next)
  }, [])
  const changeOpen = useCallback((next: boolean) => {
    setOwnOpen(next)
    callbacks.current.onOpenChange?.(next)
  }, [])
  // Full screen's way back: the mode it was entered from.
  const [exitTo, setExitTo] = useState<'inline' | 'panel'>(defaultMode === 'inline' ? 'inline' : 'panel')
  const goTo = useCallback(
    (next: ChatMode) => {
      if (next === mode) return
      if (next === 'fullscreen') setExitTo(mode === 'inline' ? 'inline' : 'panel')
      if (next === 'panel' && !open) changeOpen(true)
      changeMode(next)
    },
    [mode, open, changeMode, changeOpen],
  )

  // The frame loads when the chat is first shown, and stays.
  const shown = mode !== 'panel' || open
  const [mounted, setMounted] = useState(shown)
  useEffect(() => {
    if (shown) setMounted(true)
  }, [shown])

  const suggestionsKey = (suggestions ?? []).join('\u0000')
  const src = useMemo(
    () => buildChatUrl({ baseUrl, theme, primaryColor, logoUrl, background, font, scope, item, title, greeting, placeholder, suggestions, conversation }),
    // `suggestions` by its contents (suggestionsKey), not its identity.
    [baseUrl, theme, primaryColor, logoUrl, background, font, scope, item, title, greeting, placeholder, suggestionsKey, conversation],
  )

  const onMessage = (msg: EmbedOutMessage) => {
    const cb = callbacks.current
    switch (msg.type) {
      case 'ds:ready':
        if (msg.contentType === 'chat') cb.onReady?.({ items: msg.items ?? [] })
        break
      case 'ds:chat-answer':
        cb.onAnswer?.({
          question: msg.question,
          answer: msg.answer,
          conversationId: msg.conversationId,
          blocked: msg.blocked,
          followUps: msg.followUps ?? [],
          answerIndex: msg.answerIndex ?? null,
        })
        break
      case 'ds:chat-feedback':
        cb.onFeedback?.({ conversationId: msg.conversationId, answerIndex: msg.answerIndex, rating: msg.rating, reason: msg.reason, note: msg.note })
        break
      case 'ds:chat-follow-up':
        cb.onFollowUp?.({ conversationId: msg.conversationId, question: msg.question, source: msg.source })
        break
      case 'ds:conversation-change':
        cb.onConversationChange?.(msg.conversationId)
        break
      case 'ds:chat-limit':
        cb.onLimitReached?.({ code: msg.code, scope: msg.scope, message: msg.message })
        break
      case 'ds:mode-request':
        if (msg.mode === 'minimized') {
          if (modeRef.current === 'panel') changeOpen(false)
        } else goToRef.current(msg.mode)
        break
    }
  }
  const modeRef = useRef(mode)
  modeRef.current = mode
  const goToRef = useRef(goTo)
  goToRef.current = goTo

  const bridge = useFrameBridge({
    embedOrigin,
    src,
    getToken,
    loadTimeoutMs,
    lastWins: LAST_WINS,
    name: 'DataSquaresChat',
    onMessage,
    onError: props.onError ? (error) => callbacks.current.onError?.(error) : undefined,
    onStatusChange: (next) => callbacks.current.onStatusChange?.(next),
  })
  const { iframeRef, reloadKey, status, lastError, post, onFrameLoad, reload } = bridge

  // The chat draws the controls of the mode it is shown in (a new page in the frame hears it again).
  useEffect(() => {
    post({ type: 'ds:set-mode', version: EMBED_PROTOCOL_VERSION, mode, ...(mode === 'fullscreen' ? { exitTo } : {}) })
  }, [post, mode, exitTo, src, reloadKey])

  // What the person is looking at: the `context` prop by its contents, or the latest setContext(); a new page in the
  // frame hears it again.
  const warnContext = useCallback((text: string) => {
    if (DEV) warnOnce(warned, text, text)
  }, [warned])
  const contextRef = useRef<ChatContext | null | undefined>(undefined)
  const contextKey = props.context === undefined ? undefined : JSON.stringify(props.context)
  useEffect(() => {
    if (contextKey === undefined) return
    contextRef.current = boundedContext(props.context ?? null, warnContext)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the prop by its contents (contextKey)
  }, [contextKey, warnContext])
  useEffect(() => {
    if (contextRef.current !== undefined) post({ type: 'ds:set-context', version: EMBED_PROTOCOL_VERSION, context: contextRef.current })
  }, [post, contextKey, src, reloadKey])

  // Full screen: Esc (with focus on your page) goes back, and the page behind does not scroll.
  useEffect(() => {
    if (mode !== 'fullscreen') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goToRef.current(exitTo)
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [mode, exitTo])

  // Focus follows the panel: into the chat when it opens, back to the launcher when it folds.
  const launcherRef = useRef<HTMLButtonElement | null>(null)
  const wasOpen = useRef(open)
  useEffect(() => {
    if (mode !== 'panel') return
    if (open && !wasOpen.current) iframeRef.current?.focus()
    if (!open && wasOpen.current) launcherRef.current?.focus()
    wasOpen.current = open
  }, [mode, open, iframeRef])

  useImperativeHandle(
    ref,
    (): DataSquaresChatHandle => ({
      ask: (question) => {
        const q = question.trim()
        if (!q) return
        if (DEV && q.length > MAX_CHAT_QUESTION_CHARS) {
          warnOnce(warned, 'ask-long', `ask(): a question is at most ${MAX_CHAT_QUESTION_CHARS} characters; the chat ignores a longer one.`)
        }
        if (modeRef.current === 'panel') changeOpen(true)
        post({ type: 'ds:ask', version: EMBED_PROTOCOL_VERSION, question: q })
      },
      newConversation: () => post({ type: 'ds:new-conversation', version: EMBED_PROTOCOL_VERSION }),
      openConversation: (conversationId) => post({ type: 'ds:open-conversation', version: EMBED_PROTOCOL_VERSION, conversationId }),
      setMode: (next) => goToRef.current(next),
      setContext: (next) => {
        contextRef.current = boundedContext(next, warnContext)
        post({ type: 'ds:set-context', version: EMBED_PROTOCOL_VERSION, context: contextRef.current })
      },
      setOpen: (next) => changeOpen(next),
      reload,
    }),
    [post, reload, changeOpen, warned, warnContext],
  )

  const panelId = useId()
  const narrow = useNarrow()
  const side = position === 'bottom-left' ? 'left' : 'right'
  const shadow = '0 12px 40px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08)'
  let box: CSSProperties
  if (mode === 'inline') box = { position: 'relative', width: '100%', height }
  else if (mode === 'fullscreen') box = { position: 'fixed', inset: 0, zIndex }
  else if (narrow) box = { position: 'fixed', left: 0, right: 0, bottom: 0, height: '85vh', zIndex, borderRadius: '16px 16px 0 0', boxShadow: shadow, overflow: 'hidden' }
  else {
    box = {
      position: 'fixed',
      bottom: 20,
      [side]: 20,
      width: panelWidth,
      height: panelHeight,
      maxWidth: 'calc(100vw - 40px)',
      maxHeight: 'calc(100vh - 40px)',
      zIndex,
      borderRadius: 12,
      boxShadow: shadow,
      overflow: 'hidden',
    }
  }
  if (!shown) box = { ...box, display: 'none' }

  let overlay: ReactNode = null
  if (status === 'loading') overlay = loadingFallback ?? null
  else if (status === 'error' && lastError) overlay = typeof errorFallback === 'function' ? errorFallback(lastError, reload) : (errorFallback ?? null)

  const launcher = mode === 'panel' && !open && (
    <button
      ref={launcherRef}
      type="button"
      onClick={() => changeOpen(true)}
      aria-expanded={false}
      aria-controls={panelId}
      data-ds-chat-launcher=""
      style={{
        position: 'fixed',
        bottom: 20,
        [side]: 20,
        zIndex,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        minHeight: 44,
        border: 0,
        borderRadius: 999,
        background: cssColour(primaryColor, '#111827'),
        color: '#ffffff',
        font: '500 14px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        boxShadow: shadow,
        cursor: 'pointer',
      }}
    >
      <Sparkle />
      {launcherLabel}
    </button>
  )

  return (
    <>
      {launcher}
      <div
        id={panelId}
        className={className}
        style={{ ...box, ...style, ...(shown ? {} : { display: 'none' }) }}
        data-ds-chat-mode={mode}
        data-ds-embed-status={status}
        aria-busy={status === 'loading'}
        {...(mode !== 'inline' ? { role: 'dialog', 'aria-modal': mode === 'fullscreen', 'aria-label': frameTitle } : {})}
      >
        {mounted && (
          <iframe
            key={reloadKey}
            ref={iframeRef}
            src={src}
            title={frameTitle}
            onLoad={onFrameLoad}
            style={{ width: '100%', height: '100%', border: 0, display: 'block', colorScheme: 'normal' }}
            allow="clipboard-write"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
        {overlay !== null && overlay !== undefined && (
          <div style={{ position: 'absolute', inset: 0 }} data-ds-embed-overlay={status}>
            {overlay}
          </div>
        )}
      </div>
    </>
  )
})
