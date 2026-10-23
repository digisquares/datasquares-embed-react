/**
 * @vitest-environment node
 *
 * The server-side signer for the two-key design (DataSquares AI plan chapter 12): the host's server signs, with its
 * embed app's key, a short-lived token for each person. HS256 with the key's id in the header, ten minutes at most,
 * a fresh nonce each time. The signature is checked here with Web Crypto's HMAC, as DataSquares checks it.
 */
import { describe, expect, it } from 'vitest'
import { signEmbedToken } from '../src/server.js'

const KEY = { clientId: 'dsapp_0123456789abcdef01234567', keyId: '5d0c1a52-2a4c-4e0b-9f53-6f4c3b9a1e01', secret: 'dssk_' + 'k'.repeat(43) }
const fromB64url = (part: string) => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const decode = (part: string) => JSON.parse(new TextDecoder().decode(fromB64url(part)))
async function verifies(token: string, secret: string): Promise<boolean> {
  const [h, p, sig] = token.split('.')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, fromB64url(sig!), new TextEncoder().encode(`${h}.${p}`))
}

describe('signEmbedToken (server only)', () => {
  it('signs the person, tenant, role, attributes and content with the app key, HS256, for five minutes by default', async () => {
    const now = 1_792_000_000_000
    const token = await signEmbedToken({
      ...KEY,
      sub: 'person-42',
      tenant: 'acme',
      role: 'viewer_ai',
      attributes: { account: 'A-1', region: ['West', 'North'] },
      content: { type: 'dashboard', id: 'c0ffee00-2a4c-4e0b-9f53-6f4c3b9a1e03' },
      now: () => now,
    })
    const [h, p, sig] = token.split('.')
    expect(decode(h!)).toEqual({ alg: 'HS256', typ: 'JWT', kid: KEY.keyId })
    const claims = decode(p!)
    expect(claims).toMatchObject({
      iss: KEY.clientId,
      aud: 'datasquares',
      sub: 'person-42',
      tenant: 'acme',
      role: 'viewer_ai',
      attributes: { account: 'A-1', region: ['West', 'North'] },
      content: { type: 'dashboard', id: 'c0ffee00-2a4c-4e0b-9f53-6f4c3b9a1e03' },
      iat: now / 1000,
      exp: now / 1000 + 300,
    })
    expect(claims.jti).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await verifies(token, KEY.secret)).toBe(true)
    expect(await verifies(token, 'dssk_another')).toBe(false)
  })

  it('each token has its own nonce, and lives ten minutes at most', async () => {
    const base = { ...KEY, sub: 'p', content: { type: 'report' as const, id: 'c0ffee00-2a4c-4e0b-9f53-6f4c3b9a1e03' } }
    const a = decode((await signEmbedToken(base)).split('.')[1]!)
    const b = decode((await signEmbedToken(base)).split('.')[1]!)
    expect(a.jti).not.toBe(b.jti)
    await expect(signEmbedToken({ ...base, ttlSeconds: 601 })).rejects.toThrow(/10 minutes/)
    const ten = decode((await signEmbedToken({ ...base, ttlSeconds: 600 })).split('.')[1]!)
    expect(ten.exp - ten.iat).toBe(600)
  })
})
