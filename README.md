# @digisquares/datasquares-react

React SDK for DataSquares in your own app: dashboards, reports and
presentations — one of them, or a menu of them in the embed app's look — with
`<DataSquaresEmbed>`, and the DataSquares AI chat over them with
`<DataSquaresChat>`. Typed events, host-side controls, loading and error
display, hooks, a token route for your server in three lines, and stand-ins for
your tests.

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

`content` names one dashboard, report or presentation of the app's content, or
the app's **menu**: `{ type: 'menu' }` for all of it, or `{ type: 'menu',
items: [...] }` for some of its items (1 to 100 content ids) for this person —
your premium customers see more, say. Items not on the app's menu are left out
by DataSquares, so taking one off the app never breaks your route.

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

## A menu

A token whose content is `{ type: 'menu' }` opens the embed app's menu: its
dashboards, reports and presentations in the order you set under
**Administration → Settings → Embedding**, each under its section heading and
with its label. The embed draws the menu in the app's layout — a `sidebar`,
`tabs`, a `dropdown`, or a `gallery` of cards shown first — or the `menu` prop's.
Another item opens in the same frame and session, without a new token.

To draw the menu in your own design, pass `menu="none"` and render it from the
hook's `items`:

```tsx
function Analytics() {
  const embed = useDataSquaresEmbed()
  return (
    <div className="flex">
      <MySidebar items={embed.items} current={embed.item?.id} onSelect={embed.open} />
      <DataSquaresEmbed {...embed.bind} baseUrl="https://app.datasquares.ai" getToken={getToken} menu="none" />
    </div>
  )
}
```

Each item is `{ id, type, name, section }`. `item` opens one first; `open(id)`
switches live (an id not in the person's menu is ignored, and in development
the console says so); `onItemChange` hears every switch, from your menu or the
embed's.

## Props

| Prop | Default | |
|---|---|---|
| `baseUrl` | — | Your DataSquares app URL (http or https). The one origin the component talks to. |
| `getToken` | — | Each person's signed token, from your server (two keys). Takes the place of `contentId` and `token`. |
| `contentId`, `token` | — | A share link's content id and token. |
| `item` | the menu's first | A menu token: the item to open first, by content id. Changing it reloads the frame; to switch live, call `open`. |
| `menu` | the app's layout | A menu token: `sidebar`, `tabs`, `dropdown`, `gallery`, or `none` when your page draws the menu. |
| `theme` | the app's look, else `light` | `light`, `dark`, or `auto` (follows the viewer's system). |
| `toolbar` | the app's look, else `true` | Show the embed toolbar. |
| `tabs` | the app's look, else `true` | Show a dashboard's page tabs (hidden, your page can still `setPage`). |
| `primaryColor` | the app's look | Your brand color (hex without `#`, or any CSS color). |
| `logoUrl` | the app's look | Your logo (https), shown beside the small *Powered by DataSquares* credit, which always shows: DataSquares does not offer white-labelling. |
| `background` | the theme's | `transparent` (your page shows through the frame) or a colour as hex. |
| `font` | the app's look | `system` (the viewer's own) or a font the embed bundles: `inter`, `geist`, `space-grotesk`, `source-serif`, `jetbrains-mono`. |
| `padding` | the app's look, else `normal` | Space around the content: `none`, `compact` or `normal`. |
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

The embed app's look (Administration → Settings → Embedding) also sets card
corners, borders and shadows and up to 8 chart colours; each prop above wins
over the app's look for that embed.

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
embed.current?.open('item-id')                 // a menu token: another item of the menu
embed.current?.reload()                        // load the embed again from the start (e.g. after a timeout)
await embed.current?.requestFullscreen()       // from a click: browsers allow full screen only after one
const { pageId, params } = await embed.current!.getState()   // rejects after 5 s (getState(ms) to change)
```

Commands can be sent as soon as the ref is set, e.g. from an effect on mount:
until the page in the frame is listening, they wait, and go out when it first
speaks. Only the last `setParams`, `setPage`, `refresh` and `open` wait — each
replaces the one before. When `src` changes (another dashboard, page, theme or params)
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
`items` and `item` (a menu token's), `pages`, `pageId`, `filters`, and the
commands (`setParams`, `setPage`, `refresh`, `open`, `reload`,
`requestFullscreen`, `getState`). Pass your own `onReady`, `onItemChange`,
`onError`, `onPageChange`, `onFilterChange`, `onStatusChange` or `onPointClick`
to the hook, not to the component after `{...embed.bind}`, where they would
replace the hook's.

## Events

| Prop | Fires when |
|---|---|
| `onReady` | the embed authorized and rendered: `contentType` (`dashboard`, `report`, `presentation`, or `menu` while the embed's gallery shows), `pages` (a dashboard's; none for a report or a presentation), and with a menu token `items` (the person's menu) and `item` (the one shown) |
| `onItemChange` | a menu token: another item of the menu is shown (picked in the embed's menu, or opened with `open`) |
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

## The AI chat: `<DataSquaresChat>`

The DataSquares AI chat, in a DataSquares frame: answers stream as they are
written, with progress lines, tables and charts drawn from the cards' own rows,
and each person's earlier conversations. It answers from what the person's
token names, under their row rules: one dashboard or report, or the embed app's
menu — every dashboard and report of the person's menu. It uses the same token
route as `<DataSquaresEmbed>`; the token's `role` must be `viewer_ai`, and the
embed app's Ask AI on (Administration → Settings → Embedding). Questions spend
the app's AI credits, within its monthly budgets and hourly limits.

```tsx
import { DataSquaresChat } from '@digisquares/datasquares-react'

<DataSquaresChat
  baseUrl="https://app.datasquares.ai"
  getToken={() => fetch('/api/datasquares-token').then((r) => r.text())}
  suggestions={['How did sales do this month?', 'Which region is behind?']}
/>
```

It shows three ways, switchable at any time on the same frame (a conversation
carries on across a switch):

| `mode` | |
|---|---|
| `panel` (default) | A launcher button in a corner (`position`, `launcherLabel`, your `primaryColor`) opens a floating panel (`panelWidth` × `panelHeight`); on a phone-narrow window, a sheet from the bottom. The chat's Minimize folds it back. |
| `inline` | It fills a box of your page (`height`). |
| `fullscreen` | It covers the window; the chat's Exit and Esc go back to the mode it came from. |

Pass `mode` and `open` to control them (with `onModeChange` and
`onOpenChange`, which also hear the person's own switches in the chat), or
`defaultMode` and `defaultOpen`. In `panel` mode the frame loads when the panel
first opens.

| Prop | |
|---|---|
| `scope` | A menu token: `view` keeps the chat on the item the session opens (`item`); default the whole menu. |
| `title`, `greeting`, `placeholder` | The chat's heading (default "Ask AI"), what it says before the first question, the question field's placeholder. |
| `suggestions` | Up to four questions to start with (default: questions about the menu's first items). |
| `conversation` | One of the person's earlier conversations to open first (its id, from `onConversationChange`). |
| `context` | What the person is looking at in your page; each question carries it (below). |
| `theme`, `primaryColor`, `logoUrl`, `background`, `font` | The look, as on the embed; each wins over the app's. The *Powered by DataSquares* credit always shows. |
| `loadTimeoutMs`, `loadingFallback`, `errorFallback`, `frameTitle`, `zIndex` | As on the embed. |

| Event | Fires when |
|---|---|
| `onReady` | the chat can answer; with a menu token, `items` is the menu it asks about |
| `onAnswer` | an answer is finished: `{ question, answer, conversationId, blocked, followUps, answerIndex }` (`blocked`: it was withheld; `followUps`: the questions it offers next; `answerIndex`: its number in the conversation) |
| `onFeedback` | the person rated an answer: `{ conversationId, answerIndex, rating, reason, note }` (`rating`: `up` or `down`; `reason` for a `down`; `note`: what they typed, which only you get) |
| `onFollowUp` | the person picked a question instead of typing it: `{ conversationId, question, source }` (`source`: `follow-up` under an answer, or `suggestion`) |
| `onConversationChange` | another conversation shows (a new one: `null` until its first answer) |
| `onLimitReached` | a monthly budget or an hourly limit stopped a question: `{ code, scope, message }` (`scope`: `person` or `tenant`); the chat says so in its own words |
| `onError` | it could not start (`forbidden` includes a token without Ask AI), never spoke (`timeout`), or `getToken` failed |
| `onStatusChange`, `onModeChange`, `onOpenChange` | the status, the mode, the panel opened or folded |

```tsx
const chat = useRef<DataSquaresChatHandle>(null)
chat.current?.ask('Why did margin drop?')   // a folded panel opens; waits until the chat listens
chat.current?.newConversation()
chat.current?.openConversation(id)
chat.current?.setMode('fullscreen')
chat.current?.setOpen(false)
chat.current?.setContext({ itemId, filters })
chat.current?.reload()
```

### What the person is looking at: `context`

Tell the chat which menu item the person is on, a card in focus, the filters
they have on, or a short note, and each question carries it: "why did this
drop?" is about what they see. The chat shows it on a chip above the question
field, which the person can set aside until you send a new one. It is a hint,
never access: an item outside the person's menu is ignored, and the filters
only narrow the rows the item's cards show them.

| Field | |
|---|---|
| `itemId` | The menu item the person is on: its id, as `onReady`'s `items` and `<DataSquaresEmbed onItemChange>` give it. |
| `cardId` | A card (or report block) on it, in focus. |
| `filters` | The filters they have on it, as `<DataSquaresEmbed onFilterChange>` gives them (20 at most). |
| `note` | A short line about what they are doing (300 characters at most). |
| `label` | The chip's name for it (80 at most; default the menu item's name). |

With the dashboard embed beside the chat, pass its events along:

```tsx
const [context, setContext] = useState<ChatContext | null>(null)

<DataSquaresEmbed
  baseUrl={BASE}
  getToken={getToken}
  onItemChange={(item) => setContext({ itemId: item.id })}
  onFilterChange={(filters) => setContext((c) => ({ ...c, filters }))}
/>
<DataSquaresChat baseUrl={BASE} getToken={getToken} context={context} />
```

`context` is compared by its contents, so a new object with the same fields
sends nothing. `setContext()` on the handle (or the hook) does the same
imperatively; `null` clears it.

### Follow-ups and ratings

Under the latest answer the chat offers up to three follow-up questions, made
from what the answer read (no extra AI call). Each answer kept in the person's
conversation can be rated helpful or not, with a reason; the person may add a
note. DataSquares keeps the rating and the reason (they appear, counted, on
Administration → Usage); the note goes to `onFeedback` only, so you can send it
to your own support or product tools.

`useDataSquaresChat()` holds the mode and the panel's state for you and gives
`status`, `error`, `mode`, `open`, `items`, `conversationId`, `lastAnswer`,
`limit` and the commands; spread its `bind` on the component:

```tsx
const chat = useDataSquaresChat({ defaultMode: 'panel' })
<button onClick={() => chat.ask('How did sales do this month?')}>Ask about sales</button>
<DataSquaresChat {...chat.bind} baseUrl="https://app.datasquares.ai" getToken={getToken} />
```

In your tests, `simulateChat(iframe)` from `/testing` speaks as the chat:
`ready({ items })`, `answer(…)`, `feedback(…)`, `followUp(…)`,
`conversationChange(id)`, `limit(…)`, `requestMode(mode)`, `error(kind)`,
`requestToken()`, and `commands` and `context` (the latest one sent) to assert
on. In `panel` mode, open the panel first: the frame mounts then.

## Without React: `<datasquares-chat>` and `<datasquares-embed>`

The same chat and embed as plain custom elements, for any page: no framework,
nothing to build. One script defines both:

```html
<script type="module" src="https://unpkg.com/@digisquares/datasquares-react@0.4.0/dist/element.js"></script>

<datasquares-embed id="board" base-url="https://app.datasquares.ai" token-url="/analytics-token" menu="tabs"></datasquares-embed>

<datasquares-chat
  base-url="https://app.datasquares.ai"
  token-url="/analytics-token"
  follows="board"
  suggestions='["How did sales do this month?", "Which region is behind?"]'
></datasquares-chat>
```

Or from npm in a bundled app: `import '@digisquares/datasquares-react/element'`
(React is not needed for it: it is an optional peer).

`token-url` is your server's token route (the same one the React components'
`getToken` calls): the element fetches it, with the page's cookies, when the
frame asks for the person's token, and reads the body as the token (text, or
`{ "token": "…" }`). Or set a function: `el.getToken = () => …`. The token never
goes in an address.

**`<datasquares-chat>`**

| Attribute | |
|---|---|
| `base-url` | Your DataSquares app URL (required). |
| `token-url` | Your token route (or the `getToken` property). |
| `mode`, `open` | `panel` (default), `inline` or `fullscreen`; `open` opens a panel. The element updates them when the person switches in the chat. |
| `follows` | The id of a `<datasquares-embed>` on the page: the menu item it shows and the filters the person sets become the chat's context. |
| `chat-title`, `greeting`, `placeholder` | The chat's heading, what it says first, the question field's placeholder (`title` is HTML's own tooltip attribute, so the heading is `chat-title`). |
| `suggestions` | A JSON array of questions, or one question a line (up to four). |
| `scope`, `item`, `conversation` | As the React props. |
| `theme`, `primary-color`, `logo-url`, `background`, `font` | The look. |
| `launcher-label`, `position`, `panel-width`, `panel-height`, `height`, `z-index`, `load-timeout`, `frame-title` | As the React props. |

Methods: `ask(question)`, `newConversation()`, `openConversation(id)`,
`setMode(mode)`, `setOpen(open)`, `setContext(context)` (or set the `context`
property), `reload()`. Properties: `status`, `error`.

Events (each a bubbling `CustomEvent` whose `detail` is what the React callback
gets): `ds-ready`, `ds-answer`, `ds-feedback`, `ds-follow-up`,
`ds-conversation-change`, `ds-limit`, `ds-mode-change`, `ds-open-change`,
`ds-error`, `ds-status-change`. A `ds-mode-change` the person started in the chat
is cancelable: `preventDefault()` keeps the mode you chose.

```js
const chat = document.querySelector('datasquares-chat')
chat.addEventListener('ds-feedback', (e) => sendToSupport(e.detail))
chat.ask('Why did margin drop?')
```

**`<datasquares-embed>`**

| Attribute | |
|---|---|
| `base-url` | Your DataSquares app URL (required). |
| `token-url` | Each person's embed: your token route (or the `getToken` property). |
| `share-token`, `content-id` | A share link's embed instead. |
| `theme`, `toolbar`, `primary-color`, `logo-url`, `page`, `tabs`, `background`, `font`, `padding`, `item`, `menu` | As the React props. |
| `params` | Parameter values, as a JSON object. |
| `height`, `auto-height` | The frame's height (default 600), or grow to the content. |
| `load-timeout`, `frame-title` | As the React props. |

Methods: `setParams(params)`, `setPage(id)`, `open(itemId)`, `refresh()`,
`getState()` (a promise), `reload()`. Events: `ds-ready`, `ds-item-change`,
`ds-page-change`, `ds-point-click`, `ds-filter-change`, `ds-resize`, `ds-error`,
`ds-status-change`.

Both draw in a shadow root: style the launcher, the box and the frame from your
page with `::part(launcher)`, `::part(box)` and `::part(frame)`.

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

It has `ready` (`ready({ items, item })` speaks as a menu), `itemChange`,
`resize`, `error`, `pageChange`, `pointClick`, `filterChange`, `requestToken`,
`setState` and `send`, and `commands` and `tokens` to assert on. After `reload()` (a new iframe), call `simulateEmbed` again. Never import it
in application code: it replaces the frame's window.

## Upgrading from 0.3

The package has a new name: `@digisquares/datasquares-react` (it was
`@digisquares/datasquares-embed-react`, which stays at 0.3 and is deprecated).
Swap the name in `package.json` and in your imports, including `/server`:

```sh
npm uninstall @digisquares/datasquares-embed-react
npm install @digisquares/datasquares-react
```

Nothing else to change. New: menus (`content: { type: 'menu' }` in the token,
`item`, `menu`, `open()`, `onItemChange`, the hook's `items` and `item`), the
look props (`theme="auto"`, `tabs`, `background`, `font`, `padding`), `page`,
`loadTimeoutMs`, `loadingFallback`, `errorFallback`, `onStatusChange`,
`reload()`, `requestFullscreen()`, `useDataSquaresEmbed()`,
`createEmbedTokenHandler`, `createEmbedTokenMiddleware` and the `/testing`
entry. What behaves differently:

- `onError` can hear `timeout` (an embed that never spoke within 15 s of
  loading). Its type is now `EmbedHostErrorKind`, the embed's kinds and
  `timeout`; a `switch` over `kind` that must be exhaustive needs that case.
- With no `onError`, a failure is written to the console in development.
- `onReady` also hears `item` and `items` (null and empty for a token naming
  one item); a test asserting its exact argument needs them.

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
