'use client'
/**
 * useDataSquaresChat() — the chat's state as React state, and its commands, so your page can drive it from its own
 * buttons:
 *
 *   const chat = useDataSquaresChat({ defaultMode: 'panel' })
 *   <button onClick={() => chat.ask('How did sales do this month?')}>Ask about sales</button>
 *   <DataSquaresChat {...chat.bind} baseUrl="…" getToken={…} />
 *
 * The hook holds the chat's mode and whether its panel is open (`bind` passes them, controlled); the person's own
 * switches in the chat reach it through `bind`'s handlers. Pass your own callbacks to the hook, not to the component
 * after `{...chat.bind}`, where they would replace the hook's.
 *
 * `setContext()` tells the chat what the person is looking at (with `<DataSquaresEmbed>` beside it, from its
 * `onItemChange` and `onFilterChange`).
 */
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import type { ChatAnswer, ChatLimit, ChatReadyInfo, DataSquaresChatHandle, DataSquaresChatProps } from './DataSquaresChat.js'
import type { EmbedError, EmbedStatus } from './frame-bridge.js'
import type { ChatContext, ChatMode, EmbedMenuItem } from './protocol.js'

type HookCallbacks = Pick<
  DataSquaresChatProps,
  | 'onReady'
  | 'onAnswer'
  | 'onConversationChange'
  | 'onLimitReached'
  | 'onError'
  | 'onStatusChange'
  | 'onModeChange'
  | 'onOpenChange'
  | 'onFeedback'
  | 'onSaved'
  | 'onFollowUp'
>

export interface UseDataSquaresChatOptions extends HookCallbacks {
  /** How the chat shows first (default `panel`). */
  defaultMode?: ChatMode
  /** `panel` mode: open the panel at first (default false). */
  defaultOpen?: boolean
}

/** Spread onto `<DataSquaresChat>`: its ref, its mode and open (controlled), and the callbacks the hook reads. */
export type DataSquaresChatBinding = Required<HookCallbacks> & {
  ref: RefObject<DataSquaresChatHandle | null>
  mode: ChatMode
  open: boolean
}

export interface UseDataSquaresChat {
  bind: DataSquaresChatBinding
  status: EmbedStatus
  /** The last error, while `status` is `error`. */
  error: EmbedError | null
  mode: ChatMode
  /** `panel` mode: whether the panel is open. */
  open: boolean
  /** With a menu token, the menu the chat asks about (empty for one dashboard or report). */
  items: EmbedMenuItem[]
  /** The conversation shown (null: a new one, until its first answer). */
  conversationId: string | null
  /** The latest finished answer (with the charts and tables it showed, when it showed any). */
  lastAnswer: ChatAnswer | null
  /** The latest budget or hourly limit that stopped a question (cleared by the next answer). */
  limit: ChatLimit | null
  ask: (question: string) => void
  newConversation: () => void
  openConversation: (conversationId: string) => void
  setMode: (mode: ChatMode) => void
  setOpen: (open: boolean) => void
  /** Tell the chat what the person is looking at (null: nothing). */
  setContext: (context: ChatContext | null) => void
  reload: () => void
}

export function useDataSquaresChat(options: UseDataSquaresChatOptions = {}): UseDataSquaresChat {
  const ref = useRef<DataSquaresChatHandle | null>(null)
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  const [status, setStatus] = useState<EmbedStatus>('loading')
  const [error, setError] = useState<EmbedError | null>(null)
  const [mode, setModeState] = useState<ChatMode>(options.defaultMode ?? 'panel')
  const [open, setOpenState] = useState(options.defaultOpen ?? false)
  const [items, setItems] = useState<EmbedMenuItem[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [lastAnswer, setLastAnswer] = useState<ChatAnswer | null>(null)
  const [limit, setLimit] = useState<ChatLimit | null>(null)

  const handlers = useMemo<Required<HookCallbacks>>(
    () => ({
      onStatusChange: (next) => {
        setStatus(next)
        if (next !== 'error') setError(null)
        callbacksRef.current.onStatusChange?.(next)
      },
      onReady: (info: ChatReadyInfo) => {
        setItems(info.items)
        callbacksRef.current.onReady?.(info)
      },
      onAnswer: (answer) => {
        setLastAnswer(answer)
        setLimit(null)
        callbacksRef.current.onAnswer?.(answer)
      },
      onConversationChange: (id) => {
        setConversationId(id)
        callbacksRef.current.onConversationChange?.(id)
      },
      onLimitReached: (next) => {
        setLimit(next)
        callbacksRef.current.onLimitReached?.(next)
      },
      onError: (err) => {
        setError(err)
        callbacksRef.current.onError?.(err)
      },
      onModeChange: (next) => {
        setModeState(next)
        callbacksRef.current.onModeChange?.(next)
      },
      onOpenChange: (next) => {
        setOpenState(next)
        callbacksRef.current.onOpenChange?.(next)
      },
      onFeedback: (feedback) => callbacksRef.current.onFeedback?.(feedback),
      onSaved: (saved) => callbacksRef.current.onSaved?.(saved),
      onFollowUp: (pick) => callbacksRef.current.onFollowUp?.(pick),
    }),
    [],
  )
  const bind = useMemo<DataSquaresChatBinding>(() => ({ ref, mode, open, ...handlers }), [mode, open, handlers])

  const ask = useCallback((question: string) => ref.current?.ask(question), [])
  const newConversation = useCallback(() => ref.current?.newConversation(), [])
  const openConversation = useCallback((id: string) => ref.current?.openConversation(id), [])
  // Through the component when it is mounted (it remembers where full screen goes back to), else here.
  const setMode = useCallback((next: ChatMode) => {
    if (ref.current) ref.current.setMode(next)
    else setModeState(next)
  }, [])
  const setOpen = useCallback((next: boolean) => {
    if (ref.current) ref.current.setOpen(next)
    else setOpenState(next)
  }, [])
  const reload = useCallback(() => ref.current?.reload(), [])
  const setContext = useCallback((context: ChatContext | null) => ref.current?.setContext(context), [])

  return { bind, status, error, mode, open, items, conversationId, lastAnswer, limit, ask, newConversation, openConversation, setMode, setOpen, setContext, reload }
}
