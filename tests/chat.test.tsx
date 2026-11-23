/**
 * @vitest-environment jsdom
 *
 * <DataSquaresChat>: the AI chat in a DataSquares frame — its URL, the three modes on one frame (a conversation carries
 * across a switch), the panel's launcher and the chat's own Minimize / Full screen / Exit, Esc, the person's token on
 * request, the events, the commands waiting until the chat listens, the hook, the guard over the chat's messages, and
 * the /testing stand-in.
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
})

describe('the chat\'s events', () => {
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
    expect(onAnswer).toHaveBeenCalledWith({ question: 'Who leads?', answer: 'North.', conversationId: 'c-1', blocked: false })
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

  it('the dashboard embed takes no chat ready as its own', async () => {
    const { DataSquaresEmbed } = await import('../src/DataSquaresEmbed.js')
    const onReady = vi.fn()
    render(<DataSquaresEmbed baseUrl={BASE} getToken={getToken} onReady={onReady} />)
    simulateChat(frame()).ready()
    expect(onReady).not.toHaveBeenCalled()
  })
})
