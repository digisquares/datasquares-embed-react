/**
 * @vitest-environment node
 *
 * signEmbedToken refuses, on the publisher's server and in words, every input DataSquares would refuse when it reads
 * the token (datasquares-api embed-token.ts) — rather than signing a token the embed can only show it could not start.
 */
import { describe, expect, it } from 'vitest'
import { signEmbedToken, type SignEmbedTokenInput } from '../src/server.js'

const KEY = { clientId: 'dsapp_0123456789abcdef01234567', keyId: '5d0c1a52-2a4c-4e0b-9f53-6f4c3b9a1e01', secret: 'dssk_' + 'k'.repeat(43) }
const ok: SignEmbedTokenInput = { ...KEY, sub: 'person-1', content: { type: 'dashboard', id: 'c0ffee00-2a4c-4e0b-9f53-6f4c3b9a1e03' } }
const decode = (part: string) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))

describe('signEmbedToken: inputs DataSquares would refuse', () => {
  const cases: Array<[field: string, patch: Record<string, unknown>]> = [
    ['clientId', { clientId: '' }],
    ['keyId', { keyId: 'not-a-uuid' }],
    ['secret', { secret: '' }],
    ['sub', { sub: '   ' }],
    ['sub', { sub: 'x'.repeat(256) }],
    ['tenant', { tenant: 'x'.repeat(256) }],
    ['role', { role: 'admin' }],
    ['content', { content: { type: 'deck', id: 'c0ffee00-2a4c-4e0b-9f53-6f4c3b9a1e03' } }],
    ['content.id', { content: { type: 'report', id: 'my-report' } }],
    ['attributes', { attributes: ['a'] }],
    ['attributes.1st', { attributes: { '1st': 'x' } }],
    ['attributes.has space', { attributes: { 'has space': 'x' } }],
    ['attributes.constructor', { attributes: { constructor: 'x' } }],
    ['attributes.__proto__', { attributes: JSON.parse('{"__proto__":"x"}') }],
    ['attributes.region', { attributes: { region: [] } }],
    ['attributes.region', { attributes: { region: [true] } }],
    ['attributes.score', { attributes: { score: Number.NaN } }],
    ['attributes.nested', { attributes: { nested: { a: 1 } } }],
  ]
  for (const [field, patch] of cases) {
    it(`refuses a bad ${field}: ${JSON.stringify(patch).slice(0, 60)}`, async () => {
      await expect(signEmbedToken({ ...ok, ...patch } as SignEmbedTokenInput)).rejects.toMatchObject({ name: 'EmbedTokenInputError', field })
    })
  }

  it('says which input and why, and never echoes the secret', async () => {
    const err = await signEmbedToken({ ...ok, keyId: 'nope' }).catch((e: Error) => e)
    expect(String(err)).toMatch(/keyId must be the app key's id, a UUID/)
    expect(String(err)).not.toContain(KEY.secret)
  })

  it('refuses a ttl that is not a whole number of seconds from 1 to 600', async () => {
    await expect(signEmbedToken({ ...ok, ttlSeconds: 1.5 })).rejects.toThrow(/10 minutes/)
    await expect(signEmbedToken({ ...ok, ttlSeconds: 0 })).rejects.toThrow(/10 minutes/)
  })
})

describe('signEmbedToken: the chat alone (0.5)', () => {
  const chatOnly: SignEmbedTokenInput = { ...KEY, sub: 'person-1', role: 'viewer_ai', content: { type: 'chat' } }

  it("signs { type: 'chat' } for a viewer_ai, as it is", async () => {
    const claims = decode((await signEmbedToken(chatOnly)).split('.')[1]!)
    expect(claims.content).toEqual({ type: 'chat' })
    expect(claims.role).toBe('viewer_ai')
  })

  it('refuses an id or items beside it', async () => {
    const withId = { ...chatOnly, content: { type: 'chat', id: 'c0ffee00-2a4c-4e0b-9f53-6f4c3b9a1e03' } } as unknown as SignEmbedTokenInput
    await expect(signEmbedToken(withId)).rejects.toMatchObject({ name: 'EmbedTokenInputError', field: 'content.id' })
    const withItems = { ...chatOnly, content: { type: 'chat', items: [] } } as unknown as SignEmbedTokenInput
    const err = await signEmbedToken(withItems).catch((e: Error) => e)
    expect(err).toMatchObject({ name: 'EmbedTokenInputError', field: 'content.items' })
    expect(String(err)).toMatch(/content\.items is not taken by a chat token: its content is \{ type: 'chat' \} alone/)
  })

  it('refuses a chat token for a viewer, or with no role (a viewer by default)', async () => {
    await expect(signEmbedToken({ ...chatOnly, role: 'viewer' })).rejects.toMatchObject({ name: 'EmbedTokenInputError', field: 'role' })
    const { role: _role, ...noRole } = chatOnly
    const err = await signEmbedToken(noRole).catch((e: Error) => e)
    expect(err).toMatchObject({ field: 'role' })
    expect(String(err)).toMatch(/role must be 'viewer_ai' for a chat token/)
  })

  it('types it: a chat content takes nothing beside its type', () => {
    const ok: SignEmbedTokenInput['content'] = { type: 'chat' }
    // @ts-expect-error a chat token names no content
    const withId: SignEmbedTokenInput['content'] = { type: 'chat', id: 'c0ffee00-2a4c-4e0b-9f53-6f4c3b9a1e03' }
    // @ts-expect-error nor a menu's items
    const withItems: SignEmbedTokenInput['content'] = { type: 'chat', items: ['c0ffee00-2a4c-4e0b-9f53-6f4c3b9a1e03'] }
    expect([ok, withId, withItems]).toHaveLength(3)
  })
})

describe('signEmbedToken: every shape DataSquares reads still signs', () => {
  it('attributes of text, numbers, booleans and lists; dotted and underscored names; an empty tenant', async () => {
    const attributes = { account: 'A-1', 'geo.region': ['West', 2], active: true, tier: 3, _x: 'y' }
    const claims = decode((await signEmbedToken({ ...ok, tenant: '', attributes })).split('.')[1]!)
    expect(claims.attributes).toEqual(attributes)
    expect(claims.tenant).toBe('')
  })

  it('an upper-case UUID key id and content id', async () => {
    const token = await signEmbedToken({ ...ok, keyId: KEY.keyId.toUpperCase(), content: { type: 'report', id: 'C0FFEE00-2A4C-4E0B-9F53-6F4C3B9A1E03' } })
    expect(token.split('.')).toHaveLength(3)
  })
})
