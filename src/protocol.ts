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
  /** `menu` while the embed's gallery shows the person's menu and no item is open yet. */
  contentType: EmbedContentType | 'menu'
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

export type EmbedOutMessage =
  | EmbedReadyMessage
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

export type EmbedInMessage = SetParamsCommand | SetPageCommand | RefreshCommand | GetStateCommand | TokenCommand | OpenCommand

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
])

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
        (CONTENT_TYPES.has(msg.contentType) || msg.contentType === 'menu') &&
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
    default:
      return false
  }
}
