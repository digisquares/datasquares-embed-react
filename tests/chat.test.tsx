/**
 * @vitest-environment jsdom
 *
 * <DataSquaresChat>: the AI chat in a DataSquares frame — its URL, the three modes on one frame (a conversation carries
 * across a switch), the panel's launcher and the chat's own Minimize / Full screen / Exit, Esc, the person's token on
 * request, the events, the commands waiting until the chat listens, the hook, the guard over the chat's messages, and
 * the /testing stand-in. Phase 2: what the person is looking at (`context`, setContext), ratings and follow-ups heard.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import { DataSquaresChat, type DataSquaresChatHandle } from '../src/DataSquaresChat.js'
import { useDataSquaresChat } from '../src/use-chat.js'
import { buildChatUrl } from '../src/urls.js'
import { isEmbedOutMessage, type EmbedMenuItem } from '../src/protocol.js'
import { simulateChat } from '../src/testing.js'

const BASE = 'https://app.datasquares.ai'
const getToken = () => Promise.resolve('signed.person.token')
const ITEMS: EmbedMenuItem[] = [{ id: 'a0000000-0000-4000-8000-000000000001', type: 'dashboard', name: 'Overview', section: null }]
const frame = () => document.querySelector('iframe')!
const launcher = () => screen.queryByRole('button', { name: 'Ask AI' })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.body.style.overflow = ''
})

describe('the chat URL', () => {
  it('carries the look, what it asks about and its words, and never a token', () => {
    const url = new URL(
      buildChatUrl({
        baseUrl: `${BASE}/some/path`,
        theme: 'auto',
        primaryColor: '0a7cff',
        font: 'inter',
        scope: 'view',
        item: ITEMS[0]!.id,
        title: 'Acme assistant',
        greeting: 'Hello',
        placeholder: 'Type here',
        suggestions: ['One', ' ', 'Two', 'Three', 'Four', 'Five'],
        conversation: 'c-1',
      }),
    )
    expect(url.origin + url.pathname).toBe(`${BASE}/embed/chat`)
    expect(url.searchParams.getAll('suggestion')).toEqual(['One', 'Two', 'Three'])
    expect(Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'suggestion'))).toEqual({
      theme: 'auto',
      primaryColor: '0a7cff',
      font: 'inter',
      scope: 'view',
      item: ITEMS[0]!.id,
      title: 'Acme assistant',
      greeting: 'Hello',
      placeholder: 'Type here',
      conversation: 'c-1',
    })
    expect(url.search).not.toMatch(/token/)
  })
})

describe('a panel (the default)', () => {
  it('shows a launcher; the frame loads when the panel first opens, then the chat hears its mode', async () => {
    render(<DataSquaresChat baseUrl={BASE} getToken={getToken} />)
    expect(launcher()).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    fireEvent.click(launcher()!)
    expect(launcher()).toBeNull()
    const chat = simulateChat(frame())
    expect(chat.commands).toEqual([])
    await expect(chat.requestToken()).resolves.toBe('signed.person.token')
    expect(chat.commands).toContainEqual({ type: 'ds:set-mode', version: 1, mode: 'panel' })
    expect(frame().closest('[data-ds-chat-mode]')!.getAttribute('data-ds-chat-mode')).toBe('panel')
    expect(frame().closest('[role="dialog"]')).toBeTruthy()
  })

  it('the chat\'s Minimize folds it to the launcher, keeping the frame (and its conversation)', () => {
    const onOpenChange = vi.fn()
    render(<DataSquaresChat baseUrl={BASE} getToken={getToken} defaultOpen onOpenChange={onOpenChange} />)
    const before = frame()
    const chat = simulateChat(before)
    chat.ready()
    chat.requestMode('minimized')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(launcher()).toBeTruthy()
    expect((before.closest('[data-ds-chat-mode]') as HTMLElement).style.display).toBe('none')
    fireEvent.click(launcher()!)
    expect(frame()).toBe(before)
  })

  it('ask() opens a folded panel, and the question waits until the chat listens', () => {
    const ref = createRef<DataSquaresChatHandle>()
    render(<DataSquaresChat ref={ref} baseUrl={BASE} getToken={getToken} />)
    act(() => ref.current!.ask('  How did sales do?  '))
    expect(launcher()).toBeNull()
    const chat = simulateChat(frame())
    expect(chat.commands).toEqual([])
    chat.ready()
    expect(chat.commands).toContainEqual({ type: 'ds:ask', version: 1, question: 'How did sales do?' })
  })

  it('sits at the bottom left when asked, in your colour', () => {
    render(<DataSquaresChat baseUrl={BASE} getToken={getToken} position="bottom-left" primaryColor="0a7cff" launcherLabel="Help" />)
    const button = screen.getByRole('button', { name: 'Help' })
    expect(button.style.left).toBe('20px')
    expect(button.style.background).toBe('rgb(10, 124, 255)')
  })
})

describe('the three modes on one frame', () => {
  it('full screen from a panel and back: the same frame, Esc, and the page behind does not scroll meanwhile', () => {
    const onModeChange = vi.fn()
    render(<DataSquaresChat baseUrl={BASE} getToken={getToken} defaultOpen onModeChange={onModeChange} />)
    const before = frame()
    const chat = simulateChat(before)
    chat.ready()
    chat.requestMode('fullscreen')
    expect(onModeChange).toHaveBeenLastCalledWith('fullscreen')
    expect(frame()).toBe(before)
    expect(chat.commands).toContainEqual({ type: 'ds:set-mode', version: 1, mode: 'fullscreen', exitTo: 'panel' })
    expect(document.body.style.overflow).toBe('hidden')
    const box = before.closest('[data-ds-chat-mode]') as HTMLElement
    expect(box.style.position).toBe('fixed')
    expect(box.getAttribute('aria-modal')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onModeChange).toHaveBeenLastCalledWith('panel')
    expect(frame()).toBe(before)
    expect(document.body.style.overflow).toBe('')
  })

  it('inline fills its box from the start; full screen goes back to inline', () => {
    const ref = createRef<DataSquaresChatHandle>()
    render(<DataSquaresChat ref={ref} baseUrl={BASE} getToken={getToken} defaultMode="inline" height={480} />)
    const box = frame().closest('[data-ds-chat-mode]') as HTMLElement
    expect(box.style.height).toBe('480px')
    expect(box.getAttribute('role')).toBeNull()
    expect(launcher()).toBeNull()
    const chat = simulateChat(frame())
    chat.ready()
    act(() => ref.current!.setMode('fullscreen'))
    expect(chat.commands).toContainEqual({ type: 'ds:set-mode', version: 1, mode: 'fullscreen', exitTo: 'inline' })
    chat.requestMode('inline')
    expect(frame().closest('[data-ds-chat-mode]')!.getAttribute('data-ds-chat-mode')).toBe('inline')
  })

  it('a host controlling mode itself: full screen entered from inline goes back to inline (review)', () => {
    const onModeChange = vi.fn()
    const { rerender } = render(<DataSquaresChat baseUrl={BASE} getToken={getToken} mode="inline" onModeChange={onModeChange} />)
    const chat = simulateChat(frame())
    chat.ready()
    rerender(<DataSquaresChat baseUrl={BASE} getToken={getToken} mode="fullscreen" onModeChange={onModeChange} />)
    expect(chat.commands).toContainEqual({ type: 'ds:set-mode', version: 1, mode: 'fullscreen', exitTo: 'inline' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onModeChange).toHaveBeenLastCalledWith('inline')
  })
})

describe('what the person is looking at', () => {
  const FILTERS = [{ fieldId: 'orders.region', operator: 'eq', value: 'West' }]

  it('the context prop reaches the chat once it listens, again when its contents change, and after a reload', async () => {
    const ref = createRef<DataSquaresChatHandle>()
    const { rerender } = render(<DataSquaresChat ref={ref} baseUrl={BASE} getToken={getToken} defaultMode="inline" context={{ itemId: ITEMS[0]!.id, filters: FILTERS }} />)
    const chat = simulateChat(frame())
    expect(chat.commands.filter((c) => c.type === 'ds:set-context')).toEqual([])
    await chat.requestToken()
    expect(chat.context).toEqual({ itemId: ITEMS[0]!.id, filters: FILTERS })
    const before = chat.commands.filter((c) => c.type === 'ds:set-context').length
    // The same contents in a new object: nothing new is sent.
    rerender(<DataSquaresChat ref={ref} baseUrl={BASE} getToken={getToken} defaultMode="inline" context={{ itemId: ITEMS[0]!.id, filters: [...FILTERS] }} />)
    expect(chat.commands.filter((c) => c.type === 'ds:set-context')).toHaveLength(before)
    rerender(<DataSquaresChat ref={ref} baseUrl={BASE} getToken={getToken} defaultMode="inline" context={{ note: 'Invoices page', label: 'Invoices' }} />)
    expect(chat.context).toEqual({ note: 'Invoices page', label: 'Invoices' })
    act(() => ref.current!.reload())
    const again = simulateChat(frame())
    await again.requestToken()
    expect(again.context).toEqual({ note: 'Invoices page', label: 'Invoices' })
  })

  it('setContext() tells it imperatively; what is past the chat\'s bounds is left out; null clears it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ref = createRef<DataSquaresChatHandle>()
    render(<DataSquaresChat ref={ref} baseUrl={BASE} getToken={getToken} defaultMode="inline" />)
    const chat = simulateChat(frame())
    await chat.requestToken()
    act(() => ref.current!.setContext({ itemId: 'x'.repeat(65), cardId: 'c1', note: 'n', filters: [...FILTERS, { fieldId: '', operator: 'eq' }] }))
    expect(chat.context).toEqual({ cardId: 'c1', note: 'n', filters: FILTERS })
    expect(warn).toHaveBeenCalled()
    act(() => ref.current!.setContext(null))
    expect(chat.context).toBeNull()
  })
})

describe('the chat\'s events', () => {
  it('phase 2: a rating, a follow-up or suggestion picked, and the follow-ups an answer offers', () => {
    const onFeedback = vi.fn()
    const onFollowUp = vi.fn()
    const onAnswer = vi.fn()
    render(<DataSquaresChat baseUrl={BASE} getToken={getToken} defaultMode="inline" onFeedback={onFeedback} onFollowUp={onFollowUp} onAnswer={onAnswer} />)
    const chat = simulateChat(frame())
    chat.answer({ question: 'Who leads?', answer: 'North.', conversationId: 'c-1', followUps: ['Show it as a chart.'], answerIndex: 2 })
    expect(onAnswer).toHaveBeenCalledWith({ question: 'Who leads?', answer: 'North.', conversationId: 'c-1', blocked: false, followUps: ['Show it as a chart.'], answerIndex: 2 })
    chat.feedback({ conversationId: 'c-1', answerIndex: 2, rating: 'down', reason: 'wrong_number', note: 'South leads' })
    expect(onFeedback).toHaveBeenCalledWith({ conversationId: 'c-1', answerIndex: 2, rating: 'down', reason: 'wrong_number', note: 'South leads' })
    chat.followUp({ question: 'Show it as a chart.', conversationId: 'c-1' })
    chat.followUp({ question: 'What stands out?', source: 'suggestion' })
    expect(onFollowUp.mock.calls.map((c) => c[0])).toEqual([
      { conversationId: 'c-1', question: 'Show it as a chart.', source: 'follow-up' },
      { conversationId: null, question: 'What stands out?', source: 'suggestion' },
    ])
  })

  it('ready with the menu it asks about, each answer, the conversation, and a limit', () => {
    const onReady = vi.fn()
    const onAnswer = vi.fn()
    const onConversationChange = vi.fn()
    const onLimitReached = vi.fn()
    render(<DataSquaresChat baseUrl={BASE} getToken={getToken} defaultMode="inline" onReady={onReady} onAnswer={onAnswer} onConversationChange={onConversationChange} onLimitReached={onLimitReached} />)
    const chat = simulateChat(frame())
    chat.ready({ items: ITEMS })
    expect(onReady).toHaveBeenCalledWith({ items: ITEMS })
    chat.conversationChange('c-1')
    expect(onConversationChange).toHaveBeenCalledWith('c-1')
    chat.answer({ question: 'Who leads?', answer: 'North.', conversationId: 'c-1' })
    expect(onAnswer).toHaveBeenCalledWith({ question: 'Who leads?', answer: 'North.', conversationId: 'c-1', blocked: false, followUps: [], answerIndex: null })
    chat.limit({ code: 'EMBED_AI_RATE_LIMITED', scope: 'tenant', message: 'Later.' })
    expect(onLimitReached).toHaveBeenCalledWith({ code: 'EMBED_AI_RATE_LIMITED', scope: 'tenant', message: 'Later.' })
  })

  it('a chat that cannot start is an error, with your fallback over the frame', () => {
    const onError = vi.fn()
    render(<DataSquaresChat baseUrl={BASE} getToken={getToken} defaultMode="inline" onError={onError} errorFallback={(e) => <p>Chat failed: {e.kind}</p>} />)
    simulateChat(frame()).error('forbidden')
    expect(onError).toHaveBeenCalledWith({ kind: 'forbidden' })
    expect(screen.getByText('Chat failed: forbidden')).toBeTruthy()
  })

  it('a chat that never speaks is a timeout', () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    render(<DataSquaresChat baseUrl={BASE} getToken={getToken} defaultMode="inline" loadTimeoutMs={1000} onError={onError} />)
    fireEvent.load(frame())
    act(() => vi.advanceTimersByTime(1001))
    expect(onError.mock.calls[0]![0]).toMatchObject({ kind: 'timeout' })
  })
})

function Host() {
  const chat = useDataSquaresChat({ defaultMode: 'inline' })
  return (
    <>
      <button onClick={() => chat.ask('Asked from my page')}>Ask from the page</button>
      <button onClick={() => chat.setMode('fullscreen')}>Big</button>
      <button onClick={() => chat.setContext({ itemId: 'd1', label: 'Overview' })}>Context</button>
      <p data-testid="state">{[chat.status, chat.mode, chat.conversationId ?? 'none', chat.lastAnswer?.answer ?? '-', String(chat.items.length)].join('|')}</p>
      <DataSquaresChat {...chat.bind} baseUrl={BASE} getToken={getToken} />
    </>
  )
}

describe('useDataSquaresChat()', () => {
  it('drives the chat from your page and reads its state', () => {
    render(<Host />)
    const chat = simulateChat(frame())
    expect(screen.getByTestId('state').textContent).toBe('loading|inline|none|-|0')
    chat.ready({ items: ITEMS })
    fireEvent.click(screen.getByText('Ask from the page'))
    expect(chat.commands).toContainEqual({ type: 'ds:ask', version: 1, question: 'Asked from my page' })
    chat.conversationChange('c-9')
    chat.answer({ question: 'Asked from my page', answer: 'Here it is.', conversationId: 'c-9' })
    expect(screen.getByTestId('state').textContent).toBe('ready|inline|c-9|Here it is.|1')
    fireEvent.click(screen.getByText('Big'))
    expect(screen.getByTestId('state').textContent).toBe('ready|fullscreen|c-9|Here it is.|1')
    chat.requestMode('inline')
    expect(screen.getByTestId('state').textContent).toBe('ready|inline|c-9|Here it is.|1')
    fireEvent.click(screen.getByText('Context'))
    expect(chat.context).toEqual({ itemId: 'd1', label: 'Overview' })
  })
})

describe('the guard over the chat\'s messages', () => {
  it('passes the chat\'s shapes and refuses others', () => {
    expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'chat', pages: [], item: null, items: ITEMS })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:chat-answer', version: 1, conversationId: null, question: 'q', answer: 'a', blocked: false })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:conversation-change', version: 1, conversationId: 'c' })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:chat-limit', version: 1, code: 'EMBED_AI_BUDGET_REACHED', scope: 'person', message: 'm' })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:mode-request', version: 1, mode: 'minimized' })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:chat-answer', version: 1, conversationId: 3, question: 'q', answer: 'a', blocked: false })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:chat-answer', version: 1, conversationId: null, question: 'q', answer: 'a' })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:chat-limit', version: 1, code: 'X', scope: 'everyone', message: 'm' })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:mode-request', version: 1, mode: 'huge' })).toBe(false)
  })

  it('phase 2: passes ratings, picks and an answer\'s follow-ups, and refuses their wrong shapes', () => {
    const feedback = { type: 'ds:chat-feedback', version: 1, conversationId: 'c', answerIndex: 0, rating: 'up', reason: null, note: null }
    expect(isEmbedOutMessage(feedback)).toBe(true)
    expect(isEmbedOutMessage({ ...feedback, rating: 'meh' })).toBe(false)
    expect(isEmbedOutMessage({ ...feedback, answerIndex: -1 })).toBe(false)
    expect(isEmbedOutMessage({ ...feedback, reason: 'bored' })).toBe(false)
    const pick = { type: 'ds:chat-follow-up', version: 1, conversationId: null, question: 'q', source: 'suggestion' }
    expect(isEmbedOutMessage(pick)).toBe(true)
    expect(isEmbedOutMessage({ ...pick, source: 'typed' })).toBe(false)
    const answer = { type: 'ds:chat-answer', version: 1, conversationId: null, question: 'q', answer: 'a', blocked: false }
    expect(isEmbedOutMessage({ ...answer, followUps: ['x'], answerIndex: 1 })).toBe(true)
    expect(isEmbedOutMessage({ ...answer, followUps: [1] })).toBe(false)
    expect(isEmbedOutMessage({ ...answer, answerIndex: 1.5 })).toBe(false)
  })

  it('the dashboard embed takes no chat ready as its own', async () => {
    const { DataSquaresEmbed } = await import('../src/DataSquaresEmbed.js')
    const onReady = vi.fn()
    render(<DataSquaresEmbed baseUrl={BASE} getToken={getToken} onReady={onReady} />)
    simulateChat(frame()).ready()
    expect(onReady).not.toHaveBeenCalled()
  })
})
