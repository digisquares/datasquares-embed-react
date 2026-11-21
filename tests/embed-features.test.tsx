/**
 * @vitest-environment jsdom
 *
 * 0.4: the page to open on, an embed that never speaks (timeout), the status and the fallbacks drawn from it,
 * reload and full screen, the development warnings, useDataSquaresEmbed(), and the /testing stand-in driving it all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'
import { DataSquaresEmbed, type DataSquaresEmbedHandle } from '../src/DataSquaresEmbed.js'
import { useDataSquaresEmbed } from '../src/use-embed.js'
import { buildEmbedUrl, buildSessionEmbedUrl } from '../src/urls.js'
import { simulateEmbed } from '../src/testing.js'

const BASE = 'https://app.datasquares.ai'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the page to open on', () => {
  it('rides both URLs as ?page=', () => {
    expect(new URL(buildEmbedUrl({ baseUrl: BASE, contentId: 'd', token: 't', page: 'p2' })).searchParams.get('page')).toBe('p2')
    expect(new URL(buildSessionEmbedUrl({ baseUrl: BASE, page: 'p3' })).searchParams.get('page')).toBe('p3')
    expect(new URL(buildSessionEmbedUrl({ baseUrl: BASE })).searchParams.has('page')).toBe(false)
  })

  it('is a prop of the component', () => {
    const { container } = render(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" page="sales" />)
    expect(new URL(container.querySelector('iframe')!.src).searchParams.get('page')).toBe('sales')
  })
})

describe('an embed that never speaks', () => {
  it('is a timeout, counted from when the frame loads, with the likely reasons', () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const onStatusChange = vi.fn()
    const { container } = render(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" onError={onError} onStatusChange={onStatusChange} />)
    act(() => vi.advanceTimersByTime(60_000))
    expect(onError).not.toHaveBeenCalled() // not loaded yet (a lazy frame may wait a long time)

    fireEvent.load(container.querySelector('iframe')!)
    act(() => vi.advanceTimersByTime(14_999))
    expect(onError).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onError).toHaveBeenCalledWith({ kind: 'timeout', cause: expect.any(Error) })
    expect(String(onError.mock.calls[0]![0].cause)).toMatch(/frame-src/)
    expect(onStatusChange).toHaveBeenLastCalledWith('error')
  })

  it('an embed that speaks in time is no timeout; loadTimeoutMs 0 turns it off', () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const first = render(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" onError={onError} />)
    const frame = first.container.querySelector('iframe')!
    const embed = simulateEmbed(frame)
    fireEvent.load(frame)
    embed.resize(500)
    act(() => vi.advanceTimersByTime(60_000))
    first.unmount()

    const second = render(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" onError={onError} loadTimeoutMs={0} />)
    fireEvent.load(second.container.querySelector('iframe')!)
    act(() => vi.advanceTimersByTime(60_000))
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('status and fallbacks', () => {
  it('loading, then ready; a new src loads again', () => {
    const onStatusChange = vi.fn()
    const { container, rerender } = render(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" onStatusChange={onStatusChange} />)
    simulateEmbed(container).ready()
    expect(onStatusChange.mock.calls.map((c) => c[0])).toEqual(['ready'])
    rerender(<DataSquaresEmbed baseUrl={BASE} contentId="d2" token="t" onStatusChange={onStatusChange} />)
    expect(onStatusChange).toHaveBeenLastCalledWith('loading')
  })

  it('with no fallback the iframe is the root, as before', () => {
    const { container } = render(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" className="mine" />)
    expect(container.firstElementChild!.tagName).toBe('IFRAME')
    expect(container.firstElementChild!.className).toBe('mine')
  })

  it('shows the loading fallback until ready, and the error fallback with a retry that reloads', () => {
    const { container } = render(
      <DataSquaresEmbed
        baseUrl={BASE}
        contentId="d"
        token="t"
        onError={() => {}}
        loadingFallback={<p>Loading analytics…</p>}
        errorFallback={(error, retry) => <button onClick={retry}>Failed ({error.kind}) — retry</button>}
      />,
    )
    expect(screen.getByText('Loading analytics…')).toBeTruthy()
    const firstFrame = container.querySelector('iframe')!
    const embed = simulateEmbed(firstFrame)
    embed.ready()
    expect(screen.queryByText('Loading analytics…')).toBeNull()

    embed.error('expired')
    fireEvent.click(screen.getByText('Failed (expired) — retry'))
    // A new frame, loading again.
    expect(container.querySelector('iframe')).not.toBe(firstFrame)
    expect(screen.getByText('Loading analytics…')).toBeTruthy()
  })

  it('never covers the password the embed asks for itself', () => {
    const { container } = render(
      <DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" onError={() => {}} errorFallback={<p>Something went wrong</p>} />,
    )
    simulateEmbed(container).error('password-required')
    expect(screen.queryByText('Something went wrong')).toBeNull()
  })

  it("a renewal's getToken failing leaves a showing embed ready", async () => {
    const onStatusChange = vi.fn()
    const onError = vi.fn()
    const { container } = render(
      <DataSquaresEmbed baseUrl={BASE} getToken={async () => Promise.reject(new Error('down'))} onError={onError} onStatusChange={onStatusChange} />,
    )
    const embed = simulateEmbed(container)
    embed.ready()
    embed.send({ type: 'ds:token-request', version: 1, reason: 'renew' })
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onStatusChange).toHaveBeenLastCalledWith('ready')
  })
})

describe('reload and full screen', () => {
  it('reload gives a new frame, and commands wait for its page', () => {
    const ref = createRef<DataSquaresEmbedHandle>()
    const { container } = render(<DataSquaresEmbed ref={ref} baseUrl={BASE} contentId="d" token="t" />)
    simulateEmbed(container).ready()
    act(() => ref.current!.reload())
    const embed = simulateEmbed(container) // the new frame
    act(() => ref.current!.setPage('p9'))
    expect(embed.commands).toEqual([])
    embed.resize(400)
    expect(embed.commands).toEqual([{ type: 'ds:set-page', version: 1, pageId: 'p9' }])
  })

  it('requestFullscreen asks the browser for the frame', async () => {
    const ref = createRef<DataSquaresEmbedHandle>()
    const { container } = render(<DataSquaresEmbed ref={ref} baseUrl={BASE} contentId="d" token="t" />)
    const frame = container.querySelector('iframe')!
    const requestFullscreen = vi.fn(async () => {})
    Object.defineProperty(frame, 'requestFullscreen', { value: requestFullscreen })
    await ref.current!.requestFullscreen()
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })
})

describe('development warnings', () => {
  it('say when token is ignored, when baseUrl is plain http, and when an error has no onError', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = render(<DataSquaresEmbed baseUrl="http://bi.example.com" getToken={async () => 'x'} token="t" contentId="d" />)
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/token and contentId are ignored[\s\S]*plain http/)
    simulateEmbed(container).error('forbidden')
    expect(String(warn.mock.calls.at(-1)![0])).toMatch(/failed: forbidden/)
  })

  it('stay quiet for localhost over http', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<DataSquaresEmbed baseUrl="http://localhost:5173" contentId="d" token="t" />)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('useDataSquaresEmbed()', () => {
  function Host({ onPointClick }: { onPointClick?: (e: { cardId: string; value: string }) => void }) {
    const embed = useDataSquaresEmbed({ onPointClick })
    return (
      <div>
        <DataSquaresEmbed {...embed.bind} baseUrl={BASE} contentId="d" token="t" />
        <output data-testid="status">{embed.status}</output>
        <output data-testid="page">{embed.pageId ?? '-'}</output>
        <output data-testid="pages">{embed.pages.map((p) => p.name).join(',')}</output>
        <output data-testid="filters">{embed.filters.length}</output>
        <output data-testid="error">{embed.error?.kind ?? '-'}</output>
        {embed.pages.map((p) => (
          <button key={p.id} onClick={() => embed.setPage(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
    )
  }

  it('turns the embed into state, and its commands into calls', async () => {
    const onPointClick = vi.fn()
    const { container } = render(<Host onPointClick={onPointClick} />)
    const embed = simulateEmbed(container, { state: { pageId: 'p1', params: {} } })
    expect(screen.getByTestId('status').textContent).toBe('loading')

    embed.ready({ pages: [{ id: 'p1', name: 'Overview' }, { id: 'p2', name: 'Sales' }] })
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(screen.getByTestId('pages').textContent).toBe('Overview,Sales')
    await vi.waitFor(() => expect(screen.getByTestId('page').textContent).toBe('p1')) // asked with getState

    fireEvent.click(screen.getByText('Sales'))
    expect(embed.commands).toContainEqual({ type: 'ds:set-page', version: 1, pageId: 'p2' })
    embed.pageChange('p2')
    expect(screen.getByTestId('page').textContent).toBe('p2')

    embed.filterChange([{ fieldId: 'region', operator: 'eq', value: 'West' }])
    expect(screen.getByTestId('filters').textContent).toBe('1')
    embed.pointClick('card-1', 'West')
    expect(onPointClick).toHaveBeenCalledWith({ cardId: 'card-1', value: 'West' })

    embed.error('expired')
    expect(screen.getByTestId('status').textContent).toBe('error')
    expect(screen.getByTestId('error').textContent).toBe('expired')
  })
})

describe('simulateEmbed (the /testing entry)', () => {
  it('answers token requests through the real getToken, and getState with the state it is given', async () => {
    const ref = createRef<DataSquaresEmbedHandle>()
    const { container } = render(<DataSquaresEmbed ref={ref} baseUrl={BASE} getToken={async () => 'signed.person.token'} />)
    const embed = simulateEmbed(container, { state: { pageId: 'p4', params: { region: 'west' } } })
    await expect(embed.requestToken()).resolves.toBe('signed.person.token')
    expect(embed.tokens).toEqual(['signed.person.token'])
    await expect(ref.current!.getState()).resolves.toEqual({ pageId: 'p4', params: { region: 'west' } })
  })

  it('says when there is no iframe to stand in for', () => {
    expect(() => simulateEmbed(document.createElement('div'))).toThrow(/no iframe/)
  })
})
