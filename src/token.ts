/**
 * Server-side embed-token helper.
 *
 * ⚠ SERVER ONLY. Minting calls `POST /api/embed-tokens` with YOUR DataSquares
 * credentials — putting those in a browser bundle hands every visitor the
 * ability to mint tokens for any content and any RLS context. The intended
 * shape is: your backend exposes its own endpoint, authenticates YOUR user,
 * chooses the RLS context for that user, calls this, and returns only the
 * token string to the browser.
 */

export interface CreateEmbedTokenInput {
  /** Your DataSquares API URL, e.g. `https://api.datasquares.ai`. */
  apiUrl: string
  /** A DataSquares access token or API key with rights to the content. */
  accessToken: string
  contentType: 'dashboard' | 'report'
  contentId: string
  /** Label shown in the workspace's embed-token list. */
  name?: string
  /**
   * Row-level-security context bound INTO the token — per-viewer row scoping,
   * decided by your backend, invisible to and untouchable by the viewer.
   */
  rlsContext?: Record<string, unknown>
  /** ISO timestamp; omit for a non-expiring token (revocable either way). */
  expiresAt?: string
  /** Override fetch (tests, custom agents). */
  fetchImpl?: typeof fetch
}

export interface EmbedTokenResult {
  token: string
  [key: string]: unknown
}

export async function createEmbedToken(input: CreateEmbedTokenInput): Promise<EmbedTokenResult> {
  const { apiUrl, accessToken, fetchImpl = fetch, ...body } = input
  const res = await fetchImpl(new URL('/api/embed-tokens', apiUrl).toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contentType: body.contentType,
      contentId: body.contentId,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.rlsContext !== undefined ? { rlsContext: body.rlsContext } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
    }),
  })
  if (!res.ok) {
    throw new Error(`DataSquares embed-token request failed: ${res.status} ${await res.text().catch(() => '')}`)
  }
  return (await res.json()) as EmbedTokenResult
}
