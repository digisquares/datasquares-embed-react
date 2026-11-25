# Changelog

## 0.5.0

### Added

- A standalone AI data analyst: the chat on its own, answering only from the
  data models the embed app names, never from its dashboards and reports.
  `standalone` on `<DataSquaresChat>` (and `buildChatUrl()`), or the
  `standalone` attribute and property on `<datasquares-chat>`, asks for it
  (`standalone=1` in the chat's address). It only narrows: without it, the
  embed app's own setting decides. An app with no data models says Ask AI
  isn't available (`onError` hears `forbidden`). README: A standalone AI data
  analyst.
- A token for the chat alone: `signEmbedToken` takes `content: { type: 'chat' }`
  (nothing beside its type) with `role: 'viewer_ai'`, and refuses an `id` or
  `items` beside it, or another role, with an `EmbedTokenInputError`. Such a
  session has no dashboard behind it and is always standalone;
  `<DataSquaresEmbed>` has nothing to show with it. `EmbedTokenContent` is the
  content's type.
- What an answer showed, as data: `onAnswer` (and `ds-answer`'s `detail`, and
  the hook's `lastAnswer`) carries `charts` and `tables` when the answer showed
  any (`ChatChart`, `ChatTable`, `ChatVisualSource`), drawn from the server's
  own rows. Only well-formed entries are kept, within `CHAT_VISUAL_LIMITS` (3
  charts and 3 tables; 50 labels a chart; 12 columns and 200 rows a table; what
  is cut short is `truncated`). Protocol: `ds:chat-answer` may carry `charts`
  and `tables`; still version 1. `/testing`: `answer({ charts, tables })`.

## 0.4.0

### Renamed

- The package is now `@digisquares/datasquares-react`. Versions up to 0.3.0
  were published as `@digisquares/datasquares-embed-react`, which is
  deprecated. Swap the name in `package.json` and in your imports; nothing
  else changes.

### Added

- `<DataSquaresChat>`: the DataSquares AI chat in a DataSquares frame, over what
  the person's token names (one dashboard or report, or the embed app's menu;
  `scope="view"` keeps a menu token's chat on one item), on the same token route
  as the embed. Three modes on one frame, switchable live: `panel` (default: a
  launcher and a floating panel, a bottom sheet on a phone), `inline`,
  `fullscreen` (Exit and Esc go back), controlled (`mode`, `open`) or not
  (`defaultMode`, `defaultOpen`). Props: `title`, `greeting`, `placeholder`,
  `suggestions`, `conversation`, the look, `position`, `launcherLabel`,
  `panelWidth`, `panelHeight`, `height`, `zIndex`, the fallbacks and the
  timeout. Events: `onReady`, `onAnswer`, `onConversationChange`,
  `onLimitReached`, `onError`, `onStatusChange`, `onModeChange`,
  `onOpenChange`. Handle: `ask`, `newConversation`, `openConversation`,
  `setMode`, `setOpen`, `reload`. `useDataSquaresChat()`, `buildChatUrl()`,
  and `simulateChat()` on `/testing`. README: The AI chat.
- Protocol: `ds:chat-answer`, `ds:conversation-change`, `ds:chat-limit`,
  `ds:mode-request` from the chat; `ds:ask`, `ds:new-conversation`,
  `ds:open-conversation`, `ds:set-mode` to it; `ds:ready`'s `contentType` may
  be `chat` (the dashboard embed ignores it).
- The chat in context: `context` (and `setContext()` on the handle and the
  hook) tells the chat what the person is looking at — the menu item, a card,
  their filters, a note, the chip's name (`ChatContext`, `CHAT_CONTEXT_LIMITS`;
  what is past the bounds is left out, with a warning in development).
  `onFeedback` hears each rating (`up`/`down`, the reason, the person's note,
  which only you get) and `onFollowUp` each follow-up or suggestion picked;
  `onAnswer` adds `followUps` and `answerIndex`. Protocol: `ds:set-context` to
  the chat; `ds:chat-feedback`, `ds:chat-follow-up` from it. `/testing`:
  `feedback()`, `followUp()`, `context`. README: What the person is looking
  at; Follow-ups and ratings.
- `<datasquares-chat>` and `<datasquares-embed>`: the chat and the embed as
  framework-free custom elements, for pages without React —
  `@digisquares/datasquares-react/element`, or one script tag from a CDN. The
  person's token from `token-url` (or a `getToken` property); attributes for
  every option, the same commands as methods, `ds-…` DOM events, `follows` (the
  chat takes a `<datasquares-embed>`'s item and filters as its context), and
  `::part()` styling. React becomes an optional peer dependency. README: Without
  React.
- Menus: a token whose content is `{ type: 'menu' }` (or `{ type: 'menu',
  items }`, 1 to 100 content ids, for some of them) opens the embed app's menu.
  The embed draws it in the app's layout or the `menu` prop's (`sidebar`,
  `tabs`, `dropdown`, `gallery`), or the host draws its own (`menu="none"`)
  from `onReady`'s `items` / the hook's `items` and `item`. `item` opens one
  first; `open(id)` switches in the same frame and session; `onItemChange`
  hears every switch. `signEmbedToken` checks a menu's items. `/testing`:
  `ready({ items, item })` and `itemChange()`. README: A menu.
- The look: `theme="auto"` (the viewer's system), `tabs`, `background`
  (including `transparent`), `font`, `padding`; each wins over the embed app's
  look (Administration → Settings → Embedding).
- `page` prop: the dashboard page to open on (`?page=` on both embed URLs).
- `loadTimeoutMs` (default 15 s, counted from the frame's load): an embed that
  never speaks — wrong `baseUrl`, a host Content-Security-Policy that blocks the
  frame, a site not on the allowed domains, a `no-referrer` policy — is now an
  `onError` with kind `timeout` and a `cause` naming those reasons, where the
  host used to hear nothing. README: Troubleshooting.
- `onStatusChange` and a status (`loading` · `ready` · `error`).
- `loadingFallback` and `errorFallback` (a node, or `(error, retry) => node`),
  laid over the frame; never over the embed's own password prompt. With
  neither, the bare iframe renders as before.
- `reload()` (a new frame, a new token) and `requestFullscreen()` on the handle.
- `useDataSquaresEmbed()`: `status`, `error`, `contentType`, `pages`,
  `pageId`, `filters` and the commands, with `bind` to spread on the component.
- `createEmbedTokenHandler` (Fetch: Next.js route handlers, Remix, Hono, Bun,
  Deno, Workers) and `createEmbedTokenMiddleware` (Node, Express) on `/server`:
  a token route from a `claims(request)` function — 200 with `no-store`, 401
  when no one is signed in, 500 without the reason when signing fails.
- `@digisquares/datasquares-react/testing`: `simulateEmbed()`, a
  stand-in embed for the host's own tests.
- Development warnings: `getToken` with `token`/`contentId`, `baseUrl` over
  plain http to another machine, a failure with no `onError`.

### Changed

- `onError`'s `kind` is `EmbedHostErrorKind` (the embed's kinds and `timeout`).
- `onReady` hears `item` and `items` besides `contentType` and `pages`, and
  `contentType` may be `menu` (the embed's gallery, no item open yet).
- A `getToken` failure during a renewal is heard by `onError` but leaves a
  showing embed `ready`.
- `logoUrl` is no longer called white-label: the Powered by DataSquares credit
  always shows.

## 0.3.0

### Fixed

- Commands sent before the embed listens (`setParams`, `setPage`, `refresh`,
  `getState` called from an effect on mount, or right after `src` changed)
  were posted to a frame that was still loading and dropped by the browser.
  They now wait until the page in the frame first speaks, and go out then; only
  the last `setParams`, `setPage` and `refresh` wait.
- `<DataSquaresEmbed>` failed in Next.js server components: the component now
  ships `'use client'`. The URL builders moved to their own module so server
  code can still call them.
- `signEmbedToken` signed input DataSquares refuses (a key or content id that is
  not a UUID, an empty or over-long `sub`, a bad attribute name, an empty list,
  `NaN`), which surfaced only as an embed that could not start. It now throws
  `EmbedTokenInputError` on your server, naming the `field`.
- A `getToken` failure was reported as a bare `invalid`, the same as the embed's
  own. `onError` now carries `cause`. A `getToken` that throws synchronously is
  caught, and an empty or over-long (> 8192) token is refused before posting.
- A token resolved after unmount was still posted to the old frame, and its
  failure reported to an unmounted host.
- The message guard ignored `version`, and did not check the pages in
  `ds:ready`, the filters in `ds:filter-change` or the state in `ds:state`.
- An inline `params` object no longer rebuilds the frame URL each render.
- Published sourcemaps pointed at `src/`, which was not in the package; `src/`
  now ships.

### Added

- `loading` prop (`eager` | `lazy`).
- `embedOrigin(baseUrl)`, and a clear error for a `baseUrl` that is not an
  absolute http(s) URL.
- Exported every protocol message type, `MAX_EMBED_TOKEN_CHARS`, `EmbedError`,
  `EmbedUrlOptions`, and (from `/server`) `EmbedTokenInputError`.
- A `default` export condition (so `require()` works on Node 22+), and
  `./package.json` in `exports`.
- `typecheck` and `prepublishOnly` scripts; `engines.node >= 20`.

## 0.2.1

- An embedded presentation is ready as a presentation (`contentType:
  'presentation'`).

## 0.2.0

- Two keys: `getToken` on the component and `signEmbedToken` on the server.
  `createEmbedToken` was removed.

## 0.1.0

- `<DataSquaresEmbed>`, typed events, host-side controls.
