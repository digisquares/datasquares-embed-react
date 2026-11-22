# Changelog

## 0.4.0

### Renamed

- The package is now `@digisquares/datasquares-react`. Versions up to 0.3.0
  were published as `@digisquares/datasquares-embed-react`, which is
  deprecated. Swap the name in `package.json` and in your imports; nothing
  else changes.

### Added

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
