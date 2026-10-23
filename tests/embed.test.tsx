/**
 * @vitest-environment jsdom
 *
 * The properties pinned here are the ones that make the SDK safe to put on a
 * customer's page: messages are accepted only from THIS iframe at the
 * DataSquares origin (two embeds must not cross, no other frame may speak as
 * the embed), commands target the exact origin, and the URL builder cannot be
 * coaxed into a different host.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { DataSquaresEmbed, buildEmbedUrl, buildSessionEmbedUrl, type DataSquaresEmbedHandle } from '../src/DataSquaresEmbed.js'
import { isEmbedOutMessage } from '../src/protocol.js'

const BASE = 'https://app.datasquares.ai'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Dispatch a message event as jsdom allows us to (source is read-only on the ctor). */
function dispatch(data: unknown, origin: string, source: unknown) {
  const event = new MessageEvent('message', { data, origin })
  Object.defineProperty(event, 'source', { value: source })
  act(() => {
    window.dispatchEvent(event)
  })
}

function renderEmbed(extra: Partial<Parameters<typeof DataSquaresEmbed>[0]> = {}) {
  const ref = createRef<DataSquaresEmbedHandle>()
  const onReady = vi.fn()
  const onError = vi.fn()
  const onPageChange = vi.fn()
  const utils = render(
    <DataSquaresEmbed
      ref={ref}
      baseUrl={BASE}
      contentId="dash-1"
      token="tok-1"
      onReady={onReady}
      onError={onError}
      onPageChange={onPageChange}
      {...extra}
    />,
  )
  const iframe = utils.container.querySelector('iframe')!
  return { ref, iframe, onReady, onError, onPageChange, ...utils }
}

describe('buildEmbedUrl', () => {
  it('builds the embed route with token and options', () => {
    const url = new URL(
      buildEmbedUrl({
        baseUrl: BASE,
        contentId: 'dash-1',
        token: 't0k',
        theme: 'dark',
        toolbar: false,
        params: { region: 'west', year: 2026 },
      }),
    )
    expect(url.origin).toBe(BASE)
    expect(url.pathname).toBe('/embed/dash-1')
    expect(url.searchParams.get('token')).toBe('t0k')
    expect(url.searchParams.get('theme')).toBe('dark')
    expect(url.searchParams.get('toolbar')).toBe('false')
    expect(url.searchParams.get('p_region')).toBe('west')
    expect(url.searchParams.get('p_year')).toBe('2026')
  })

  it('cannot be steered to another host by a crafted contentId', () => {
    // "../" and absolute-URL shapes must stay inside baseUrl.
    for (const contentId of ['../login', 'https://evil.example/x', '//evil.example/y']) {
      const url = new URL(buildEmbedUrl({ baseUrl: BASE, contentId, token: 't' }))
      expect(url.origin).toBe(BASE)
      expect(url.pathname.startsWith('/embed/')).toBe(true)
    }
  })
})

describe('<DataSquaresEmbed> message validation', () => {
  it('renders an iframe pointing at the embed URL with explicit referrerPolicy', () => {
    const { iframe } = renderEmbed()
    expect(iframe.src).toContain(`${BASE}/embed/dash-1?token=tok-1`)
    // The embed identifies its host by referrer/ancestor origin; a host page
    // with a site-wide no-referrer policy would otherwise be refused under a
    // domain restriction.
    expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
  })

  it('accepts events only from this iframe at the DataSquares origin', () => {
    const { iframe, onReady } = renderEmbed()
    const ready = { type: 'ds:ready', version: 1, contentType: 'dashboard', pages: [] }

    dispatch(ready, 'https://evil.example', iframe.contentWindow) // wrong origin
    dispatch(ready, BASE, { other: true }) // wrong window
    expect(onReady).not.toHaveBeenCalled()

    dispatch(ready, BASE, iframe.contentWindow)
    expect(onReady).toHaveBeenCalledWith({ contentType: 'dashboard', pages: [] })
  })

  it('two embeds on one page do not receive each other events', () => {
    const first = renderEmbed()
    const second = renderEmbed({ contentId: 'dash-2' })

    dispatch({ type: 'ds:page-change', version: 1, pageId: 'p9' }, BASE, second.iframe.contentWindow)
    expect(second.onPageChange).toHaveBeenCalledWith('p9')
    expect(first.onPageChange).not.toHaveBeenCalled()
  })

  it('auto-resizes from ds:resize and stops when autoResize is off', () => {
    const grow = renderEmbed()
    dispatch({ type: 'ds:resize', version: 1, height: 912 }, BASE, grow.iframe.contentWindow)
    expect(grow.iframe.style.height).toBe('912px')

    const fixed = renderEmbed({ autoResize: false, height: 400, contentId: 'dash-3' })
    dispatch({ type: 'ds:resize', version: 1, height: 912 }, BASE, fixed.iframe.contentWindow)
    expect(fixed.iframe.style.height).toBe('400px')
  })

  it('surfaces embed errors', () => {
    const { iframe, onError } = renderEmbed()
    dispatch({ type: 'ds:error', version: 1, kind: 'forbidden' }, BASE, iframe.contentWindow)
    expect(onError).toHaveBeenCalledWith({ kind: 'forbidden' })
  })

  it('posts commands to the exact embed origin', () => {
    const { ref, iframe } = renderEmbed()
    const post = vi.fn()
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: post } })

    act(() => ref.current!.setPage('p2'))
    expect(post).toHaveBeenCalledWith({ type: 'ds:set-page', version: 1, pageId: 'p2' }, BASE)

    act(() => ref.current!.setParams({ region: 'east' }))
    expect(post).toHaveBeenCalledWith({ type: 'ds:set-params', version: 1, params: { region: 'east' } }, BASE)

    act(() => ref.current!.refresh())
    expect(post).toHaveBeenCalledWith({ type: 'ds:refresh', version: 1 }, BASE)
  })

  it('getState resolves on the matching requestId reply', async () => {
    const { ref, iframe } = renderEmbed()
    const post = vi.fn()
    const cw = { postMessage: post }
    Object.defineProperty(iframe, 'contentWindow', { value: cw })

    let statePromise!: Promise<unknown>
    act(() => {
      statePromise = ref.current!.getState()
    })
    const sent = post.mock.calls[0]![0] as { requestId: string }
    expect(sent.requestId).toBeTruthy()

    // A reply with the WRONG requestId must not resolve it.
    dispatch(
      { type: 'ds:state', version: 1, requestId: 'someone-else', state: { pageId: 'x', params: {} } },
      BASE,
      cw,
    )
    dispatch(
      { type: 'ds:state', version: 1, requestId: sent.requestId, state: { pageId: 'p1', params: { a: 1 } } },
      BASE,
      cw,
    )
    await expect(statePromise).resolves.toEqual({ pageId: 'p1', params: { a: 1 } })
  })
})

describe('isEmbedOutMessage', () => {
  it('rejects shapes whose handler would misbehave', () => {
    expect(isEmbedOutMessage({ type: 'ds:resize', version: 1, height: 'tall' })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:resize', version: 1, height: -5 })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:ready', version: 1, contentType: 'video', pages: [] })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:set-page', version: 1, pageId: 'p' })).toBe(false) // inbound type
    expect(isEmbedOutMessage(null)).toBe(false)
  })
  it('accepts the real shapes', () => {
    expect(isEmbedOutMessage({ type: 'ds:resize', version: 1, height: 640 })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:filter-change', version: 1, filters: [] })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:state', version: 1, state: { pageId: null, params: {} } })).toBe(true)
  })
})

// ── Two keys (DataSquares AI plan chapter 12): the person's signed token ──────────────────────────────────────────
// The host's server signs a short-lived token for each person with its embed app's key; the browser carries only that
// token, and never in a URL: the embed asks for it (ds:token-request) and the component answers with getToken().

describe('buildSessionEmbedUrl', () => {
  it('opens the session embed with its options and never a token in the URL', () => {
    const url = new URL(buildSessionEmbedUrl({ baseUrl: BASE, theme: 'dark', toolbar: false, params: { region: 'west' } }))
    expect(url.origin).toBe(BASE)
    expect(url.pathname).toBe('/embed/session')
    expect(url.searchParams.get('token')).toBeNull()
    expect(url.hash).toBe('')
    expect(url.searchParams.get('theme')).toBe('dark')
    expect(url.searchParams.get('toolbar')).toBe('false')
    expect(url.searchParams.get('p_region')).toBe('west')
  })
})

describe('<DataSquaresEmbed getToken>', () => {
  function renderSession(getToken: () => Promise<string>, onError = vi.fn()) {
    const utils = render(<DataSquaresEmbed baseUrl={BASE} getToken={getToken} onError={onError} />)
    const iframe = utils.container.querySelector('iframe')!
    const post = vi.fn()
    const cw = { postMessage: post }
    Object.defineProperty(iframe, 'contentWindow', { value: cw })
    return { iframe, post, cw, onError }
  }

  it('loads the session embed and answers its token request with the signed token, at the exact origin', async () => {
    const getToken = vi.fn(async () => 'signed.person.token')
    const { iframe, post, cw } = renderSession(getToken)
    expect(new URL(iframe.src).pathname).toBe('/embed/session')
    expect(iframe.src).not.toContain('signed')

    dispatch({ type: 'ds:token-request', version: 1, reason: 'start' }, BASE, cw)
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'ds:token', version: 1, token: 'signed.person.token' }, BASE))
    expect(getToken).toHaveBeenCalledTimes(1)

    // The session ends: the embed asks again, and a fresh token is signed.
    dispatch({ type: 'ds:token-request', version: 1, reason: 'renew' }, BASE, cw)
    await vi.waitFor(() => expect(getToken).toHaveBeenCalledTimes(2))
  })

  it('never answers a token request from another origin or another window', async () => {
    const getToken = vi.fn(async () => 'signed.person.token')
    const { cw } = renderSession(getToken)
    dispatch({ type: 'ds:token-request', version: 1, reason: 'start' }, 'https://evil.example', cw)
    dispatch({ type: 'ds:token-request', version: 1, reason: 'start' }, BASE, { other: true })
    await new Promise((r) => setTimeout(r, 10))
    expect(getToken).not.toHaveBeenCalled()
  })

  it('a getToken that fails is an error the host hears about, and nothing is posted', async () => {
    const { cw, post, onError } = renderSession(async () => {
      throw new Error('your server said no')
    })
    dispatch({ type: 'ds:token-request', version: 1, reason: 'start' }, BASE, cw)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith({ kind: 'invalid' }))
    expect(post).not.toHaveBeenCalled()
  })

  it('a share link still embeds with its token and content id', () => {
    const { iframe } = renderEmbed()
    expect(new URL(iframe.src).pathname).toBe('/embed/dash-1')
  })
})

describe('isEmbedOutMessage: the token request', () => {
  it('accepts a token request and refuses one without its reason', () => {
    expect(isEmbedOutMessage({ type: 'ds:token-request', version: 1, reason: 'start' })).toBe(true)
    expect(isEmbedOutMessage({ type: 'ds:token-request', version: 1 })).toBe(false)
    expect(isEmbedOutMessage({ type: 'ds:token', version: 1, token: 'x' })).toBe(false) // inbound type
  })
})
