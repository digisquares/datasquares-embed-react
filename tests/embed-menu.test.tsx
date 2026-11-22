/**
 * @vitest-environment jsdom
 *
 * A menu: a token whose content is `{ type: 'menu' }` opens the embed app's menu. The embed draws it (the app's
 * layout, or the `menu` prop) or the host draws its own from `items` and opens one with `open`; another item shows in
 * the same frame (`onItemChange`). Also the look props, the guard for the new messages, menu tokens on the server, and
 * the /testing stand-in speaking as a menu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { DataSquaresEmbed, type DataSquaresEmbedHandle } from '../src/DataSquaresEmbed.js'
import { useDataSquaresEmbed } from '../src/use-embed.js'
import { buildEmbedUrl, buildSessionEmbedUrl } from '../src/urls.js'
import { isEmbedOutMessage, type EmbedMenuItem } from '../src/protocol.js'
import { simulateEmbed } from '../src/testing.js'
import { signEmbedToken, type SignEmbedTokenInput } from '../src/server.js'

const BASE = 'https://app.datasquares.ai'
const ITEMS: EmbedMenuItem[] = [
  { id: 'a0000000-0000-4000-8000-000000000001', type: 'dashboard', name: 'Overview', section: 'Sales' },
  { id: 'a0000000-0000-4000-8000-000000000002', type: 'report', name: 'Monthly pack', section: null },
]
const getToken = () => Promise.resolve('signed.person.token')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the menu and look in the URL', () => {
  it('a session embed carries item, menu and the look; a share link the look', () => {
    const session = new URL(
      buildSessionEmbedUrl({ baseUrl: BASE, item: ITEMS[1]!.id, menu: 'none', theme: 'auto', tabs: false, background: 'transparent', font: 'inter', padding: 'compact' }),
    ).searchParams
    expect(Object.fromEntries(session)).toEqual({ theme: 'auto', tabs: 'false', background: 'transparent', font: 'inter', padding: 'compact', item: ITEMS[1]!.id, menu: 'none' })
    const share = new URL(buildEmbedUrl({ baseUrl: BASE, contentId: 'd', token: 't', font: 'system', tabs: true })).searchParams
    expect(share.get('font')).toBe('system')
    expect(share.get('tabs')).toBe('true')
  })

  it('the props reach the frame; item and menu only for a session embed', () => {
    const { container } = render(<DataSquaresEmbed baseUrl={BASE} getToken={getToken} item={ITEMS[0]!.id} menu="tabs" background="#ffffff" />)
    const q = new URL(container.querySelector('iframe')!.src).searchParams
    expect([q.get('item'), q.get('menu'), q.get('background')]).toEqual([ITEMS[0]!.id, 'tabs', '#ffffff'])
    cleanup()
    const share = render(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" item="x" menu="tabs" />)
    const s = new URL(share.container.querySelector('iframe')!.src).searchParams
    expect(s.has('item') || s.has('menu')).toBe(false)
  })
})

describe('the guard over the new messages', () => {
  it('a ready with a menu, a gallery\'s ready, and an item change pass; an embed before menus still passes', () => {
    expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'dashboard', pages: [], item: ITEMS[0], items: ITEMS })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'menu', pages: [], item: null, items: ITEMS })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:item-change', version: 1, item: ITEMS[1] })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'dashboard', pages: [] })).toBe(true)
  })

  it('refuses items a handler would misread', () => {
    const bad = [{ id: 1, type: 'dashboard', name: 'x', section: null }, { id: 'x', type: 'folder', name: 'x', section: null }, { id: 'x', type: 'report', name: 'x', section: 3 }, { id: 'x', type: 'report' }]
    for (const item of bad) {
      expect(isEmbedOutMessage({ type: 'ds:item-change', version: 1, item })).toBe(false)
      expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'dashboard', pages: [], item, items: [] })).toBe(false)
      expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'dashboard', pages: [], item: null, items: [item] })).toBe(false)
    }
    expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'menu', pages: [], items: 'all' })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'folder', pages: [] })).toBe(false)
  })
})

describe('a menu in the component', () => {
  it('onReady hears the items and the item shown; onItemChange hears another', () => {
    const onReady = vi.fn()
    const onItemChange = vi.fn()
    const { container } = render(<DataSquaresEmbed baseUrl={BASE} getToken={getToken} onReady={onReady} onItemChange={onItemChange} />)
    const embed = simulateEmbed(container.querySelector('iframe')!)
    embed.ready({ item: ITEMS[0], items: ITEMS })
    expect(onReady).toHaveBeenCalledWith({ contentType: 'dashboard', pages: [], item: ITEMS[0], items: ITEMS })
    embed.itemChange(ITEMS[1]!)
    expect(onItemChange).toHaveBeenCalledWith(ITEMS[1])
  })

  it('open() waits until the embed listens, and only the last one waits', () => {
    const ref = createRef<DataSquaresEmbedHandle>()
    const { container } = render(<DataSquaresEmbed ref={ref} baseUrl={BASE} getToken={getToken} />)
    const embed = simulateEmbed(container.querySelector('iframe')!)
    ref.current!.open(ITEMS[0]!.id)
    ref.current!.open(ITEMS[1]!.id)
    expect(embed.commands).toEqual([])
    embed.resize(400)
    expect(embed.commands).toEqual([{ type: 'ds:open', version: 1, itemId: ITEMS[1]!.id }])
  })

  it('in development, open() with an id not in the menu, or on an embed of one item, says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ref = createRef<DataSquaresEmbedHandle>()
    const { container } = render(<DataSquaresEmbed ref={ref} baseUrl={BASE} getToken={getToken} />)
    const embed = simulateEmbed(container.querySelector('iframe')!)
    embed.ready({ item: ITEMS[0], items: ITEMS })
    ref.current!.open(ITEMS[1]!.id)
    expect(warn).not.toHaveBeenCalled()
    ref.current!.open('nope')
    ref.current!.open('nope')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/no item of this person's menu/)
    embed.ready({})
    ref.current!.open('other')
    expect(String(warn.mock.calls[1]![0])).toMatch(/shows one item/)
  })
})

function HostMenu() {
  const embed = useDataSquaresEmbed()
  return (
    <>
      <nav aria-label="Reports">
        {embed.items.map((i) => (
          <button key={i.id} aria-current={embed.item?.id === i.id ? 'page' : undefined} onClick={() => embed.open(i.id)}>
            {i.name}
          </button>
        ))}
      </nav>
      <p data-testid="shows">{embed.contentType ?? 'nothing'}</p>
      <DataSquaresEmbed {...embed.bind} baseUrl={BASE} getToken={getToken} menu="none" />
    </>
  )
}

describe('your own menu, with useDataSquaresEmbed()', () => {
  it('draws from items and item, opens with open(), and follows item changes and a gallery', () => {
    const { container } = render(<HostMenu />)
    const embed = simulateEmbed(container.querySelector('iframe')!)
    embed.ready({ item: ITEMS[0], items: ITEMS })
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Monthly pack' }))
    expect(embed.commands).toContainEqual({ type: 'ds:open', version: 1, itemId: ITEMS[1]!.id })
    embed.itemChange(ITEMS[1]!)
    expect(screen.getByRole('button', { name: 'Monthly pack' }).getAttribute('aria-current')).toBe('page')
    // The embed's gallery (a menu with none open) is ready as a menu.
    embed.ready({ contentType: 'menu', item: null, items: ITEMS })
    expect(screen.getByTestId('shows').textContent).toBe('menu')
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBeNull()
  })
})

describe('menu tokens on your server', () => {
  const KEY = { clientId: 'dsapp_0123456789abcdef01234567', keyId: '5d0c1a52-2a4c-4e0b-9f53-6f4c3b9a1e01', secret: 'dssk_' + 'k'.repeat(43) }
  const decode = (part: string) =>
    JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))
  const sign = (content: unknown) => signEmbedToken({ ...KEY, sub: 'person-1', content } as SignEmbedTokenInput)

  it('signs the whole menu, or some of its items', async () => {
    expect(decode((await sign({ type: 'menu' })).split('.')[1]!).content).toEqual({ type: 'menu' })
    const some = { type: 'menu', items: ITEMS.map((i) => i.id) }
    expect(decode((await sign(some)).split('.')[1]!).content).toEqual(some)
  })

  it('refuses, naming the field, items DataSquares would refuse', async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const cases: Array<[unknown, string]> = [
      [{ type: 'menu', items: [] }, 'content.items'],
      [{ type: 'menu', items: ids(101) }, 'content.items'],
      [{ type: 'menu', items: 'all' }, 'content.items'],
      [{ type: 'menu', items: ['nope'] }, 'content.items[0]'],
      [{ type: 'menu', items: [ITEMS[0]!.id, ITEMS[0]!.id.toUpperCase()] }, 'content.items[1]'],
      [{ type: 'folder' }, 'content'],
    ]
    for (const [content, field] of cases) await expect(sign(content)).rejects.toMatchObject({ name: 'EmbedTokenInputError', field })
    await expect(sign({ type: 'menu', items: ids(100) })).resolves.toMatch(/^ey/)
  })
})
