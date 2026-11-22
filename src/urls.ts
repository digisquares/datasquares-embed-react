/**
 * The embed's URLs. Kept apart from the component (which is a client module) so a server component or a server route
 * can build an embed URL: a function exported from a `'use client'` module is only a client reference on the server.
 */

/** How the embed draws a person's menu (a token naming the embed app's menu); `none`: your page draws its own. */
export type EmbedMenuLayout = 'sidebar' | 'tabs' | 'dropdown' | 'gallery' | 'none'

/** The fonts the embed bundles, and the viewer's own system font. */
export type EmbedFont = 'default' | 'system' | 'inter' | 'geist' | 'space-grotesk' | 'source-serif' | 'jetbrains-mono'

/** The options both embed URLs carry. Each wins over the embed app's look (Administration → Settings → Embedding). */
export interface EmbedUrlOptions {
  baseUrl: string
  /** `light`, `dark`, or `auto` (follows the viewer's system). */
  theme?: string
  toolbar?: boolean
  primaryColor?: string
  logoUrl?: string
  /** The dashboard page to open on (its id). The embed falls back to the first page when it has no such page. */
  page?: string
  /** Show a dashboard's page tabs (default: the app's look, else shown). */
  tabs?: boolean
  /** `default`, `transparent` (your page shows through), or a colour as hex. */
  background?: string
  font?: EmbedFont
  padding?: 'none' | 'compact' | 'normal'
  /** A menu token: the item to open first (its content id). */
  item?: string
  /** A menu token: how to draw the menu (default: the app's). */
  menu?: EmbedMenuLayout
  params?: Record<string, string | number | boolean>
}

/**
 * The DataSquares origin `baseUrl` names: the one origin the component listens to and posts to. Only http(s) — a
 * mistyped or `javascript:`/`data:` base is refused here, with words, instead of failing somewhere inside `new URL`.
 */
export function embedOrigin(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new TypeError(`DataSquaresEmbed: baseUrl must be an absolute URL such as https://app.datasquares.ai (got ${JSON.stringify(baseUrl)}).`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError(`DataSquaresEmbed: baseUrl must be an http(s) URL (got ${url.protocol}).`)
  }
  return url.origin
}

function embedUrl(path: string, opts: EmbedUrlOptions): URL {
  const url = new URL(path, embedOrigin(opts.baseUrl))
  if (opts.theme) url.searchParams.set('theme', opts.theme)
  if (opts.toolbar !== undefined) url.searchParams.set('toolbar', String(opts.toolbar))
  if (opts.primaryColor) url.searchParams.set('primaryColor', opts.primaryColor)
  if (opts.logoUrl) url.searchParams.set('logoUrl', opts.logoUrl)
  if (opts.page) url.searchParams.set('page', opts.page)
  if (opts.tabs !== undefined) url.searchParams.set('tabs', String(opts.tabs))
  if (opts.background) url.searchParams.set('background', opts.background)
  if (opts.font) url.searchParams.set('font', opts.font)
  if (opts.padding) url.searchParams.set('padding', opts.padding)
  if (opts.item) url.searchParams.set('item', opts.item)
  if (opts.menu) url.searchParams.set('menu', opts.menu)
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    url.searchParams.set(`p_${key}`, String(value))
  }
  return url
}

/**
 * The session embed's URL: the options only. The person's signed token is handed over by postMessage when the embed
 * asks for it, never in the URL.
 */
export function buildSessionEmbedUrl(opts: EmbedUrlOptions): string {
  return embedUrl('/embed/session', opts).toString()
}

/** A share link's embed URL: its content id in the path, its token in the query. */
export function buildEmbedUrl(opts: EmbedUrlOptions & { contentId: string; token: string }): string {
  const url = embedUrl(`/embed/${encodeURIComponent(opts.contentId)}`, opts)
  // The token first, as the Share dialog's snippet writes it.
  const query = new URLSearchParams([['token', opts.token], ...url.searchParams])
  url.search = query.toString()
  return url.toString()
}
