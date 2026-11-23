/**
 * `@digisquares/datasquares-react/testing` — a stand-in for the DataSquares embed, for your own tests of a page
 * that hosts `<DataSquaresEmbed>` (Vitest or Jest, in jsdom or happy-dom). It takes the place of the iframe's window,
 * records every command your page sends, and speaks as the embed — from the right window, at the right origin — so
 * your callbacks run as they would against DataSquares, with no network:
 *
 *   render(<Analytics />)
 *   const embed = simulateEmbed(screen.getByTitle('DataSquares dashboard'))
 *   embed.ready({ pages: [{ id: 'p1', name: 'Overview' }] })
 *   expect(screen.getByText('Overview')).toBeInTheDocument()
 *   await user.click(screen.getByText('East'))
 *   expect(embed.commands).toContainEqual({ type: 'ds:set-params', version: 1, params: { region: 'east' } })
 *
 * Never import it in application code: it replaces the frame's window.
 */
import * as React from 'react'
import {
  EMBED_PROTOCOL_VERSION,
  type ChatContext,
  type ChatFeedbackReason,
  type EmbedContentType,
  type EmbedErrorKind,
  type EmbedFilter,
  type EmbedInMessage,
  type EmbedMenuItem,
  type EmbedOutMessage,
  type EmbedState,
} from './protocol.js'

export interface SimulateEmbedOptions {
  /**
   * Wraps each message the embed sends, so React's state updates settle in it. Default: React's own `act` (React 18.3
   * and later); on older React, pass Testing Library's `act`.
   */
  act?: (run: () => void) => void
  /** Answer each `getState()` with this state (default: `{ pageId: null, params: {} }`; set later with `setState`). */
  state?: EmbedState
}

export interface EmbedSimulator {
  /** Every command the component sent to the embed, oldest first (`ds:token` answers included). */
  readonly commands: EmbedInMessage[]
  /** The tokens the component answered token requests with, oldest first. */
  readonly tokens: string[]
  /**
   * The embed rendered (default: a dashboard with no pages). A menu token's embed: pass `items` (the person's menu) and
   * `item` (the one shown; null with `contentType: 'menu'` for a gallery with none open).
   */
  ready(info?: {
    contentType?: EmbedContentType | 'menu'
    pages?: Array<{ id: string; name: string }>
    item?: EmbedMenuItem | null
    items?: EmbedMenuItem[]
  }): void
  /** A menu token's embed shows another item (its own menu, or your page's `open`). */
  itemChange(item: EmbedMenuItem): void
  /** The embed's content is this tall. */
  resize(height: number): void
  /** The embed could not render. */
  error(kind: EmbedErrorKind): void
  pageChange(pageId: string): void
  pointClick(cardId: string, value: string): void
  filterChange(filters: EmbedFilter[]): void
  /** The embed asks for a signed token; resolves with the one the component answered (rejects after `timeoutMs`). */
  requestToken(reason?: 'start' | 'renew', timeoutMs?: number): Promise<string>
  /** What later `getState()` calls are answered with. */
  setState(state: EmbedState): void
  /** Send any message as the embed (for shapes the helpers do not cover). */
  send(message: EmbedOutMessage | Record<string, unknown>): void
}

function findFrame(target: HTMLIFrameElement | ParentNode): HTMLIFrameElement {
  if (typeof HTMLIFrameElement !== 'undefined' && target instanceof HTMLIFrameElement) return target
  const found = (target as ParentNode).querySelector?.('iframe')
  if (!found) throw new Error('simulateEmbed: no iframe found — pass the <DataSquaresEmbed> iframe or a container holding it.')
  return found
}

/**
 * React's own `act` (React 18.3 and 19 export it), with the act environment switched on for the call and back after —
 * as Testing Library does — so updates settle before the next line of the test, without a warning. React before 18.3
 * has no `act` of its own: pass Testing Library's as `options.act`.
 */
function defaultAct(): (run: () => void) => void {
  const reactAct = (React as unknown as { act?: (run: () => void) => void }).act
  if (typeof reactAct !== 'function') return (run) => run()
  return (run) => {
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previous = env.IS_REACT_ACT_ENVIRONMENT
    env.IS_REACT_ACT_ENVIRONMENT = true
    try {
      reactAct(run)
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = previous
    }
  }
}

/**
 * Stand in for the embed inside `target` (the iframe, or a container holding it). The component reads the frame's
 * window when a message arrives, so call this after render; after `reload()` (a new iframe), call it again.
 */
export function simulateEmbed(target: HTMLIFrameElement | ParentNode, options: SimulateEmbedOptions = {}): EmbedSimulator {
  const frame = findFrame(target)
  const origin = new URL(frame.src).origin
  const act = options.act ?? defaultAct()
  const commands: EmbedInMessage[] = []
  const tokens: string[] = []
  const tokenWaiters: Array<(token: string) => void> = []
  let state: EmbedState = options.state ?? { pageId: null, params: {} }

  const send = (message: EmbedOutMessage | Record<string, unknown>) => {
    const event = new MessageEvent('message', { data: message, origin })
    // The constructor takes only real windows as `source`; the component compares it with the frame's window.
    Object.defineProperty(event, 'source', { value: fakeWindow })
    act(() => {
      window.dispatchEvent(event)
    })
  }

  const fakeWindow = {
    postMessage(message: EmbedInMessage, targetOrigin: string) {
      // A command posted to any other origin would never reach the embed: the browser drops it.
      if (targetOrigin !== origin) return
      commands.push(message)
      if (message.type === 'ds:token') {
        tokens.push(message.token)
        tokenWaiters.shift()?.(message.token)
      } else if (message.type === 'ds:get-state') {
        const requestId = message.requestId
        queueMicrotask(() => send({ type: 'ds:state', version: EMBED_PROTOCOL_VERSION, requestId, state }))
      }
    },
  }
  Object.defineProperty(frame, 'contentWindow', { value: fakeWindow, configurable: true })

  return {
    commands,
    tokens,
    ready: (info = {}) =>
      send({
        type: 'ds:ready',
        version: EMBED_PROTOCOL_VERSION,
        contentType: info.contentType ?? 'dashboard',
        pages: info.pages ?? [],
        item: info.item ?? null,
        items: info.items ?? [],
      }),
    itemChange: (item) => send({ type: 'ds:item-change', version: EMBED_PROTOCOL_VERSION, item }),
    resize: (height) => send({ type: 'ds:resize', version: EMBED_PROTOCOL_VERSION, height }),
    error: (kind) => send({ type: 'ds:error', version: EMBED_PROTOCOL_VERSION, kind }),
    pageChange: (pageId) => send({ type: 'ds:page-change', version: EMBED_PROTOCOL_VERSION, pageId }),
    pointClick: (cardId, value) => send({ type: 'ds:point-click', version: EMBED_PROTOCOL_VERSION, cardId, value }),
    filterChange: (filters) => send({ type: 'ds:filter-change', version: EMBED_PROTOCOL_VERSION, filters }),
    requestToken: (reason = 'start', timeoutMs = 2000) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('simulateEmbed: the component did not answer the token request (is getToken set?).')), timeoutMs)
        tokenWaiters.push((token) => {
          clearTimeout(timer)
          resolve(token)
        })
        send({ type: 'ds:token-request', version: EMBED_PROTOCOL_VERSION, reason })
      }),
    setState: (next) => {
      state = next
    },
    send,
  }
}

export interface ChatSimulator {
  /** Every command the component sent to the chat, oldest first (`ds:token` answers included). */
  readonly commands: EmbedInMessage[]
  /** The tokens the component answered token requests with, oldest first. */
  readonly tokens: string[]
  /** The chat is ready to answer; with a menu token, pass the menu it asks about. */
  ready(info?: { items?: EmbedMenuItem[] }): void
  /** An answer is finished (with the follow-ups it offers, and its number in the conversation). */
  answer(answer: { question: string; answer: string; conversationId?: string | null; blocked?: boolean; followUps?: string[]; answerIndex?: number | null }): void
  /** The person rated an answer. */
  feedback(feedback: { conversationId: string; answerIndex?: number; rating: 'up' | 'down'; reason?: ChatFeedbackReason | null; note?: string | null }): void
  /** The person picked a follow-up under an answer, or a suggestion. */
  followUp(pick: { question: string; conversationId?: string | null; source?: 'follow-up' | 'suggestion' }): void
  /** The latest context the component told the chat (`ds:set-context`), undefined when none. */
  readonly context: ChatContext | null | undefined
  /** The chat shows another conversation. */
  conversationChange(conversationId: string | null): void
  /** A budget or an hourly limit stopped a question. */
  limit(limit: { code: 'EMBED_AI_BUDGET_REACHED' | 'EMBED_AI_RATE_LIMITED'; scope?: 'person' | 'tenant' | null; message: string }): void
  /** The person asked, in the chat's own controls, to show it another way. */
  requestMode(mode: 'inline' | 'panel' | 'fullscreen' | 'minimized'): void
  /** The chat could not start. */
  error(kind: EmbedErrorKind): void
  /** The chat asks for a signed token; resolves with the one the component answered. */
  requestToken(reason?: 'start' | 'renew', timeoutMs?: number): Promise<string>
  /** Send any message as the chat. */
  send(message: EmbedOutMessage | Record<string, unknown>): void
}

/**
 * Stand in for the AI chat inside `target` (the `<DataSquaresChat>` iframe, or a container holding it). In `panel` mode
 * the frame mounts when the panel first opens: open it, then call this.
 */
export function simulateChat(target: HTMLIFrameElement | ParentNode, options: Omit<SimulateEmbedOptions, 'state'> = {}): ChatSimulator {
  const embed = simulateEmbed(target, options)
  const v = EMBED_PROTOCOL_VERSION
  return {
    commands: embed.commands,
    tokens: embed.tokens,
    ready: (info = {}) => embed.send({ type: 'ds:ready', version: v, contentType: 'chat', pages: [], item: null, items: info.items ?? [] }),
    answer: (a) =>
      embed.send({
        type: 'ds:chat-answer',
        version: v,
        question: a.question,
        answer: a.answer,
        conversationId: a.conversationId ?? null,
        blocked: a.blocked ?? false,
        followUps: a.followUps ?? [],
        answerIndex: a.answerIndex ?? null,
      }),
    feedback: (f) =>
      embed.send({ type: 'ds:chat-feedback', version: v, conversationId: f.conversationId, answerIndex: f.answerIndex ?? 0, rating: f.rating, reason: f.reason ?? null, note: f.note ?? null }),
    followUp: (p) => embed.send({ type: 'ds:chat-follow-up', version: v, conversationId: p.conversationId ?? null, question: p.question, source: p.source ?? 'follow-up' }),
    get context() {
      const last = [...embed.commands].reverse().find((c) => c.type === 'ds:set-context')
      return last && last.type === 'ds:set-context' ? last.context : undefined
    },
    conversationChange: (conversationId) => embed.send({ type: 'ds:conversation-change', version: v, conversationId }),
    limit: (l) => embed.send({ type: 'ds:chat-limit', version: v, code: l.code, scope: l.scope ?? null, message: l.message }),
    requestMode: (mode) => embed.send({ type: 'ds:mode-request', version: v, mode }),
    error: embed.error,
    requestToken: embed.requestToken,
    send: embed.send,
  }
}
