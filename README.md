# @digisquares/datasquares-react

React SDK for embedding DataSquares dashboards, reports and presentations: the
`<DataSquaresEmbed>` component and the `useDataSquaresEmbed()` hook, typed
events, host-side controls, loading and error display, a token route for your
server in three lines, and a stand-in embed for your tests.

## Install

```sh
npm install @digisquares/datasquares-react
```

Or straight from the repository (builds on install via the `prepare` script):

```sh
npm install github:digisquares/datasquares-embed-react
```

React 18 or 19. The package is ESM; `signEmbedToken` runs on Node 20+, Deno,
Bun and edge runtimes (Web Crypto, no dependencies).

## Two keys: each person, on your site

To show dashboards inside your own product, to your own people, make an embed
app in DataSquares (**Administration → Settings → Embedding**). It has a
client id and a key (a key id and a secret, shown once): the company key. For
each person, **your server** signs a short-lived token with that key: the
person's id. The browser only ever carries that token, and the embed swaps it
for a session bound to your site.

```ts
// On YOUR server: an Express route your page calls
import { createEmbedTokenMiddleware } from '@digisquares/datasquares-react/server'

app.get('/analytics-token', requireSignedIn, createEmbedTokenMiddleware({
  clientId: process.env.DS_EMBED_CLIENT_ID!,
  keyId: process.env.DS_EMBED_KEY_ID!,
  secret: process.env.DS_EMBED_SECRET!,            // never sent to a browser
  claims: (req) => req.user && {
    sub: req.user.id,                              // stable, opaque: no email needed
    tenant: req.user.accountId,                    // their customer account
    role: req.user.canAskAi ? 'viewer_ai' : 'viewer',
    attributes: { account: req.user.accountId },   // one per row rule of the app
    content: { type: 'dashboard', id: 'your-dashboard-id' },
  },
}))
```

```ts
// Or a Next.js route handler (also Remix, Hono, Bun, Deno, Workers): app/analytics-token/route.ts
import { createEmbedTokenHandler } from '@digisquares/datasquares-react/server'

export const GET = createEmbedTokenHandler({
  clientId: process.env.DS_EMBED_CLIENT_ID!,
  keyId: process.env.DS_EMBED_KEY_ID!,
  secret: process.env.DS_EMBED_SECRET!,
  claims: async () => {
    const user = await currentUser()               // your own session
    return user && { sub: user.id, tenant: user.accountId, content: { type: 'dashboard', id: 'your-dashboard-id' } }
  },
})
```

Both answer `200` with the token (`Cache-Control: no-store`), `401` when
`claims` returns nothing (no one signed in), and `500` — without the reason —
when signing fails; `onError` (default `console.error`) hears why. To sign by
hand, `signEmbedToken({ clientId, keyId, secret, ...claims })` returns the token.

```tsx
import { useRef } from 'react'
import { DataSquaresEmbed, type DataSquaresEmbedHandle } from '@digisquares/datasquares-react'

function Analytics() {
  const embed = useRef<DataSquaresEmbedHandle>(null)
  return (
    <DataSquaresEmbed
      ref={embed}
      baseUrl="https://app.datasquares.ai"
      getToken={() => fetch('/analytics-token').then((r) => r.text())}
      theme="dark"
      params={{ region: 'west' }}
      onReady={({ pages }) => console.log('pages', pages)}
      onError={({ kind }) => console.warn('embed', kind)}
    />
  )
}
```

The token is HS256, lives ten minutes at most (five by default) and opens one
session: `getToken` is called when the embed starts and again before its
session (an hour) ends. It is handed to the embed by `postMessage` at the
exact DataSquares origin, never in a URL. The embed waits ten seconds for it:
a `getToken` slower than that shows that the view needs a token, or that its
session has ended, until the token arrives, which then starts it.

`signEmbedToken` checks its input the way DataSquares will check the token,
and throws an `EmbedTokenInputError` (its `field` names the input) on your
server — a key id or content id that is not a UUID, an empty `sub`, an
attribute name or value DataSquares refuses — instead of signing a token the
embed can only show it could not start.

- **Internal embedding** (Business): `sub` is the person's DataSquares email or
  SCIM id; everything is then their own: role, row-level security, AI credits.
  They open only what their role, or a share of a dashboard to them, opens in
  DataSquares. An internal token carries no attributes.
- **Customer-facing embedding** (Enterprise): `sub` and `tenant` name an
  embedded person, who is not a seat. The token's attributes must match the
  app's row rules exactly — every rule needs its attribute and an attribute
  without a rule is refused (`__proto__`, `constructor` and `prototype` are no
  attribute names) — and each rule filters its model field to the person's
  value. A customer whose `sub` is a member's email is another person. Views
  are counted per person (an opened dashboard or report for 30 minutes;
  20,000 a month included, then billed per 1,000) and Ask AI,
  when the app offers it to a `viewer_ai`, is
  paid from your company's bought credits, with per-person and per-tenant
  budgets.

A presentation embeds the same way: name it in the token's `content`
(`{ type: 'presentation', id }`, one of the app's content). It shows its
published version in present mode, never the editor, and has no Ask AI.

## A share link

A dashboard's public share link embeds with its token and id, and so does a
presentation's link (made under its **Share** → **Embed**):

```tsx
<DataSquaresEmbed baseUrl="https://app.datasquares.ai" contentId="your-dashboard-id" token={shareToken} />
```

A share token is a credential: anyone holding it sees the view.

The iframe auto-resizes to its content. Turn that off with `autoResize={false}`
and a fixed `height`.

## Next.js and server components

The component is a client component (it ships `'use client'`), so a server
component can render it — but `getToken` is a function, which a server
component cannot pass. Wrap it in a client component of your own:

```tsx
'use client'
import { DataSquaresEmbed } from '@digisquares/datasquares-react'

export function Analytics() {
  return <DataSquaresEmbed baseUrl="https://app.datasquares.ai" getToken={() => fetch('/analytics-token').then((r) => r.text())} />
}
```

`buildEmbedUrl` and `buildSessionEmbedUrl` are plain functions in their own
module and can be called from server code. Sign tokens in a route handler with
`createEmbedTokenHandler` from `@digisquares/datasquares-react/server`
(above).

## Props

| Prop | Default | |
|---|---|---|
| `baseUrl` | — | Your DataSquares app URL (http or https). The one origin the component talks to. |
| `getToken` | — | Each person's signed token, from your server (two keys). Takes the place of `contentId` and `token`. |
| `contentId`, `token` | — | A share link's content id and token. |
| `theme` | the embed's | `light` or `dark`. |
| `toolbar` | `true` | Show the embed toolbar. |
| `primaryColor` | — | Your brand color (hex without `#`, or any CSS color). |
| `logoUrl` | — | Your logo (https), shown in the embed's toolbar. The small *Powered by DataSquares* credit always shows: DataSquares does not offer white-labelling. |
| `page` | first page | The dashboard page to open on, by id. Changing it reloads the frame; to switch live, call `setPage`. |
| `params` | — | Initial parameter values (`p_*` in the URL). An inline object is fine: the frame reloads only when the values change. |
| `autoResize` | `true` | Grow the iframe to its content. |
| `height` | `600` | Initial or fixed height. |
| `loading` | `eager` | `lazy` defers loading until the frame nears the viewport. |
| `loadTimeoutMs` | `15000` | How long after the frame loads the embed may stay silent before `onError` hears `timeout`. `0` turns it off. |
| `loadingFallback` | — | Shown over the frame while it loads. |
| `errorFallback` | — | Shown over the frame when it fails: a node, or `(error, retry) => node`. Never for `password-required` (the embed asks for the password itself). |
| `title` | `DataSquares dashboard` | The iframe's accessible name. |
| `className`, `style` | — | On the iframe. |

With neither fallback set, the component renders the bare iframe. With one, it
wraps the iframe in a `position: relative` div (`data-ds-embed-status` names
the status) and lays the fallback over it.

```tsx
<DataSquaresEmbed
  baseUrl="https://app.datasquares.ai"
  getToken={getToken}
  loadingFallback={<Skeleton />}
  errorFallback={(error, retry) => <EmptyState title="Analytics are unavailable" onRetry={retry} detail={error.kind} />}
/>
```

## Controlling the embed

The `ref` handle sends typed commands over the versioned `ds:*` postMessage
protocol:

```ts
embed.current?.setParams({ region: 'east' })   // wins over the URL's p_* defaults
embed.current?.setPage('page-id')
embed.current?.refresh()                       // re-fetch the content
embed.current?.reload()                        // load the embed again from the start (e.g. after a timeout)
await embed.current?.requestFullscreen()       // from a click: browsers allow full screen only after one
const { pageId, params } = await embed.current!.getState()   // rejects after 5 s (getState(ms) to change)
```

Commands can be sent as soon as the ref is set, e.g. from an effect on mount:
until the page in the frame is listening, they wait, and go out when it first
speaks. Only the last `setParams`, `setPage` and `refresh` wait — each replaces
the one before. When `src` changes (another dashboard, page, theme or params)
or after `reload()`, the new page is waited for the same way.

## The embed as state: `useDataSquaresEmbed()`

Rather than wiring callbacks and a ref, spread the hook's `bind` onto the
component and render from its state:

```tsx
import { DataSquaresEmbed, useDataSquaresEmbed } from '@digisquares/datasquares-react'

function Analytics() {
  const embed = useDataSquaresEmbed({ onPointClick: ({ value }) => track('drill', value) })
  return (
    <>
      {embed.status === 'ready' && (
        <Tabs value={embed.pageId} onChange={embed.setPage} items={embed.pages} />
      )}
      {embed.filters.length > 0 && <span>{embed.filters.length} filters</span>}
      <DataSquaresEmbed {...embed.bind} baseUrl="https://app.datasquares.ai" getToken={getToken} />
    </>
  )
}
```

It gives `status` (`loading` · `ready` · `error`), `error`, `contentType`,
`pages`, `pageId`, `filters`, and the commands (`setParams`, `setPage`,
`refresh`, `reload`, `requestFullscreen`, `getState`). Pass your own `onReady`,
`onError`, `onPageChange`, `onFilterChange`, `onStatusChange` or `onPointClick`
to the hook, not to the component after `{...embed.bind}`, where they would
replace the hook's.

## Events

| Prop | Fires when |
|---|---|
| `onReady` | the embed authorized and rendered: `contentType` (`dashboard`, `report` or `presentation`) and `pages` (a dashboard's; none for a report or a presentation) |
| `onError` | it could not render — `invalid`, `forbidden`, `network`, `password-required`, `expired` (a session ended with no new token) — or it never spoke: `timeout`, with a `cause` naming the likely reasons — or your `getToken` failed: then `kind` is `invalid` and `cause` is what it threw (or a `TypeError` for an empty or over-long token) |
| `onStatusChange` | the status changed: `loading` (it starts so), `ready`, `error` |
| `onPageChange` | the visible dashboard page changed |
| `onPointClick` | a chart data point was clicked |
| `onFilterChange` | the cross-filter set changed (chart click, slicer, clear) |

A `getToken` that fails while a session is still showing (a renewal) is heard
by `onError` but leaves the status `ready`: the embed says `expired` itself if
the session then ends.

In development, the component also warns in the console when `getToken` and
`token` are both set, when `baseUrl` is plain http to another machine, and
when the embed fails with no `onError` to hear it. Production builds (where
your bundler sets `NODE_ENV=production`) stay silent.

## Troubleshooting: `timeout`

The frame loaded but the embed never spoke. In order of likelihood:

1. **`baseUrl` is wrong**: it must be your DataSquares app URL, e.g.
   `https://app.datasquares.ai`.
2. **Your page's Content-Security-Policy** keeps DataSquares out of frames:
   add its origin to `frame-src` (or `child-src`).
3. **Your site is not on the embed's allowed domains** (Sharing → Embed →
   Embed settings, or the embed app's sites).
4. **A `referrerpolicy="no-referrer"`** on the page hides your site from the
   embed, which then stays silent by design.

## Testing your integration

`@digisquares/datasquares-react/testing` stands in for the embed in your
own tests (Vitest or Jest, jsdom or happy-dom): it records the commands your
page sends, and speaks as the embed from the right window and origin, so your
callbacks run as they would against DataSquares, with no network.

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { simulateEmbed } from '@digisquares/datasquares-react/testing'

it('shows the pages and switches on click', async () => {
  render(<Analytics />)
  const embed = simulateEmbed(screen.getByTitle('DataSquares dashboard'), { state: { pageId: 'p1', params: {} } })
  embed.ready({ pages: [{ id: 'p1', name: 'Overview' }, { id: 'p2', name: 'Sales' }] })
  await userEvent.click(screen.getByText('Sales'))
  expect(embed.commands).toContainEqual({ type: 'ds:set-page', version: 1, pageId: 'p2' })
  await expect(embed.requestToken()).resolves.toBeTruthy()   // your getToken answered
})
```

It has `ready`, `resize`, `error`, `pageChange`, `pointClick`, `filterChange`,
`requestToken`, `setState` and `send`, and `commands` and `tokens` to assert
on. After `reload()` (a new iframe), call `simulateEmbed` again. Never import it
in application code: it replaces the frame's window.

## Upgrading from 0.3

The package has a new name: `@digisquares/datasquares-react` (it was
`@digisquares/datasquares-embed-react`, which stays at 0.3 and is deprecated).
Swap the name in `package.json` and in your imports, including `/server`:

```sh
npm uninstall @digisquares/datasquares-embed-react
npm install @digisquares/datasquares-react
```

Nothing else to change. New: `page`, `loadTimeoutMs`, `loadingFallback`,
`errorFallback`, `onStatusChange`, `reload()`, `requestFullscreen()`,
`useDataSquaresEmbed()`, `createEmbedTokenHandler`,
`createEmbedTokenMiddleware` and the `/testing` entry. What behaves
differently:

- `onError` can hear `timeout` (an embed that never spoke within 15 s of
  loading). Its type is now `EmbedHostErrorKind`, the embed's kinds and
  `timeout`; a `switch` over `kind` that must be exhaustive needs that case.
- With no `onError`, a failure is written to the console in development.

## Upgrading from 0.2

Nothing to change. What behaves differently:

- Commands sent before the embed listens now wait and are delivered, where
  they used to be dropped by the browser.
- `onError` may carry `cause` (your `getToken` failed).
- `signEmbedToken` throws `EmbedTokenInputError` for input DataSquares would
  refuse, which it used to sign.
- Messages of another protocol version, and ones whose pages, filters or
  state are malformed, are ignored.

## Upgrading from 0.1

`createEmbedToken` is gone: the per-viewer tokens it minted (`POST /api/embed-tokens`)
were never redeemed by DataSquares and that endpoint is retired. Make an embed
app and sign each person's token with `signEmbedToken` (above).

## Domain restriction

Workspaces can restrict which sites may embed their content (Share dialog →
allowed embed domains). The embed identifies its host by the frame's ancestor
origin and the DataSquares API refuses hosts not on the list. Two consequences
for the host page:

- Don't set `referrerpolicy="no-referrer"` around the embed — an unidentifiable
  host is **refused** when a restriction is configured. The component pins
  `strict-origin-when-cross-origin` on its iframe, which sends the origin and
  nothing more.
- The restriction controls where content can be *rendered*. The share token is
  still the credential — treat it like one. An embedded person's session is
  bound to the one site it was opened on.

## Security model

- Events are accepted only from the embed's own iframe **and** the DataSquares
  origin derived from `baseUrl`; two embeds on one page cannot cross, and no
  other frame can speak as the embed.
- Commands are posted to that exact origin, never `'*'` — if the frame is
  navigated elsewhere, commands are dropped by the browser, not delivered.
- Message payloads are structurally validated before any handler runs,
  including the protocol version and the pages, filters and state inside them.
- `baseUrl` must be http(s): a `javascript:` or `data:` base is refused.
- A token request is answered only for this iframe at the DataSquares origin,
  and the signed token is posted to that exact origin.
