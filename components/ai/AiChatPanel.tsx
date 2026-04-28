'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bot, Clock, Eraser, Info, Maximize2, Plus, Send, Trash2, X } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useStockStore } from '@/store/useStockStore'
import type { AiChatContextStats, AiChatMessage, AiChatSession, Market } from '@/types'

type AiChatPanelProps = {
  mode: 'floating' | 'full'
  onClose?: () => void
}

const MARKET_OPTIONS: Array<{ market: Market; label: string }> = [
  { market: 'A', label: 'A 股' },
  { market: 'HK', label: '港股' },
  { market: 'US', label: '美股' },
  { market: 'FUND', label: '基金' },
  { market: 'CRYPTO', label: '加密资产' },
]

const CONTEXT_LEVEL_LABEL: Record<AiChatContextStats['level'], string> = {
  short: '短',
  medium: '中',
  long: '长',
  'near-limit': '接近上限',
}

const SUGGESTIONS = [
  '当前组合最大的风险是什么？',
  '帮我复盘最近交易最多的股票。',
  '我当前持仓里哪只股票需要重点关注？',
  '按成本和盈亏帮我总结一下仓位结构。',
]

type PendingCandidate = {
  symbol: string
  message: string
}

type AiEnvStatus = {
  configured: boolean
  model?: string
}

export default function AiChatPanel({ mode, onClose }: AiChatPanelProps) {
  const router = useRouter()
  const { userId, stocks, config } = useStockStore()
  const [sessions, setSessions] = useState<AiChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [contextStats, setContextStats] = useState<AiChatContextStats | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pendingCandidate, setPendingCandidate] = useState<PendingCandidate | null>(null)
  const [aiEnvStatus, setAiEnvStatus] = useState<AiEnvStatus | null>(null)
  const [streamStatus, setStreamStatus] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const aiReady = Boolean(aiEnvStatus?.configured) || (config.aiConfig.enabled && config.aiConfig.baseUrl.trim() && config.aiConfig.model.trim() && config.aiConfig.apiKey.trim())

  useEffect(() => {
    if (mode !== 'full') return
    const sessionId = new URLSearchParams(window.location.search).get('sessionId')
    if (sessionId) setActiveSessionId(sessionId)
  }, [mode])

  useEffect(() => {
    let cancelled = false
    async function loadAiEnvStatus() {
      try {
        const res = await fetch('/api/ai/config/status', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled && res.ok) setAiEnvStatus(data.env ?? null)
      } catch {
        if (!cancelled) setAiEnvStatus(null)
      }
    }
    void loadAiEnvStatus()
    return () => {
      cancelled = true
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    if (!userId) return
    const res = await fetch(`/api/ai/chat/sessions?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error ?? '获取 AI 对话失败')
    const nextSessions = (data.sessions ?? []) as AiChatSession[]
    setSessions(nextSessions)
    if (!activeSessionId && nextSessions[0]) {
      setActiveSessionId(nextSessions[0].id)
    }
  }, [activeSessionId, userId])

  const refreshMessages = useCallback(async (sessionId: string | null) => {
    if (!userId || !sessionId) {
      setMessages([])
      return
    }
    const res = await fetch(`/api/ai/chat/messages?userId=${encodeURIComponent(userId)}&sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error ?? '获取 AI 消息失败')
    setMessages((data.messages ?? []) as AiChatMessage[])
  }, [userId])

  useEffect(() => {
    void refreshSessions().catch((err) => setError(err instanceof Error ? err.message : '获取 AI 对话失败'))
  }, [refreshSessions])

  useEffect(() => {
    void refreshMessages(activeSessionId).catch((err) => setError(err instanceof Error ? err.message : '获取 AI 消息失败'))
  }, [activeSessionId, refreshMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, loading])

  const contextLabel = useMemo(() => {
    if (!contextStats) return '上下文：短'
    return `上下文：${CONTEXT_LEVEL_LABEL[contextStats.level]}`
  }, [contextStats])

  const createSession = async () => {
    if (!userId) return
    const res = await fetch('/api/ai/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error ?? '创建 AI 对话失败')
    const session = data.session as AiChatSession
    await refreshSessions()
    setActiveSessionId(session.id)
    setMessages([])
  }

  const detectExternalCandidate = (content: string) => {
    const code = content.match(/\b[A-Z]{1,6}\b|\b\d{5,6}\b/)?.[0]
    if (!code) return null
    const upper = code.toUpperCase()
    const exists = stocks.some((stock) => stock.code.toUpperCase() === upper || stock.name.toUpperCase() === upper)
    return exists ? null : upper
  }

  const startSend = async (content: string, externalStock?: { symbol: string; market: Market }) => {
    if (!content.trim() || !userId || loading) return
    if (!aiReady) {
      setError('请先在 .env.local 或设置页配置 AI Provider、Base URL、模型和 API Key。')
      return
    }

    const candidate = detectExternalCandidate(content)
    if (candidate && !externalStock) {
      setPendingCandidate({ symbol: candidate, message: content })
      return
    }

    setError('')
    setInput('')
    setPendingCandidate(null)
    setLoading(true)
    setStreamStatus('')

    const optimisticUser: AiChatMessage = {
      id: `local-user-${Date.now()}`,
      sessionId: activeSessionId ?? 'pending',
      userId,
      role: 'user',
      content,
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
    }
    const optimisticAssistant: AiChatMessage = {
      id: `local-assistant-${Date.now()}`,
      sessionId: activeSessionId ?? 'pending',
      userId,
      role: 'assistant',
      content: '',
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
    }
    setMessages((current) => [...current, optimisticUser, optimisticAssistant])

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          sessionId: activeSessionId,
          message: content,
          stocks,
          aiConfig: config.aiConfig,
          externalStocks: externalStock ? [externalStock] : [],
        }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'AI 对话失败')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let nextSessionId = activeSessionId
      let assistantText = ''

      const handleEvent = (raw: string) => {
        const event = raw.match(/^event:\s*(.+)$/m)?.[1]?.trim()
        const dataText = raw.match(/^data:\s*(.+)$/m)?.[1]
        if (!event || !dataText) return
        const data = JSON.parse(dataText)
        if (event === 'meta') {
          nextSessionId = data.sessionId
          setActiveSessionId(data.sessionId)
          if (data.stats) setContextStats(data.stats)
        } else if (event === 'status') {
          setStreamStatus(data.phase === 'external-data' ? '正在获取行情数据' : '')
        } else if (event === 'token') {
          assistantText += data.token ?? ''
          setStreamStatus('')
          setMessages((current) => current.map((message) => (
            message.id === optimisticAssistant.id ? { ...message, content: assistantText } : message
          )))
        } else if (event === 'error') {
          throw new Error(data.error ?? 'AI 对话失败')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) handleEvent(chunk)
      }

      await refreshSessions()
      await refreshMessages(nextSessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 对话失败')
      setMessages((current) => current.filter((message) => message.id !== optimisticAssistant.id))
    } finally {
      setLoading(false)
      setStreamStatus('')
    }
  }

  const handleSend = async () => {
    await startSend(input)
  }

  const clearMessages = async () => {
    if (!userId || !activeSessionId) return
    const res = await fetch('/api/ai/chat/messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionId: activeSessionId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? '清空 AI 对话失败')
      return
    }
    setClearOpen(false)
    setMessages([])
    await refreshSessions()
  }

  const deleteSession = async () => {
    if (!userId || !activeSessionId) return
    const res = await fetch('/api/ai/chat/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionId: activeSessionId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? '删除 AI 对话失败')
      return
    }
    setDeleteOpen(false)
    setMessages([])
    setActiveSessionId(null)
    await refreshSessions()
  }

  const goFull = () => {
    const suffix = activeSessionId ? `?sessionId=${encodeURIComponent(activeSessionId)}` : ''
    router.push(`/ai/chat${suffix}`)
    onClose?.()
  }

  return (
    <div className={mode === 'full' ? 'grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,14rem)_minmax(0,1fr)] gap-4 lg:grid-cols-[280px_1fr] lg:grid-rows-1' : 'flex h-full min-h-0 flex-col'}>
      {mode === 'full' && (
        <aside className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <div className="text-sm font-semibold">对话历史</div>
              <div className="text-xs text-muted-foreground">本地保存</div>
            </div>
            <Button type="button" size="icon" variant="ghost" onClick={() => void createSession()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setActiveSessionId(session.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  session.id === activeSessionId ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <div className="truncate">{session.title}</div>
                <div className="mt-1 flex items-center gap-1 text-[11px] opacity-75">
                  <Clock className="h-3 w-3" />
                  {new Date(session.updatedAt).toLocaleString('zh-CN')}
                </div>
              </button>
            ))}
            {!sessions.length && <div className="px-3 py-8 text-sm text-muted-foreground">暂无对话</div>}
          </div>
        </aside>
      )}

      <section className={`flex min-h-0 flex-col overflow-hidden ${mode === 'floating' ? 'h-full flex-1' : 'h-full rounded-lg border border-border bg-card'}`}>
        <header className="shrink-0 flex items-center gap-3 border-b border-border p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{activeSession?.title ?? 'AI 对话'}</div>
            <div className="text-xs text-muted-foreground" title={contextStats ? `估算 ${contextStats.tokenEstimate} / ${contextStats.maxContextTokens} tokens` : undefined}>
              {contextLabel}{aiEnvStatus?.configured ? ` · .env${aiEnvStatus.model ? ` / ${aiEnvStatus.model}` : ''}` : ''}
            </div>
          </div>
          {mode === 'floating' && (
            <Button type="button" variant="ghost" size="icon" onClick={goFull} title="放大">
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" onClick={() => setClearOpen(true)} disabled={!activeSessionId || !messages.length} title="清空对话">
            <Eraser className="h-4 w-4" />
          </Button>
          {mode === 'full' && (
            <Button type="button" variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} disabled={!activeSessionId} title="删除会话">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {mode === 'floating' && (
            <Button type="button" variant="ghost" size="icon" onClick={onClose} title="关闭">
              <X className="h-4 w-4" />
            </Button>
          )}
        </header>

        {!aiReady && (
          <div className="shrink-0 border-b border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
            请先在 .env.local 或 AI 设置中完成模型连接配置后再开始对话。
            <Link href="/settings" className="ml-2 text-primary hover:underline" onClick={onClose}>去设置</Link>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!messages.length && (
            <div className="space-y-3">
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>AI 分析基于你的持仓和交易数据生成，仅供参考，不构成任何投资建议。市场有风险，交易需谨慎。</span>
              </div>
              <div className="text-sm text-muted-foreground">可以直接问我与你的持仓、交易复盘、股票估值或风险管理相关的问题。</div>
              <div className="grid gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setInput(suggestion)}
                    className="rounded-md border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6 ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-secondary/60 text-foreground'
                }`}>
                  {message.content || (message.role === 'assistant' && loading ? (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      {streamStatus && <span>{streamStatus}</span>}
                      <span className="inline-flex items-center gap-1" aria-label={streamStatus || 'AI 正在生成'}>
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                      </span>
                    </span>
                  ) : '')}
                </div>
              </div>
            ))}
          </div>
          <div ref={bottomRef} />
        </div>

        {error && <div className="border-t border-border px-4 py-2 text-xs text-destructive">{error}</div>}

        {pendingCandidate && (
          <div className="shrink-0 border-t border-border bg-secondary/40 p-3">
            <div className="mb-2 text-xs text-muted-foreground">检测到未持仓标的 {pendingCandidate.symbol}，请选择市场后继续。</div>
            <div className="flex flex-wrap gap-2">
              {MARKET_OPTIONS.map((item) => (
                <Button
                  key={item.market}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void startSend(pendingCandidate.message, { symbol: pendingCandidate.symbol, market: item.market })}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        <footer className="mt-auto shrink-0 border-t border-border p-4">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              disabled={!aiReady || loading}
              rows={mode === 'full' ? 3 : 2}
              placeholder={aiReady ? '输入与股票、持仓或交易相关的问题...' : '请先配置 AI'}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              className="min-h-0 resize-none text-sm"
            />
            <Button type="button" size="icon" disabled={!aiReady || loading || !input.trim()} onClick={() => void handleSend()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </footer>
      </section>

      <ConfirmDialog
        open={clearOpen}
        title="确认清空对话"
        description="确定清空当前会话的所有消息吗？该操作不可恢复。"
        confirmText="清空"
        onOpenChange={setClearOpen}
        onConfirm={clearMessages}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="确认删除会话"
        description="确定删除当前 AI 对话会话吗？该操作不可恢复。"
        confirmText="删除"
        onOpenChange={setDeleteOpen}
        onConfirm={deleteSession}
      />
    </div>
  )
}
