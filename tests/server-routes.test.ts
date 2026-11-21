/**
 * @vitest-environment node
 *
 * 0.4: a token route in three lines — createEmbedTokenHandler for Fetch runtimes (Next.js route handlers, Hono, Bun,
 * Deno, Workers) and createEmbedTokenMiddleware for Node and Express. 200 with the token and no-store, 401 with no one
 * signed in, 500 without the reason when signing fails, and the app's key never replaced by what claims returns.
 */
import { describe, expect, it, vi } from 'vitest'
import { createEmbedTokenHandler, createEmbedTokenMiddleware, type EmbedTokenClaimsInput } from '../src/server.js'

const KEY = { clientId: 'dsapp_0123456789abcdef01234567', keyId: '5d0c1a52-2a4c-4e0b-9f53-6f4c3b9a1e01', secret: 'dssk_' + 'k'.repeat(43) }
const PERSON: EmbedTokenClaimsInput = { sub: 'person-1', tenant: 'acme', content: { type: 'dashboard', id: 'c0ffee00-2a4c-4e0b-9f53-6f4c3b9a1e03' } }
const decode = (part: string) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))

describe('createEmbedTokenHandler (Fetch)', () => {
  it("answers the signed-in person's token, never cached", async () => {
    const handler = createEmbedTokenHandler({ ...KEY, ttlSeconds: 120, claims: (req) => (req.headers.get('x-user') ? PERSON : null) })
    const res = await handler(new Request('https://host.example/analytics-token', { headers: { 'x-user': '1' } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/)
    const claims = decode((await res.text()).split('.')[1]!)
    expect(claims).toMatchObject({ iss: KEY.clientId, sub: 'person-1', tenant: 'acme' })
    expect(claims.exp - claims.iat).toBe(120)
  })

  it('answers 401 and signs nothing when no one is signed in', async () => {
    const res = await createEmbedTokenHandler({ ...KEY, claims: async () => null })(new Request('https://host.example/t'))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Not signed in.')
  })

  it('answers 500 without the reason when claims throw or the input cannot be signed; onError hears it', async () => {
    const onError = vi.fn()
    const thrown = await createEmbedTokenHandler({ ...KEY, onError, claims: () => { throw new Error('session store down') } })(new Request('https://h/t'))
    expect(thrown.status).toBe(500)
    expect(await thrown.text()).toBe('Could not sign the embed token.')
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'session store down' }))

    const missingSecret = await createEmbedTokenHandler({ ...KEY, secret: '', onError, claims: () => PERSON })(new Request('https://h/t'))
    expect(missingSecret.status).toBe(500)
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'EmbedTokenInputError', field: 'secret' }))
  })

  it("a claims object cannot replace the app's key", async () => {
    const sneaky = { ...PERSON, clientId: 'dsapp_other', keyId: '00000000-0000-0000-0000-000000000000', secret: 'guess' } as EmbedTokenClaimsInput
    const res = await createEmbedTokenHandler({ ...KEY, claims: () => sneaky })(new Request('https://h/t'))
    const [header, payload] = (await res.text()).split('.')
    expect(decode(header!).kid).toBe(KEY.keyId)
    expect(decode(payload!).iss).toBe(KEY.clientId)
  })
})

describe('createEmbedTokenMiddleware (Node, Express)', () => {
  function fakeResponse() {
    const headers: Record<string, string> = {}
    let body: string | undefined
    const res = {
      statusCode: 0,
      setHeader: (name: string, value: string) => void (headers[name.toLowerCase()] = value),
      end: (b?: string) => void (body = b),
    }
    return { res, headers, body: () => body }
  }

  it('writes the token with the same headers', async () => {
    const { res, headers, body } = fakeResponse()
    await createEmbedTokenMiddleware<{ user?: { id: string } }>({ ...KEY, claims: (req) => req.user && { ...PERSON, sub: req.user.id } })(
      { user: { id: 'u-7' } },
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(headers['cache-control']).toBe('no-store')
    expect(decode(body()!.split('.')[1]!).sub).toBe('u-7')
  })

  it('writes 401 with no one signed in', async () => {
    const { res } = fakeResponse()
    await createEmbedTokenMiddleware<{ user?: { id: string } }>({ ...KEY, claims: (req) => req.user && PERSON })({}, res)
    expect(res.statusCode).toBe(401)
  })
})
