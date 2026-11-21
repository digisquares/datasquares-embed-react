/**
 * The embed's URLs. Kept apart from the component (which is a client module) so a server component or a server route
 * can build an embed URL: a function exported from a `'use client'` module is only a client reference on the server.
 */

/** The options both embed URLs carry. */
export interface EmbedUrlOptions {
  baseUrl: string
  theme?: string
  toolbar?: boolean
  primaryColor?: string
  logoUrl?: string
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
