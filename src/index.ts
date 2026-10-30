export { DataSquaresEmbed, buildEmbedUrl, buildSessionEmbedUrl } from './DataSquaresEmbed.js'
export type { DataSquaresEmbedProps, DataSquaresEmbedHandle } from './DataSquaresEmbed.js'
export {
  EMBED_PROTOCOL_VERSION,
  isEmbedOutMessage,
} from './protocol.js'
export type {
  EmbedContentType,
  EmbedErrorKind,
  EmbedFilter,
  EmbedInMessage,
  EmbedOutMessage,
  EmbedState,
  EmbedTokenRequestMessage,
  TokenCommand,
} from './protocol.js'
// The server-side signer is its own entry, `@digisquares/datasquares-embed-react/server`, so a browser bundle never
// carries a function that takes your embed app's secret.
