# Changelog

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
