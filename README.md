# @datasquares/embed-react

React SDK for embedding DataSquares dashboards and reports: the `<DataSquaresEmbed>`
component, typed events, host-side controls, and a server-side token helper.

```tsx
import { useRef } from 'react'
import { DataSquaresEmbed, type DataSquaresEmbedHandle } from '@datasquares/embed-react'

function Analytics({ token }: { token: string }) {
  const embed = useRef<DataSquaresEmbedHandle>(null)

  return (
    <DataSquaresEmbed
      ref={embed}
      baseUrl="https://app.datasquares.ai"
      contentId="your-dashboard-id"
      token={token}
      theme="dark"
      params={{ region: 'west' }}
      onReady={({ pages }) => console.log('pages', pages)}
      onFilterChange={(filters) => console.log('filters', filters)}
      onPointClick={({ cardId, value }) => console.log('clicked', cardId, value)}
    />
  )
}
```

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
| `onReady` | the embed authorized and rendered (`contentType`, `pages`) |
| `onError` | it could not render — `invalid`, `forbidden`, `network`, `password-required` |
| `onPageChange` | the visible dashboard page changed |
| `onPointClick` | a chart data point was clicked |
| `onFilterChange` | the cross-filter set changed (chart click, slicer, clear) |

## Minting tokens — server-side only

Embed tokens are minted with your DataSquares credentials, so the exchange
belongs on **your backend**, never in the browser. Your endpoint authenticates
*your* user, chooses that user's row-level-security context, and returns only
the token:

```ts
// e.g. an Express/Next route handler on YOUR server
import { createEmbedToken } from '@datasquares/embed-react'

const { token } = await createEmbedToken({
  apiUrl: 'https://api.datasquares.ai',
  accessToken: process.env.DATASQUARES_TOKEN!,
  contentType: 'dashboard',
  contentId: 'your-dashboard-id',
  rlsContext: { tenant_id: currentUser.tenantId },  // per-viewer row scoping
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
})
```

The `rlsContext` is bound into the token — the viewer cannot see or change it.

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
  still the credential — treat it like one.

## Security model

- Events are accepted only from the embed's own iframe **and** the DataSquares
  origin derived from `baseUrl`; two embeds on one page cannot cross, and no
  other frame can speak as the embed.
- Commands are posted to that exact origin, never `'*'` — if the frame is
  navigated elsewhere, commands are dropped by the browser, not delivered.
- Message payloads are structurally validated before any handler runs.
