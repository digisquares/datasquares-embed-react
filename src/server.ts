/**
 * Server-side signer for the two-key design (DataSquares AI plan chapter 12).
 *
 * ⚠ SERVER ONLY. Import it from `@digisquares/datasquares-react/server` in
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
  /** The dashboard, report or presentation the session opens (one of the app's content; a presentation in present mode). */
  content: { type: 'dashboard' | 'report' | 'presentation'; id: string }
  /** Seconds until it expires: 300 by default, 600 at most. */
  ttlSeconds?: number
  /** The clock, in milliseconds (tests). */
  now?: () => number
}

const MAX_TTL_SECONDS = 600

// What DataSquares checks when it reads the token (a mirror: refusing here says what is wrong on YOUR server, in words,
// where an embed that is handed a bad token only shows that it could not start).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ATTRIBUTE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/
const RESERVED_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])
const CONTENT_TYPES: ReadonlySet<unknown> = new Set(['dashboard', 'report', 'presentation'])
const MAX_ID_CHARS = 255

/** An input `signEmbedToken` cannot sign: `field` names which, and the message says why. */
export class EmbedTokenInputError extends TypeError {
  readonly field: string
  constructor(field: string, message: string) {
    super(`signEmbedToken: ${field} ${message}`)
    this.name = 'EmbedTokenInputError'
    this.field = field
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function checkInput(input: SignEmbedTokenInput): void {
  if (!isRecord(input)) throw new EmbedTokenInputError('input', 'must be an object.')
  if (!isText(input.clientId)) throw new EmbedTokenInputError('clientId', "must be the embed app's client id.")
  if (typeof input.keyId !== 'string' || !UUID_RE.test(input.keyId)) {
    throw new EmbedTokenInputError('keyId', "must be the app key's id, a UUID (shown with the key in Administration → Settings → Embedding).")
  }
  if (!isText(input.secret)) throw new EmbedTokenInputError('secret', "must be the app key's secret.")
  if (!isText(input.sub) || input.sub.length > MAX_ID_CHARS) {
    throw new EmbedTokenInputError('sub', `must be the person's id: text, 1 to ${MAX_ID_CHARS} characters.`)
  }
  if (input.tenant !== undefined && (typeof input.tenant !== 'string' || input.tenant.length > MAX_ID_CHARS)) {
    throw new EmbedTokenInputError('tenant', `must be text of at most ${MAX_ID_CHARS} characters.`)
  }
  if (input.role !== undefined && input.role !== 'viewer' && input.role !== 'viewer_ai') {
    throw new EmbedTokenInputError('role', "must be 'viewer' or 'viewer_ai'.")
  }
  const content = input.content as unknown
  if (!isRecord(content) || !CONTENT_TYPES.has(content.type)) {
    throw new EmbedTokenInputError('content', "must be { type: 'dashboard' | 'report' | 'presentation', id }.")
  }
  if (typeof content.id !== 'string' || !UUID_RE.test(content.id)) {
    throw new EmbedTokenInputError('content.id', 'must be the content\'s id, a UUID.')
  }
  if (input.attributes !== undefined) {
    if (!isRecord(input.attributes)) throw new EmbedTokenInputError('attributes', 'must be an object of names and values.')
    for (const [name, value] of Object.entries(input.attributes)) {
      if (!ATTRIBUTE_NAME_RE.test(name) || RESERVED_ATTRIBUTE_NAMES.has(name)) {
        throw new EmbedTokenInputError(
          `attributes.${name}`,
          'is not an attribute name: a letter or _ first, then letters, digits, _ . or -, 64 at most (and not __proto__, constructor or prototype).',
        )
      }
      const plain = typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value)
      const list = Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' || isFiniteNumber(v))
      if (!plain && !list) {
        throw new EmbedTokenInputError(`attributes.${name}`, 'must be text, a finite number, true or false, or a non-empty list of text and numbers.')
      }
    }
  }
}

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
  checkInput(input)
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

// ── A token route in three lines ───────────────────────────────────────────────────────────────────────────────────

/** What your route decides for the signed-in person: everything `signEmbedToken` takes except the app's key. */
export type EmbedTokenClaimsInput = Omit<SignEmbedTokenInput, 'clientId' | 'keyId' | 'secret' | 'ttlSeconds' | 'now'>

export interface EmbedTokenRouteOptions<Req> {
  clientId: string
  keyId: string
  /** Server only, e.g. `process.env.DS_EMBED_SECRET`. Read on each request, so a build without it does not fail. */
  secret: string
  /** Seconds until each token expires: 300 by default, 600 at most. */
  ttlSeconds?: number
  /**
   * Who is signed in to YOUR product, from your own session, and what they may see. Return null (or undefined) when no
   * one is: the route answers 401 and signs nothing.
   */
  claims: (request: Req) => EmbedTokenClaimsInput | null | undefined | Promise<EmbedTokenClaimsInput | null | undefined>
  /** Hears a failure (your `claims` threw, or the input could not be signed). Default: `console.error`. */
  onError?: (error: unknown) => void
}

interface RouteAnswer {
  status: number
  body: string
}

async function answerTokenRequest<Req>(opts: EmbedTokenRouteOptions<Req>, request: Req): Promise<RouteAnswer> {
  const fail = (error: unknown): RouteAnswer => {
    if (opts.onError) opts.onError(error)
    else console.error('[datasquares-embed] could not sign the embed token:', error)
    // Never the reason: it may name your configuration. The onError hook has it.
    return { status: 500, body: 'Could not sign the embed token.' }
  }
  let claims: EmbedTokenClaimsInput | null | undefined
  try {
    claims = await opts.claims(request)
  } catch (error) {
    return fail(error)
  }
  if (!claims) return { status: 401, body: 'Not signed in.' }
  try {
    // The app's key last: a claims object cannot replace it.
    const token = await signEmbedToken({
      ...claims,
      clientId: opts.clientId,
      keyId: opts.keyId,
      secret: opts.secret,
      ...(opts.ttlSeconds !== undefined ? { ttlSeconds: opts.ttlSeconds } : {}),
    })
    return { status: 200, body: token }
  } catch (error) {
    return fail(error)
  }
}

const TOKEN_HEADERS: Record<string, string> = {
  'Content-Type': 'text/plain; charset=utf-8',
  // Each token is the person's own and makes one session: no cache, shared or private, may keep one.
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

/**
 * A token route for any runtime that speaks Fetch `Request`/`Response`: Next.js route handlers, Remix, Hono, Bun,
 * Deno, Cloudflare Workers.
 *
 *   // app/analytics-token/route.ts
 *   export const GET = createEmbedTokenHandler({
 *     clientId: process.env.DS_EMBED_CLIENT_ID!, keyId: process.env.DS_EMBED_KEY_ID!, secret: process.env.DS_EMBED_SECRET!,
 *     claims: async () => { const user = await currentUser(); return user && { sub: user.id, content: { type: 'dashboard', id: '…' } } },
 *   })
 */
export function createEmbedTokenHandler(opts: EmbedTokenRouteOptions<Request>): (request: Request) => Promise<Response> {
  return async (request) => {
    const { status, body } = await answerTokenRequest(opts, request)
    return new Response(body, { status, headers: TOKEN_HEADERS })
  }
}

/** The part of a Node `ServerResponse` (and so Express's `res`) the middleware writes to. */
export interface NodeResponseLike {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(body?: string): unknown
}

/**
 * The same route for Node's `http` and Express-style servers:
 *
 *   app.get('/analytics-token', requireSignedIn, createEmbedTokenMiddleware({
 *     clientId, keyId, secret,
 *     claims: (req) => ({ sub: req.user.id, tenant: req.user.accountId, content: { type: 'dashboard', id: '…' } }),
 *   }))
 */
export function createEmbedTokenMiddleware<Req = unknown>(
  opts: EmbedTokenRouteOptions<Req>,
): (request: Req, response: NodeResponseLike) => Promise<void> {
  return async (request, response) => {
    const { status, body } = await answerTokenRequest(opts, request)
    response.statusCode = status
    for (const [name, value] of Object.entries(TOKEN_HEADERS)) response.setHeader(name, value)
    response.end(body)
  }
}
