/**
 * @vitest-environment jsdom
 *
 * <datasquares-chat> and <datasquares-embed>: the framework-free elements — defined on import, the frame on first show,
 * the person's token from `token-url` (or `getToken`), the chat's three modes and its own switches (cancelable), the
 * commands waiting until the frame listens, `context` and `follows`, the DOM events, an embed's share link and session,
 * auto-height and getState, and messages from anywhere else ignored.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import '../src/element.js'
import { DataSquaresChatElement, DataSquaresEmbedElement, defineDataSquaresElements } from '../src/element.js'
import { simulateChat, simulateEmbed } from '../src/testing.js'

const BASE = 'https://app.datasquares.ai'
const now = (run: () => void) => run()
const ITEM = { id: 'a0000000-0000-4000-8000-000000000001', type: 'dashboard' as const, name: 'Overview', section: null }

function chat(attrs: Record<string, string> = {}): DataSquaresChatElement {
  const el = document.createElement('datasquares-chat')
  el.setAttribute('base-url', BASE)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.append(el)
  return el
}
const frameOf = (el: HTMLElement) => el.shadowRoot!.querySelector('iframe')
const launcherOf = (el: HTMLElement) => el.shadowRoot!.querySelector<HTMLButtonElement>('button.launcher')!
const events = (el: HTMLElement, name: string) => {
  const heard: unknown[] = []
  el.addEventListener(name, (e) => heard.push((e as CustomEvent).detail))
  return heard
}

afterEach(() => {
  document.body.replaceChildren()
  document.body.style.overflow = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('defining the elements', () => {
  it('importing defines both, once; a name already defined keeps its own', () => {
    expect(customElements.get('datasquares-chat')).toBe(DataSquaresChatElement)
    expect(customElements.get('datasquares-embed')).toBe(DataSquaresEmbedElement)
    expect(() => defineDataSquaresElements()).not.toThrow()
  })
})

describe('<datasquares-chat>', () => {
  it('a panel by default: a launcher, the frame on first open, its token from token-url, its mode told once it listens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('signed.person.token', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const el = chat({ 'token-url': '/analytics-token', 'launcher-label': 'Ask Acme' })
    expect(launcherOf(el).hidden).toBe(false)
    expect(launcherOf(el).textContent).toBe('Ask Acme')
    expect(frameOf(el)).toBeNull()
    launcherOf(el).click()
    expect(el.open).toBe(true)
    expect(launcherOf(el).hidden).toBe(true)
    const frame = frameOf(el)!
    expect(new URL(frame.src).pathname).toBe('/embed/chat')
    expect(frame.src).not.toMatch(/token/)
    const sim = simulateChat(frame, { act: now })
    expect(sim.commands).toEqual([])
    await expect(sim.requestToken()).resolves.toBe('signed.person.token')
    expect(fetchMock).toHaveBeenCalledWith('/analytics-token', expect.objectContaining({ credentials: 'same-origin' }))
    expect(sim.commands).toContainEqual({ type: 'ds:set-mode', version: 1, mode: 'panel' })
  })

  it('takes a token as JSON too, or from a getToken function', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"token":"from.json"}', { status: 200 })))
    const a = chat({ 'token-url': '/t', mode: 'inline' })
    await expect(simulateChat(frameOf(a)!, { act: now }).requestToken()).resolves.toBe('from.json')
    const b = chat({ mode: 'inline' })
    b.getToken = () => Promise.resolve('from.function')
    await expect(simulateChat(frameOf(b)!, { act: now }).requestToken()).resolves.toBe('from.function')
  })

  it('carries its words in the address, and never a token', () => {
    const el = chat({ mode: 'inline', 'chat-title': 'Acme assistant', greeting: 'Hello', suggestions: '["One","Two"]', scope: 'view', item: ITEM.id, theme: 'dark' })
    const url = new URL(frameOf(el)!.src)
    expect(url.searchParams.get('title')).toBe('Acme assistant')
    expect(url.searchParams.getAll('suggestion')).toEqual(['One', 'Two'])
    expect(url.searchParams.get('scope')).toBe('view')
    expect(url.searchParams.get('theme')).toBe('dark')
  })

  it('the chat\'s own switches: full screen and back (Esc too, the page not scrolling meanwhile), Minimize folds the panel', () => {
    const el = chat({ open: '' })
    const sim = simulateChat(frameOf(el)!, { act: now })
    const modes = events(el, 'ds-mode-change')
    sim.ready()
    sim.requestMode('fullscreen')
    expect(el.mode).toBe('fullscreen')
    expect(document.body.style.overflow).toBe('hidden')
    expect(sim.commands).toContainEqual({ type: 'ds:set-mode', version: 1, mode: 'fullscreen', exitTo: 'panel' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(el.mode).toBe('panel')
    expect(document.body.style.overflow).toBe('')
    expect(modes).toEqual([{ mode: 'fullscreen' }, { mode: 'panel' }])
    sim.requestMode('minimized')
    expect(el.open).toBe(false)
    // The frame stays, and with it the conversation.
    expect(frameOf(el)).not.toBeNull()
  })

  it('a page that cancels ds-mode-change keeps the mode it chose', () => {
    const el = chat({ mode: 'inline' })
    el.addEventListener('ds-mode-change', (e) => e.preventDefault())
    const sim = simulateChat(frameOf(el)!, { act: now })
    sim.ready()
    sim.requestMode('fullscreen')
    expect(el.mode).toBe('inline')
  })

  it('commands wait until the chat listens; ask() opens a folded panel', () => {
    const el = chat()
    el.ask('Who leads?')
    expect(el.open).toBe(true)
    const sim = simulateChat(frameOf(el)!, { act: now })
    expect(sim.commands).toEqual([])
    sim.ready()
    expect(sim.commands).toContainEqual({ type: 'ds:ask', version: 1, question: 'Who leads?' })
    el.newConversation()
    el.openConversation('c-1')
    expect(sim.commands.slice(-2)).toEqual([{ type: 'ds:new-conversation', version: 1 }, { type: 'ds:open-conversation', version: 1, conversationId: 'c-1' }])
  })

  it('tells the chat what the person is looking at, within its bounds, and again after a reload', () => {
    const el = chat({ mode: 'inline' })
    el.context = { itemId: ITEM.id, filters: [{ fieldId: 'orders.region', operator: 'eq', value: 'West' }, { fieldId: '', operator: 'eq' }], note: 'x'.repeat(301) }
    const sim = simulateChat(frameOf(el)!, { act: now })
    sim.ready()
    expect(sim.context).toEqual({ itemId: ITEM.id, filters: [{ fieldId: 'orders.region', operator: 'eq', value: 'West' }] })
    el.reload()
    const again = simulateChat(frameOf(el)!, { act: now })
    again.ready()
    expect(again.context).toEqual({ itemId: ITEM.id, filters: [{ fieldId: 'orders.region', operator: 'eq', value: 'West' }] })
    el.setContext(null)
    expect(again.context).toBeNull()
  })

  it('says what happened as DOM events', () => {
    const el = chat({ mode: 'inline' })
    const sim = simulateChat(frameOf(el)!, { act: now })
    const ready = events(el, 'ds-ready')
    const answers = events(el, 'ds-answer')
    const ratings = events(el, 'ds-feedback')
    const picks = events(el, 'ds-follow-up')
    const limits = events(el, 'ds-limit')
    const conversations = events(el, 'ds-conversation-change')
    sim.ready({ items: [ITEM] })
    sim.conversationChange('c-1')
    sim.answer({ question: 'Who leads?', answer: 'North.', conversationId: 'c-1', followUps: ['Show it as a chart.'], answerIndex: 0 })
    sim.feedback({ conversationId: 'c-1', rating: 'down', reason: 'incomplete', note: 'More please' })
    sim.followUp({ question: 'Show it as a chart.', conversationId: 'c-1' })
    sim.limit({ code: 'EMBED_AI_RATE_LIMITED', scope: 'person', message: 'Later.' })
    expect(ready).toEqual([{ items: [ITEM] }])
    expect(conversations).toEqual([{ conversationId: 'c-1' }])
    expect(answers).toEqual([{ question: 'Who leads?', answer: 'North.', conversationId: 'c-1', blocked: false, followUps: ['Show it as a chart.'], answerIndex: 0 }])
    expect(ratings).toEqual([{ conversationId: 'c-1', answerIndex: 0, rating: 'down', reason: 'incomplete', note: 'More please' }])
    expect(picks).toEqual([{ conversationId: 'c-1', question: 'Show it as a chart.', source: 'follow-up' }])
    expect(limits).toEqual([{ code: 'EMBED_AI_RATE_LIMITED', scope: 'person', message: 'Later.' }])
    expect(el.status).toBe('ready')
  })

  it('ignores messages from another window or another origin', () => {
    const el = chat({ mode: 'inline' })
    const frame = frameOf(el)!
    simulateChat(frame, { act: now })
    const answers = events(el, 'ds-answer')
    const data = { type: 'ds:chat-answer', version: 1, conversationId: null, question: 'q', answer: 'a', blocked: false }
    const fromElsewhere = new MessageEvent('message', { data, origin: 'https://evil.example' })
    Object.defineProperty(fromElsewhere, 'source', { value: frame.contentWindow })
    window.dispatchEvent(fromElsewhere)
    window.dispatchEvent(new MessageEvent('message', { data, origin: BASE }))
    expect(answers).toEqual([])
  })

  it('follows a <datasquares-embed>: its item and the filters set become the chat\'s context', () => {
    const embed = document.createElement('datasquares-embed')
    embed.id = 'board'
    embed.setAttribute('base-url', BASE)
    embed.setAttribute('token-url', '/t')
    document.body.append(embed)
    const el = chat({ mode: 'inline', follows: 'board' })
    const chatSim = simulateChat(frameOf(el)!, { act: now })
    chatSim.ready()
    const embedSim = simulateEmbed(frameOf(embed)!, { act: now })
    embedSim.ready({ contentType: 'menu', item: ITEM, items: [ITEM] })
    expect(chatSim.context).toEqual({ itemId: ITEM.id })
    embedSim.filterChange([{ fieldId: 'orders.region', operator: 'eq', value: 'West' }])
    expect(chatSim.context).toEqual({ itemId: ITEM.id, filters: [{ fieldId: 'orders.region', operator: 'eq', value: 'West' }] })
  })

  it('a token-url that fails is an invalid error the page hears', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })))
    const el = chat({ mode: 'inline', 'token-url': '/t' })
    const errors = events(el, 'ds-error')
    simulateChat(frameOf(el)!, { act: now }).send({ type: 'ds:token-request', version: 1, reason: 'start' })
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toMatchObject({ kind: 'invalid' })
  })
})

describe('<datasquares-embed>', () => {
  it('a person\'s session: the session address, the token on request, the events, and commands that wait', async () => {
    const el = document.createElement('datasquares-embed')
    el.setAttribute('base-url', BASE)
    el.setAttribute('menu', 'tabs')
    el.setAttribute('params', '{"region":"West"}')
    el.getToken = () => Promise.resolve('signed.person.token')
    document.body.append(el)
    const frame = frameOf(el)!
    const url = new URL(frame.src)
    expect(url.pathname).toBe('/embed/session')
    expect(url.searchParams.get('menu')).toBe('tabs')
    expect(url.searchParams.get('p_region')).toBe('West')
    const sim = simulateEmbed(frame, { act: now })
    el.setPage('p2')
    el.open(ITEM.id)
    expect(sim.commands).toEqual([])
    await expect(sim.requestToken()).resolves.toBe('signed.person.token')
    const items = events(el, 'ds-item-change')
    const filters = events(el, 'ds-filter-change')
    sim.ready({ contentType: 'menu', item: ITEM, items: [ITEM] })
    expect(sim.commands).toEqual(expect.arrayContaining([{ type: 'ds:set-page', version: 1, pageId: 'p2' }, { type: 'ds:open', version: 1, itemId: ITEM.id }]))
    sim.itemChange(ITEM)
    sim.filterChange([{ fieldId: 'f', operator: 'eq', value: 1 }])
    expect(items).toEqual([{ item: ITEM }])
    expect(filters).toEqual([{ filters: [{ fieldId: 'f', operator: 'eq', value: 1 }] }])
  })

  it('a share link: its content in the path and its token in the query; auto-height grows to the content', () => {
    const el = document.createElement('datasquares-embed')
    el.setAttribute('base-url', BASE)
    el.setAttribute('share-token', 'shr_abc')
    el.setAttribute('content-id', 'dash-1')
    el.setAttribute('auto-height', '')
    document.body.append(el)
    const frame = frameOf(el)!
    const url = new URL(frame.src)
    expect(url.pathname).toBe('/embed/dash-1')
    expect(url.searchParams.get('token')).toBe('shr_abc')
    const sim = simulateEmbed(frame, { act: now })
    sim.ready()
    sim.resize(812.4)
    expect((el.shadowRoot!.querySelector('[part="box"]') as HTMLElement).style.height).toBe('813px')
  })

  it('getState() answers with the embed\'s page and parameters', async () => {
    const el = document.createElement('datasquares-embed')
    el.setAttribute('base-url', BASE)
    el.setAttribute('token-url', '/t')
    document.body.append(el)
    const sim = simulateEmbed(frameOf(el)!, { act: now, state: { pageId: 'p1', params: { region: 'West' } } })
    sim.ready()
    await expect(el.getState()).resolves.toEqual({ pageId: 'p1', params: { region: 'West' } })
  })

  it('takes no chat ready as its own', () => {
    const el = document.createElement('datasquares-embed')
    el.setAttribute('base-url', BASE)
    document.body.append(el)
    const ready = events(el, 'ds-ready')
    simulateChat(frameOf(el)!, { act: now }).ready()
    expect(ready).toEqual([])
  })
})
