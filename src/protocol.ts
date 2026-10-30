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

// ── Embed → host (events the SDK surfaces as callbacks) ─────────────────

export interface EmbedReadyMessage {
  type: 'ds:ready'
  version: typeof EMBED_PROTOCOL_VERSION
  contentType: EmbedContentType
  /** A dashboard's pages; none for a report, a one-page dashboard or a presentation. */
  pages: Array<{ id: string; name: string }>
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

export type EmbedInMessage = SetParamsCommand | SetPageCommand | RefreshCommand | GetStateCommand | TokenCommand

const OUT_TYPES = new Set([
  'ds:ready',
  'ds:resize',
  'ds:error',
  'ds:page-change',
  'ds:point-click',
  'ds:filter-change',
  'ds:state',
  'ds:token-request',
])

/**
 * Structural guard over untrusted postMessage data. The host validates source
 * and origin before this runs, but the shape still gets checked field-by-field:
 * any script inside a compromised embed page could post arbitrary data from
 * the right window at the right origin.
 */
export function isEmbedOutMessage(data: unknown): data is EmbedOutMessage {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as Record<string, unknown>
  if (typeof msg.type !== 'string' || !OUT_TYPES.has(msg.type)) return false
  switch (msg.type) {
    case 'ds:resize':
      return typeof msg.height === 'number' && Number.isFinite(msg.height) && msg.height >= 0
    case 'ds:ready':
      return CONTENT_TYPES.has(msg.contentType) && Array.isArray(msg.pages)
    case 'ds:error':
      return typeof msg.kind === 'string'
    case 'ds:page-change':
      return typeof msg.pageId === 'string'
    case 'ds:point-click':
      return typeof msg.cardId === 'string' && typeof msg.value === 'string'
    case 'ds:filter-change':
      return Array.isArray(msg.filters)
    case 'ds:state':
      return typeof msg.state === 'object' && msg.state !== null
    case 'ds:token-request':
      return msg.reason === 'start' || msg.reason === 'renew'
    default:
      return false
  }
}
