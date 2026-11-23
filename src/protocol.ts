/**
 * The ds:* postMessage protocol between a DataSquares embed iframe and the
 * page hosting it — HOST-SIDE mirror.
 *
 * ⚠ KEEP IN SYNC with `datasquares-ui/src/lib/embed-messages.ts`, the embed
 * side. The SDK must be self-contained for external consumers, so the types
 * are duplicated rather than imported; the protocol is deliberately small and
 * versioned to make that survivable. Additive changes only — a breaking change
 * bumps EMBED_PROTOCOL_VERSION on both sides.
 */

export const EMBED_PROTOCOL_VERSION = 1 as const

/** A filter as the embed reports it (chart clicks, slicers). */
export interface EmbedFilter {
  fieldId: string
  operator: string
  value?: unknown
  values?: unknown[]
  [key: string]: unknown
}

/** What an embed shows: a dashboard, a report, or a presentation (in present mode). */
export type EmbedContentType = 'dashboard' | 'report' | 'presentation'

const CONTENT_TYPES: ReadonlySet<unknown> = new Set<EmbedContentType>(['dashboard', 'report', 'presentation'])

/**
 * An item of a person's menu (a token whose content is `{ type: 'menu' }`): its label in the embed app, else the
 * content's own name, and the section heading it sits under.
 */
export interface EmbedMenuItem {
  id: string
  type: EmbedContentType
  name: string
  section: string | null
}

// ── Embed → host (events the SDK surfaces as callbacks) ─────────────────

export interface EmbedReadyMessage {
  type: 'ds:ready'
  version: typeof EMBED_PROTOCOL_VERSION
  /**
   * `menu` while the embed's gallery shows the person's menu and no item is open yet; `chat` for the AI chat embedded on
   * its own (<DataSquaresChat>), whose `items` are the menu it asks about (none when it asks about one view).
   */
  contentType: EmbedContentType | 'menu' | 'chat'
  /** A dashboard's pages; none for a report, a one-page dashboard or a presentation. */
  pages: Array<{ id: string; name: string }>
  /**
   * The item shown, of a menu; null for an embed of one item (or a gallery with none open). Absent from an embed that
   * predates menus, which the SDK reads as null.
   */
  item?: EmbedMenuItem | null
  /** The person's menu, in order; empty for an embed of one item. Absent from an embed that predates menus (none). */
  items?: EmbedMenuItem[]
}

/** Another item of the menu is shown: picked in the embed's own menu, or opened by the host. */
export interface EmbedItemChangeMessage {
  type: 'ds:item-change'
  version: typeof EMBED_PROTOCOL_VERSION
  item: EmbedMenuItem
}

export interface EmbedResizeMessage {
  type: 'ds:resize'
  version: typeof EMBED_PROTOCOL_VERSION
  height: number
}

/** `expired`: an embedded person's session ended and the host gave no new signed token (two keys, below). */
export type EmbedErrorKind = 'invalid' | 'forbidden' | 'network' | 'password-required' | 'expired'

export interface EmbedErrorMessage {
  type: 'ds:error'
  version: typeof EMBED_PROTOCOL_VERSION
  kind: EmbedErrorKind
}

export interface EmbedPageChangeMessage {
  type: 'ds:page-change'
  version: typeof EMBED_PROTOCOL_VERSION
  pageId: string
}

export interface EmbedPointClickMessage {
  type: 'ds:point-click'
  version: typeof EMBED_PROTOCOL_VERSION
  cardId: string
  value: string
}

export interface EmbedFilterChangeMessage {
  type: 'ds:filter-change'
  version: typeof EMBED_PROTOCOL_VERSION
  filters: EmbedFilter[]
}

export interface EmbedState {
  pageId: string | null
  params: Record<string, unknown>
}

export interface EmbedStateMessage {
  type: 'ds:state'
  version: typeof EMBED_PROTOCOL_VERSION
  requestId?: string
  state: EmbedState
}

/**
 * Two keys (DataSquares AI plan chapter 12): the embed asks its host for the person's signed token — when it starts,
 * and again when its session is about to end — and the host answers with a `ds:token` command. The token never rides
 * in a URL.
 */
export interface EmbedTokenRequestMessage {
  type: 'ds:token-request'
  version: typeof EMBED_PROTOCOL_VERSION
  reason: 'start' | 'renew'
}

/**
 * The chat's answer is finished, as kept (`blocked`: it was withheld), with the follow-up questions it offers and its
 * number in the conversation (null when it was not kept), as a rating names it.
 */
export interface EmbedChatAnswerMessage {
  type: 'ds:chat-answer'
  version: typeof EMBED_PROTOCOL_VERSION
  conversationId: string | null
  question: string
  answer: string
  blocked: boolean
  followUps?: string[]
  answerIndex?: number | null
}

/** Why the person said an answer was not helpful. */
export type ChatFeedbackReason = 'wrong_number' | 'wrong_scope' | 'wrong_data' | 'incomplete' | 'not_what_i_asked' | 'too_long' | 'other'

/** The person rated an answer: helpful (`up`) or not (`down`, and why). `note` is what they typed, for you only. */
export interface EmbedChatFeedbackMessage {
  type: 'ds:chat-feedback'
  version: typeof EMBED_PROTOCOL_VERSION
  conversationId: string
  answerIndex: number
  rating: 'up' | 'down'
  reason: ChatFeedbackReason | null
  note: string | null
}

/** The person picked a question instead of typing it: a follow-up under an answer, or one of the suggestions. */
export interface EmbedChatFollowUpMessage {
  type: 'ds:chat-follow-up'
  version: typeof EMBED_PROTOCOL_VERSION
  conversationId: string | null
  question: string
  source: 'follow-up' | 'suggestion'
}

/** The chat shows another conversation (a new one: null until its first answer). */
export interface EmbedConversationChangeMessage {
  type: 'ds:conversation-change'
  version: typeof EMBED_PROTOCOL_VERSION
  conversationId: string | null
}

/** One of the embed app's monthly budgets or hourly limits stopped a question: the person's, or their organization's. */
export interface EmbedChatLimitMessage {
  type: 'ds:chat-limit'
  version: typeof EMBED_PROTOCOL_VERSION
  code: 'EMBED_AI_BUDGET_REACHED' | 'EMBED_AI_RATE_LIMITED'
  scope: 'person' | 'tenant' | null
  message: string
}

/** How the chat is shown: filling a box of your page, as a floating panel, or over the whole window. */
export type ChatMode = 'inline' | 'panel' | 'fullscreen'

/** The person asked, in the chat's own controls, to show it another way (`minimized`: fold a panel to its launcher). */
export interface EmbedModeRequestMessage {
  type: 'ds:mode-request'
  version: typeof EMBED_PROTOCOL_VERSION
  mode: ChatMode | 'minimized'
}

export type EmbedOutMessage =
  | EmbedChatFeedbackMessage
  | EmbedChatFollowUpMessage
  | EmbedReadyMessage
  | EmbedChatAnswerMessage
  | EmbedConversationChangeMessage
  | EmbedChatLimitMessage
  | EmbedModeRequestMessage
  | EmbedItemChangeMessage
  | EmbedResizeMessage
  | EmbedErrorMessage
  | EmbedPageChangeMessage
  | EmbedPointClickMessage
  | EmbedFilterChangeMessage
  | EmbedStateMessage
  | EmbedTokenRequestMessage

// ── Host → embed (commands the SDK sends) ───────────────────────────────

export interface SetParamsCommand {
  type: 'ds:set-params'
  version: typeof EMBED_PROTOCOL_VERSION
  params: Record<string, unknown>
}

export interface SetPageCommand {
  type: 'ds:set-page'
  version: typeof EMBED_PROTOCOL_VERSION
  pageId: string
}

export interface RefreshCommand {
  type: 'ds:refresh'
  version: typeof EMBED_PROTOCOL_VERSION
}

export interface GetStateCommand {
  type: 'ds:get-state'
  version: typeof EMBED_PROTOCOL_VERSION
  requestId?: string
}

/** The host's answer to a token request: a short-lived token its server signed for this person. */
export interface TokenCommand {
  type: 'ds:token'
  version: typeof EMBED_PROTOCOL_VERSION
  token: string
}

/** Open another item of the person's menu (an id not in it is ignored by the embed). */
export interface OpenCommand {
  type: 'ds:open'
  version: typeof EMBED_PROTOCOL_VERSION
  itemId: string
}

/** Ask the chat a question, as if the person had typed it (1 to 2,000 characters). */
export interface AskCommand {
  type: 'ds:ask'
  version: typeof EMBED_PROTOCOL_VERSION
  question: string
}

/** Start a new conversation in the chat. */
export interface NewConversationCommand {
  type: 'ds:new-conversation'
  version: typeof EMBED_PROTOCOL_VERSION
}

/** Open one of the person's earlier conversations (one not theirs, or ended, is ignored). */
export interface OpenConversationCommand {
  type: 'ds:open-conversation'
  version: typeof EMBED_PROTOCOL_VERSION
  conversationId: string
}

/** How the host shows the chat now, so it draws the controls that go with it; `exitTo` is full screen's way back. */
export interface SetModeCommand {
  type: 'ds:set-mode'
  version: typeof EMBED_PROTOCOL_VERSION
  mode: ChatMode
  exitTo?: 'inline' | 'panel'
}

/**
 * What the person is looking at in your page, for the chat: each question carries it until the next. A hint, never
 * access: an item outside the person's menu is ignored, and the filters only narrow what the item's cards show.
 */
export interface ChatContext {
  /** The menu item the person is on: its id, as `onReady`'s items and `<DataSquaresEmbed onItemChange>` give it. */
  itemId?: string
  /** A card (or report block) on it, in focus. */
  cardId?: string
  /** The filters the person has on it, as `<DataSquaresEmbed onFilterChange>` gives them (20 at most). */
  filters?: EmbedFilter[]
  /** A short line about what the person is doing (300 characters at most). */
  note?: string
  /** The chat's name for it, on the chip above the question field (80 at most; default the menu item's name). */
  label?: string
}

/** Tell the chat what the person is looking at (null: nothing). */
export interface SetContextCommand {
  type: 'ds:set-context'
  version: typeof EMBED_PROTOCOL_VERSION
  context: ChatContext | null
}

export type EmbedInMessage =
  | SetContextCommand
  | SetParamsCommand
  | SetPageCommand
  | RefreshCommand
  | GetStateCommand
  | TokenCommand
  | OpenCommand
  | AskCommand
  | NewConversationCommand
  | OpenConversationCommand
  | SetModeCommand

/** The longest question the chat takes. */
export const MAX_CHAT_QUESTION_CHARS = 2000

/** The longest token the embed accepts in a `ds:token` (it drops a longer or an empty one). */
export const MAX_EMBED_TOKEN_CHARS = 8192

const OUT_TYPES = new Set([
  'ds:ready',
  'ds:item-change',
  'ds:resize',
  'ds:error',
  'ds:page-change',
  'ds:point-click',
  'ds:filter-change',
  'ds:state',
  'ds:token-request',
  'ds:chat-answer',
  'ds:conversation-change',
  'ds:chat-limit',
  'ds:mode-request',
  'ds:chat-feedback',
  'ds:chat-follow-up',
])

/** The bounds the chat holds a context to (it ignores one past them). */
export const CHAT_CONTEXT_LIMITS = { itemId: 64, cardId: 255, note: 300, label: 80, filters: 20 } as const

const FEEDBACK_REASONS: ReadonlySet<unknown> = new Set(['wrong_number', 'wrong_scope', 'wrong_data', 'incomplete', 'not_what_i_asked', 'too_long', 'other'])

const MODE_REQUESTS: ReadonlySet<unknown> = new Set(['inline', 'panel', 'fullscreen', 'minimized'])

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isPage = (p: unknown): boolean => isRecord(p) && typeof p.id === 'string' && typeof p.name === 'string'

const isMenuItem = (i: unknown): i is EmbedMenuItem =>
  isRecord(i) &&
  typeof i.id === 'string' &&
  CONTENT_TYPES.has(i.type) &&
  typeof i.name === 'string' &&
  (i.section === null || typeof i.section === 'string')

/**
 * Structural guard over untrusted postMessage data. The host validates source
 * and origin before this runs, but the shape still gets checked field-by-field:
 * any script inside a compromised embed page could post arbitrary data from
 * the right window at the right origin.
 *
 * A message of another protocol version is refused: a breaking change bumps
 * EMBED_PROTOCOL_VERSION, and an SDK that does not know the new shapes must
 * not read them as the old ones. An error `kind` is any text, though — a kind
 * added later still reaches `onError` rather than vanishing.
 */
export function isEmbedOutMessage(data: unknown): data is EmbedOutMessage {
  if (!isRecord(data)) return false
  const msg = data
  if (msg.version !== EMBED_PROTOCOL_VERSION) return false
  if (typeof msg.type !== 'string' || !OUT_TYPES.has(msg.type)) return false
  switch (msg.type) {
    case 'ds:resize':
      return typeof msg.height === 'number' && Number.isFinite(msg.height) && msg.height >= 0
    case 'ds:ready':
      return (
        (CONTENT_TYPES.has(msg.contentType) || msg.contentType === 'menu' || msg.contentType === 'chat') &&
        Array.isArray(msg.pages) &&
        msg.pages.every(isPage) &&
        (msg.item === undefined || msg.item === null || isMenuItem(msg.item)) &&
        (msg.items === undefined || (Array.isArray(msg.items) && msg.items.every(isMenuItem)))
      )
    case 'ds:item-change':
      return isMenuItem(msg.item)
    case 'ds:error':
      return typeof msg.kind === 'string'
    case 'ds:page-change':
      return typeof msg.pageId === 'string'
    case 'ds:point-click':
      return typeof msg.cardId === 'string' && typeof msg.value === 'string'
    case 'ds:filter-change':
      return Array.isArray(msg.filters) && msg.filters.every(isRecord)
    case 'ds:state':
      return (
        (msg.requestId === undefined || typeof msg.requestId === 'string') &&
        isRecord(msg.state) &&
        (msg.state.pageId === null || typeof msg.state.pageId === 'string') &&
        isRecord(msg.state.params)
      )
    case 'ds:token-request':
      return msg.reason === 'start' || msg.reason === 'renew'
    case 'ds:chat-answer':
      return (
        (msg.conversationId === null || typeof msg.conversationId === 'string') &&
        typeof msg.question === 'string' &&
        typeof msg.answer === 'string' &&
        typeof msg.blocked === 'boolean' &&
        (msg.followUps === undefined || (Array.isArray(msg.followUps) && msg.followUps.every((f) => typeof f === 'string'))) &&
        (msg.answerIndex === undefined || msg.answerIndex === null || (Number.isInteger(msg.answerIndex) && (msg.answerIndex as number) >= 0))
      )
    case 'ds:chat-feedback':
      return (
        typeof msg.conversationId === 'string' &&
        Number.isInteger(msg.answerIndex) &&
        (msg.answerIndex as number) >= 0 &&
        (msg.rating === 'up' || msg.rating === 'down') &&
        (msg.reason === null || FEEDBACK_REASONS.has(msg.reason)) &&
        (msg.note === null || typeof msg.note === 'string')
      )
    case 'ds:chat-follow-up':
      return (
        (msg.conversationId === null || typeof msg.conversationId === 'string') &&
        typeof msg.question === 'string' &&
        (msg.source === 'follow-up' || msg.source === 'suggestion')
      )
    case 'ds:conversation-change':
      return msg.conversationId === null || typeof msg.conversationId === 'string'
    case 'ds:chat-limit':
      return typeof msg.code === 'string' && (msg.scope === null || msg.scope === 'person' || msg.scope === 'tenant') && typeof msg.message === 'string'
    case 'ds:mode-request':
      return MODE_REQUESTS.has(msg.mode)
    default:
      return false
  }
}
