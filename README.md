# @digisquares/datasquares-embed-react

React SDK for embedding DataSquares dashboards, reports and presentations: the
`<DataSquaresEmbed>` component, typed events, host-side controls, and a
server-side signer for each person's short-lived embed token.

## Install

```sh
npm install @digisquares/datasquares-embed-react
```

Or straight from the repository (builds on install via the `prepare` script):

```sh
npm install github:digisquares/datasquares-embed-react
```

## Two keys: each person, on your site

To show dashboards inside your own product, to your own people, make an embed
app in DataSquares (**Administration → Settings → Embedding**). It has a
client id and a key (a key id and a secret, shown once): the company key. For
each person, **your server** signs a short-lived token with that key: the
person's id. The browser only ever carries that token, and the embed swaps it
for a session bound to your site.

```ts
// On YOUR server, e.g. an Express or Next.js route your page calls
import { signEmbedToken } from '@digisquares/datasquares-embed-react/server'

app.get('/analytics-token', requireSignedIn, async (req, res) => {
  const token = await signEmbedToken({
    clientId: process.env.DS_EMBED_CLIENT_ID!,
    keyId: process.env.DS_EMBED_KEY_ID!,
    secret: process.env.DS_EMBED_SECRET!,          // never sent to a browser
    sub: req.user.id,                              // stable, opaque: no email needed
    tenant: req.user.accountId,                    // their customer account
    role: req.user.canAskAi ? 'viewer_ai' : 'viewer',
    attributes: { account: req.user.accountId },   // one per row rule of the app
    content: { type: 'dashboard', id: 'your-dashboard-id' },
  })
  res.type('text/plain').send(token)
})
```

```tsx
import { useRef } from 'react'
import { DataSquaresEmbed, type DataSquaresEmbedHandle } from '@digisquares/datasquares-embed-react'

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

## Controlling the embed

The `ref` handle sends typed commands over the versioned `ds:*` postMessage
protocol:

```ts
embed.current?.setParams({ region: 'east' })   // wins over the URL's p_* defaults
embed.current?.setPage('page-id')
embed.current?.refresh()
const { pageId, params } = await embed.current!.getState()
```

## Events

| Prop | Fires when |
|---|---|
| `onReady` | the embed authorized and rendered: `contentType` (`dashboard`, `report` or `presentation`) and `pages` (a dashboard's; none for a report or a presentation) |
| `onError` | it could not render — `invalid`, `forbidden`, `network`, `password-required`, `expired` (a session ended with no new token) |
| `onPageChange` | the visible dashboard page changed |
| `onPointClick` | a chart data point was clicked |
| `onFilterChange` | the cross-filter set changed (chart click, slicer, clear) |

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
- Message payloads are structurally validated before any handler runs.
- A token request is answered only for this iframe at the DataSquares origin,
  and the signed token is posted to that exact origin.
