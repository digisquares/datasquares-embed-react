export { DataSquaresEmbed } from './DataSquaresEmbed.js'
export type { DataSquaresEmbedProps, DataSquaresEmbedHandle, EmbedError, EmbedHostErrorKind, EmbedReadyInfo, EmbedStatus } from './DataSquaresEmbed.js'
export { useDataSquaresEmbed } from './use-embed.js'
export type { UseDataSquaresEmbed, DataSquaresEmbedBinding } from './use-embed.js'
export { DataSquaresChat } from './DataSquaresChat.js'
export type { DataSquaresChatProps, DataSquaresChatHandle, ChatAnswer, ChatFeedback, ChatSaved, ChatFollowUp, ChatLimit, ChatReadyInfo } from './DataSquaresChat.js'
export { useDataSquaresChat } from './use-chat.js'
export type { UseDataSquaresChat, UseDataSquaresChatOptions, DataSquaresChatBinding } from './use-chat.js'
// The URL builders live outside the client component, so a server component or route can call them.
export { buildChatUrl, buildEmbedUrl, buildSessionEmbedUrl, embedOrigin } from './urls.js'
export type { ChatUrlOptions, EmbedFont, EmbedMenuLayout, EmbedUrlOptions } from './urls.js'
export {
  CHAT_CONTEXT_LIMITS,
  CHAT_VISUAL_LIMITS,
  EMBED_PROTOCOL_VERSION,
  MAX_CHAT_QUESTION_CHARS,
  MAX_EMBED_TOKEN_CHARS,
  isEmbedOutMessage,
} from './protocol.js'
export type {
  AskCommand,
  ChatChart,
  ChatContext,
  ChatTable,
  ChatVisualSource,
  ChatFeedbackReason,
  ChatMode,
  EmbedChatAnswerMessage,
  EmbedChatFeedbackMessage,
  EmbedChatSavedMessage,
  EmbedChatFollowUpMessage,
  SetContextCommand,
  EmbedChatLimitMessage,
  EmbedConversationChangeMessage,
  EmbedModeRequestMessage,
  NewConversationCommand,
  OpenConversationCommand,
  SetModeCommand,
  EmbedContentType,
  EmbedErrorKind,
  EmbedErrorMessage,
  EmbedFilter,
  EmbedFilterChangeMessage,
  EmbedInMessage,
  EmbedItemChangeMessage,
  EmbedMenuItem,
  EmbedOutMessage,
  EmbedPageChangeMessage,
  EmbedPointClickMessage,
  EmbedReadyMessage,
  EmbedResizeMessage,
  EmbedState,
  EmbedStateMessage,
  EmbedTokenRequestMessage,
  GetStateCommand,
  OpenCommand,
  RefreshCommand,
  SetPageCommand,
  SetParamsCommand,
  TokenCommand,
} from './protocol.js'
// The test stand-in for the embed is its own entry too, `@digisquares/datasquares-react/testing`.
// The server-side signer is its own entry, `@digisquares/datasquares-react/server`, so a browser bundle never
// carries a function that takes your embed app's secret.
