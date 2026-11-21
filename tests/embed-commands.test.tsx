/**
 * @vitest-environment jsdom
 *
 * 0.3: commands wait until the embed listens (a command posted to a loading frame reaches no one), a getToken that
 * fails says why, an answer that comes after unmount goes nowhere, and the guard reads the protocol version and the
 * shapes inside a message, not only around it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { DataSquaresEmbed, type DataSquaresEmbedHandle } from '../src/DataSquaresEmbed.js'
import { isEmbedOutMessage } from '../src/protocol.js'

const BASE = 'https://app.datasquares.ai'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function dispatch(data: unknown, origin: string, source: unknown) {
  const event = new MessageEvent('message', { data, origin })
  Object.defineProperty(event, 'source', { value: source })
  act(() => {
    window.dispatchEvent(event)
  })
}

/** A share-link embed whose frame is a postMessage spy; the embed has not spoken yet. */
function renderFrame() {
  const ref = createRef<DataSquaresEmbedHandle>()
  const utils = render(<DataSquaresEmbed ref={ref} baseUrl={BASE} contentId="dash-1" token="tok-1" />)
  const iframe = utils.container.querySelector('iframe')!
  const post = vi.fn()
  const cw = { postMessage: post }
  Object.defineProperty(iframe, 'contentWindow', { value: cw })
  return { ref, post, cw, ...utils }
}

const speaks = (cw: unknown) => dispatch({ type: 'ds:resize', version: 1, height: 700 }, BASE, cw)

describe('commands before the embed listens', () => {
  it('wait until the embed first speaks, then go out, only the last of each kind', () => {
    const { ref, post, cw } = renderFrame()
    act(() => {
      ref.current!.setParams({ region: 'west' })
      ref.current!.setPage('p1')
      ref.current!.setParams({ region: 'east' })
      ref.current!.refresh()
      ref.current!.refresh()
    })
    expect(post).not.toHaveBeenCalled()

    speaks(cw)
    expect(post.mock.calls.map((c) => c[0])).toEqual([
      { type: 'ds:set-page', version: 1, pageId: 'p1' },
      { type: 'ds:set-params', version: 1, params: { region: 'east' } },
      { type: 'ds:refresh', version: 1 },
    ])
    for (const call of post.mock.calls) expect(call[1]).toBe(BASE)

    // Live now: a command goes straight out.
    act(() => ref.current!.setPage('p2'))
    expect(post).toHaveBeenLastCalledWith({ type: 'ds:set-page', version: 1, pageId: 'p2' }, BASE)
  })

  it('a message from another origin or window does not count as the embed speaking', () => {
    const { ref, post, cw } = renderFrame()
    act(() => ref.current!.refresh())
    dispatch({ type: 'ds:resize', version: 1, height: 700 }, 'https://evil.example', cw)
    dispatch({ type: 'ds:resize', version: 1, height: 700 }, BASE, { other: true })
    dispatch({ type: 'ds:resize', version: 2, height: 700 }, BASE, cw) // another protocol version
    expect(post).not.toHaveBeenCalled()
  })

  it('a new src is a new page: commands wait for it to speak again', () => {
    const { ref, post, cw, rerender, container } = renderFrame()
    speaks(cw)
    rerender(<DataSquaresEmbed ref={ref} baseUrl={BASE} contentId="dash-2" token="tok-2" />)
    expect(container.querySelector('iframe')!.src).toContain('/embed/dash-2')
    act(() => ref.current!.setPage('p3'))
    expect(post).not.toHaveBeenCalled()
    dispatch({ type: 'ds:ready', version: 1, contentType: 'dashboard', pages: [] }, BASE, cw)
    expect(post).toHaveBeenCalledWith({ type: 'ds:set-page', version: 1, pageId: 'p3' }, BASE)
  })

  it('getState asked before the embed listens is answered once it does', async () => {
    const { ref, post, cw } = renderFrame()
    let statePromise!: Promise<unknown>
    act(() => {
      statePromise = ref.current!.getState()
    })
    expect(post).not.toHaveBeenCalled()
    speaks(cw)
    const sent = post.mock.calls[0]![0] as { requestId: string }
    dispatch({ type: 'ds:state', version: 1, requestId: sent.requestId, state: { pageId: null, params: {} } }, BASE, cw)
    await expect(statePromise).resolves.toEqual({ pageId: null, params: {} })
  })

  it('getState rejects when the embed never answers, and its request stops waiting', async () => {
    const { ref, post, cw } = renderFrame()
    let statePromise!: Promise<unknown>
    act(() => {
      statePromise = ref.current!.getState(20)
    })
    await expect(statePromise).rejects.toThrow(/did not answer/)
    speaks(cw)
    expect(post).not.toHaveBeenCalled() // the timed-out request left the queue
  })
})

describe('the frame source', () => {
  it('an inline params object with the same values does not reload the frame', () => {
    const { rerender, container } = render(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" params={{ region: 'west' }} />)
    const first = container.querySelector('iframe')!.src
    rerender(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" params={{ region: 'west' }} />)
    expect(container.querySelector('iframe')!.src).toBe(first)
    rerender(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" params={{ region: 'east' }} />)
    expect(container.querySelector('iframe')!.src).toContain('p_region=east')
  })

  it('a baseUrl that is not an http(s) URL is refused with words', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<DataSquaresEmbed baseUrl="app.datasquares.ai" contentId="d" token="t" />)).toThrow(/absolute URL/)
    expect(() => render(<DataSquaresEmbed baseUrl="javascript:alert(1)" contentId="d" token="t" />)).toThrow(/http\(s\)/)
  })

  it('passes loading through to the iframe', () => {
    const { container } = render(<DataSquaresEmbed baseUrl={BASE} contentId="d" token="t" loading="lazy" />)
    expect(container.querySelector('iframe')!.getAttribute('loading')).toBe('lazy')
  })
})

describe('<DataSquaresEmbed getToken> failures', () => {
  function renderSession(getToken: () => Promise<string>) {
    const onError = vi.fn()
    const utils = render(<DataSquaresEmbed baseUrl={BASE} getToken={getToken} onError={onError} />)
    const iframe = utils.container.querySelector('iframe')!
    const post = vi.fn()
    const cw = { postMessage: post }
    Object.defineProperty(iframe, 'contentWindow', { value: cw })
    return { post, cw, onError, ...utils }
  }
  const ask = (cw: unknown) => dispatch({ type: 'ds:token-request', version: 1, reason: 'start' }, BASE, cw)

  it('an empty or oversized token is refused here, with a cause, and never posted', async () => {
    for (const bad of ['', 'x'.repeat(8193)]) {
      const { cw, post, onError, unmount } = renderSession(async () => bad)
      ask(cw)
      await vi.waitFor(() => expect(onError).toHaveBeenCalledWith({ kind: 'invalid', cause: expect.any(TypeError) }))
      expect(post).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('a getToken that throws synchronously is reported, not left to break the listener', async () => {
    const { cw, onError } = renderSession((() => {
      throw new Error('sync boom')
    }) as () => Promise<string>)
    ask(cw)
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith({ kind: 'invalid', cause: expect.objectContaining({ message: 'sync boom' }) }),
    )
  })

  it('a token that arrives after unmount is not posted, and no error is reported', async () => {
    let answer!: (t: string) => void
    const { cw, post, onError, unmount } = renderSession(() => new Promise<string>((r) => (answer = r)))
    ask(cw)
    unmount()
    answer('signed.person.token')
    await new Promise((r) => setTimeout(r, 10))
    expect(post).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('isEmbedOutMessage: version and the shapes inside', () => {
  it('refuses a message of another protocol version, or of none', () => {
    expect(isEmbedOutMessage({ type: 'ds:resize', version: 2, height: 640 })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:resize', height: 640 })).toBe(false)
  })

  it('refuses pages, filters and state a handler would misread', () => {
    expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'dashboard', pages: [{ id: 1, name: 'x' }] })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'dashboard', pages: [{ id: 'p1', name: 'One' }] })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:filter-change', version: 1, filters: ['x'] })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:state', version: 1, state: { pageId: 'p', params: null } })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:state', version: 1, state: { pageId: 3, params: {} } })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:state', version: 1, requestId: 7, state: { pageId: null, params: {} } })).toBe(false)
  })

  it('still hears an error kind it does not know (one added later)', () => {
    expect(isEmbedOutMessage({ type: 'ds:error', version: 1, kind: 'rate-limited' })).toBe(true)
  })
})
