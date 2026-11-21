export { DataSquaresEmbed } from './DataSquaresEmbed.js'
export type { DataSquaresEmbedProps, DataSquaresEmbedHandle, EmbedError } from './DataSquaresEmbed.js'
// The URL builders live outside the client component, so a server component or route can call them.
export { buildEmbedUrl, buildSessionEmbedUrl, embedOrigin } from './urls.js'
export type { EmbedUrlOptions } from './urls.js'
export {
  EMBED_PROTOCOL_VERSION,
  MAX_EMBED_TOKEN_CHARS,
  isEmbedOutMessage,
} from './protocol.js'
export type {
  EmbedContentType,
  EmbedErrorKind,
  EmbedErrorMessage,
  EmbedFilter,
  EmbedFilterChangeMessage,
  EmbedInMessage,
  EmbedOutMessage,
  EmbedPageChangeMessage,
  EmbedPointClickMessage,
  EmbedReadyMessage,
  EmbedResizeMessage,
  EmbedState,
  EmbedStateMessage,
  EmbedTokenRequestMessage,
  GetStateCommand,
  RefreshCommand,
  SetPageCommand,
  SetParamsCommand,
  TokenCommand,
} from './protocol.js'
// The server-side signer is its own entry, `@digisquares/datasquares-embed-react/server`, so a browser bundle never
// carries a function that takes your embed app's secret.
