/**
 * Server-side signer for the two-key design (DataSquares AI plan chapter 12).
 *
 * ⚠ SERVER ONLY. Import it from `@digisquares/datasquares-embed-react/server` in
 * your backend, never in a browser bundle: it takes your embed app's secret.
 *
 *   - The company key: an embed app a company admin makes in DataSquares
 *     (Administration → Settings → Embedding): a client id, a key id and a
 *     secret, shown once. Keep the secret in your server's secret store.
 *   - The person's id: for each person, your server signs a short-lived token
 *     with that secret — this function — naming the person, their tenant, their
 *     role, the attributes their rows are filtered by and the content. Your
 *     page's `getToken` fetches it from your server; the embed swaps it, once,
 *     for a session bound to your site.
 *
 * HS256 (HMAC-SHA256) through Web Crypto, so it runs on Node 20+, Deno, Bun and
 * edge runtimes with no dependency. Ten minutes at most; five by default.
 */

export interface SignEmbedTokenInput {
  /** The embed app's client id (goes in the token as `iss`). */
  clientId: string
  /** The id of the app key whose secret signs (goes in the header as `kid`). */
  keyId: string
  /** The app key's secret. Server only. */
  secret: string
  /** The person's own, stable id in your system (internal embedding: their DataSquares email or SCIM id). */
  sub: string
  /** Their customer account, for a product that serves many companies. */
  tenant?: string
  /** `viewer`, or `viewer_ai` for a viewer who may ask the AI (default `viewer`). */
  role?: 'viewer' | 'viewer_ai'
  /**
   * The values their rows are filtered by, one for each of the app's row rules
   * (every rule needs its attribute; an attribute without a rule is refused).
   */
  attributes?: Record<string, string | number | boolean | Array<string | number>>
  /** The dashboard or report the session opens (one of the app's content). */
  content: { type: 'dashboard' | 'report'; id: string }
  /** Seconds until it expires: 300 by default, 600 at most. */
  ttlSeconds?: number
  /** The clock, in milliseconds (tests). */
  now?: () => number
}

const MAX_TTL_SECONDS = 600

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)))

function nonce(): string {
  const bytes = new Uint8Array(18)
  globalThis.crypto.getRandomValues(bytes)
  return base64url(bytes)
}

/** Sign one person's short-lived embed token with your embed app's key. */
export async function signEmbedToken(input: SignEmbedTokenInput): Promise<string> {
  const ttl = input.ttlSeconds ?? 300
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
    throw new Error(`An embed token lives from 1 second to 10 minutes (${MAX_TTL_SECONDS} seconds); ttlSeconds was ${ttl}.`)
  }
  const iat = Math.floor((input.now ?? Date.now)() / 1000)
  const claims = {
    iss: input.clientId,
    aud: 'datasquares',
    sub: input.sub,
    ...(input.tenant !== undefined ? { tenant: input.tenant } : {}),
    role: input.role ?? 'viewer',
    ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
    content: input.content,
    iat,
    exp: iat + ttl,
    jti: nonce(),
  }
  const signingInput = `${encodeJson({ alg: 'HS256', typ: 'JWT', kid: input.keyId })}.${encodeJson(claims)}`
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput)))
  return `${signingInput}.${base64url(signature)}`
}
