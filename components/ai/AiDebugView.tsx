'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, ChevronRight, Clipboard, GitBranch, MessageSquare, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import JsonViewer from '@/components/ui/json-viewer'
import { nextApiUrls } from '@/lib/api/endpoints'
import { useI18n } from '@/lib/i18n'
import { useStockStore } from '@/store/useStockStore'
import type { Locale } from '@/lib/i18n/messages'
import type { AiAgentRun, AiChatMessage, AiChatSession } from '@/types'

type DebugLookupResult = {
  matchType: 'session' | 'message' | 'run'
  session: AiChatSession | null
  messages: AiChatMessage[]
  runs: AiAgentRun[]
  selectedMessage: AiChatMessage | null
  selectedRun: AiAgentRun | null
  relatedRuns: AiAgentRun[]
}

type TFunction = ReturnType<typeof useI18n>['t']

function getRoleLabel(role: AiChatMessage['role'], t: TFunction) {
  if (role === 'user') return t('用户')
  if (role === 'assistant') return 'AI'
  return t('系统')
}

function getMatchLabel(type: DebugLookupResult['matchType'], t: TFunction) {
  if (type === 'session') return t('对话 ID')
  if (type === 'message') return t('消息 ID')
  return 'Run ID'
}

function formatDateToSecond(value: string | null | undefined, locale: Locale, t: TFunction) {
  if (!value) return t('未知')
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function shortId(id: string | null | undefined, t: TFunction) {
  return id ? id.slice(0, 8) : t('无')
}

function findRelatedRuns(target: AiChatMessage | null, messages: AiChatMessage[], runs: AiAgentRun[]) {
  if (!target) return []

  const exact = runs.filter((run) => run.messageId === target.id)
  if (exact.length) return exact

  if (target.role === 'assistant') {
    const targetIndex = messages.findIndex((message) => message.id === target.id)
    const previousUser = [...messages.slice(0, targetIndex)].reverse().find((message) => message.role === 'user')
    if (previousUser) return runs.filter((run) => run.messageId === previousUser.id)
  }

  return []
}

export default function AiDebugView() {
  const { userId } = useStockStore()
  const { t, locale } = useI18n()
  const searchParams = useSearchParams()
  const initialId = searchParams.get('id') ?? ''
  const [query, setQuery] = useState(initialId)
  const [result, setResult] = useState<DebugLookupResult | null>(null)
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const activeMessage = useMemo(() => {
    if (!result) return null
    return result.messages.find((message) => message.id === activeMessageId) ?? result.selectedMessage ?? null
  }, [activeMessageId, result])

  const activeRelatedRuns = useMemo(() => {
    if (!result) return []
    return findRelatedRuns(activeMessage, result.messages, result.runs)
  }, [activeMessage, result])

  const activeRun = useMemo(() => {
    if (!result) return null
    return result.runs.find((run) => run.id === activeRunId) ?? activeRelatedRuns[0] ?? result.selectedRun ?? result.runs[0] ?? null
  }, [activeRelatedRuns, activeRunId, result])

  const loadDebug = async (id: string) => {
    if (!userId || !id.trim()) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ userId, id: id.trim() })
      const res = await fetch(nextApiUrls.ai.chatDebug(params), { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(t(data?.error ?? '查询 Debug 信息失败'))
      const next = data as DebugLookupResult
      const nextMessageId = next.selectedMessage?.id ?? next.selectedRun?.messageId ?? next.messages.at(-1)?.id ?? null
      setResult(next)
      setActiveMessageId(nextMessageId)
      setActiveRunId(next.relatedRuns[0]?.id ?? next.selectedRun?.id ?? next.runs[0]?.id ?? null)
    } catch (err) {
      setResult(null)
      setActiveMessageId(null)
      setActiveRunId(null)
      setError(err instanceof Error ? err.message : t('查询 Debug 信息失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initialId && userId) void loadDebug(initialId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId, userId])

  const copyId = async (id: string) => {
    await navigator.clipboard.writeText(id)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId(null), 1200)
  }

  const selectMessage = (message: AiChatMessage) => {
    if (!result) return
    const nextRelatedRuns = findRelatedRuns(message, result.messages, result.runs)
    setActiveMessageId(message.id)
    setActiveRunId(nextRelatedRuns[0]?.id ?? null)
  }

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4 text-primary" />
            {t('查询链路')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-2 md:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              void loadDebug(query)
            }}
          >
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('粘贴对话 ID、消息 ID 或 Run ID')}
              className="font-mono"
            />
            <Button type="submit" disabled={loading || !query.trim()} className="gap-2">
              <Search className="h-4 w-4" />
              {loading ? t('查询中') : t('查询')}
            </Button>
          </form>
          {error && <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-5">
          <Card className="border-border bg-card">
            <CardContent className="grid gap-3 p-4 text-sm lg:grid-cols-[minmax(0,1.4fr)_auto_auto] lg:items-center">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{t('查询结果')} · {getMatchLabel(result.matchType, t)}</div>
                <div className="mt-1 truncate font-medium text-foreground">{result.session?.title ?? t('未找到对话标题')}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <InfoBadge label={t('消息')} value={`${result.messages.length}`} />
                <InfoBadge label="Runs" value={`${result.runs.length}`} />
                <InfoBadge label={t('更新')} value={formatDateToSecond(result.session?.updatedAt, locale, t)} />
              </div>
              {result.session && <IdButton id={result.session.id} label="Session" copiedId={copiedId} onCopy={copyId} t={t} />}
            </CardContent>
          </Card>

          <section className="grid gap-5 xl:grid-cols-[minmax(22rem,0.85fr)_minmax(0,1.35fr)]">
            <Card className="flex h-full min-h-0 flex-col border-border bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  {t('消息时间线')}
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 space-y-2 overflow-auto">
                {result.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex items-start gap-2 rounded-md border bg-surface p-2 transition-colors ${
                      message.id === activeMessage?.id
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectMessage(message)}
                      className="min-w-0 flex-1 text-left"
                      title={t('查看这条消息详情')}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-foreground">{getRoleLabel(message.role, t)}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatDateToSecond(message.createdAt, locale, t)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{shortId(message.id, t)}</span>
                        <span className="line-clamp-2 min-w-0 break-words text-xs leading-5 text-muted-foreground">{message.content || t('空消息')}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyId(message.id)}
                      className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                      title={t('复制消息 ID')}
                    >
                      {copiedId === message.id ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>

            {activeMessage ? (
              <MessageDetail message={activeMessage} copiedId={copiedId} onCopy={copyId} locale={locale} t={t} />
            ) : (
              <EmptyDetail title={t('未选择消息')} detail={t('从左侧消息时间线中选择一条消息查看详情。')} />
            )}
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(22rem,0.85fr)_minmax(0,1.35fr)]">
            <Card className="flex h-full min-h-0 flex-col border-border bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4 text-primary" />
                  {t('调用链路')}
                </CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 space-y-2 overflow-auto">
                <div className="grid gap-2">
                  {result.runs.map((run) => {
                    const active = run.id === activeRun?.id
                    const related = activeRelatedRuns.some((item) => item.id === run.id)
                    return (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setActiveRunId(run.id)}
                        className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                          active
                            ? 'border-primary/50 bg-primary/10 text-primary'
                            : related
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-border bg-surface text-muted-foreground hover:border-primary/30 hover:text-foreground'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono">{shortId(run.id, t)}</span>
                          <span className="shrink-0 font-mono text-[11px] opacity-80">{formatDateToSecond(run.createdAt, locale, t)}</span>
                        </div>
                        <div className="mt-1 break-words">{run.intent} · {run.responseMode}</div>
                      </button>
                    )
                  })}
                  {!result.runs.length && <div className="text-sm text-muted-foreground">{t('暂无调用链路记录')}</div>}
                </div>
              </CardContent>
            </Card>

            {activeRun ? (
              <RunDetail run={activeRun} copiedId={copiedId} onCopy={copyId} locale={locale} t={t} />
            ) : (
              <EmptyDetail title={t('未选择 Run')} detail={t('从左侧调用链路中选择一次 Run 查看执行详情。')} />
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="ml-2 font-mono text-xs text-foreground">{value}</span>
    </div>
  )
}

function EmptyDetail({ title, detail }: { title: string; detail: string }) {
  return (
    <Card className="flex min-h-48 items-center justify-center border-border bg-card">
      <div className="px-6 text-center">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-2 text-sm text-muted-foreground">{detail}</div>
      </div>
    </Card>
  )
}

function IdButton({ id, label, copiedId, onCopy, t }: { id: string; label: string; copiedId: string | null; onCopy: (id: string) => void; t: TFunction }) {
  return (
    <button
      type="button"
      onClick={() => void onCopy(id)}
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/80 px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
      title={t('复制 {label} ID', { label })}
    >
      {copiedId === id ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Clipboard className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{label}: {copiedId === id ? t('已复制') : id}</span>
    </button>
  )
}

function MessageDetail({ message, copiedId, onCopy, locale, t }: { message: AiChatMessage; copiedId: string | null; onCopy: (id: string) => void; locale: Locale; t: TFunction }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-base">{t('消息详情')}</CardTitle>
            <div className="mt-2 text-xs text-muted-foreground">{formatDateToSecond(message.createdAt, locale, t)}</div>
          </div>
          <IdButton id={message.id} label="Message" copiedId={copiedId} onCopy={onCopy} t={t} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <InfoPill label={t('角色')} value={getRoleLabel(message.role, t)} />
          <InfoPill label={t('Token 估算')} value={`${message.tokenEstimate}`} />
          <InfoPill label="Session" value={message.sessionId} />
          <InfoPill label={t('创建时间')} value={formatDateToSecond(message.createdAt, locale, t)} />
        </div>

        <section className="rounded-md border border-border bg-surface">
          <div className="border-b border-border px-3 py-2 text-sm font-medium text-foreground">{t('内容')}</div>
          <div className="max-h-[24rem] overflow-auto whitespace-pre-wrap break-words p-3 text-sm leading-6 text-muted-foreground">
            {message.content || t('空消息')}
          </div>
        </section>

        <JsonSection title={t('上下文快照')} value={message.contextSnapshot ?? null} t={t} />
      </CardContent>
    </Card>
  )
}

function RunDetail({ run, copiedId, onCopy, locale, t }: { run: AiAgentRun; copiedId: string | null; onCopy: (id: string) => void; locale: Locale; t: TFunction }) {
  const rawTrace = {
    plan: run.plan,
    skillCalls: run.skillCalls,
    skillResults: run.skillResults,
    contextStats: run.contextStats,
    error: run.error,
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-base">{t('Run 详情')}</CardTitle>
            <div className="mt-2 text-xs text-muted-foreground">{formatDateToSecond(run.createdAt, locale, t)}</div>
          </div>
          <IdButton id={run.id} label="Run" copiedId={copiedId} onCopy={onCopy} t={t} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <InfoPill label="Intent" value={run.intent} />
          <InfoPill label="Mode" value={run.responseMode} />
          <InfoPill label="Message" value={run.messageId ?? t('未绑定')} />
          <InfoPill label="Error" value={run.error ?? t('无')} />
        </div>

        <JsonSection title="Plan" value={run.plan} t={t} />
        <JsonSection title="Skill Calls" value={run.skillCalls} t={t} />
        <JsonSection title="Skill Results" value={run.skillResults} t={t} />
        <JsonSection title="Context Stats" value={run.contextStats} t={t} />
        <JsonSection title="Raw Debug Tree" value={rawTrace} expanded t={t} />
      </CardContent>
    </Card>
  )
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface px-3 py-2">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-mono text-xs text-foreground">{value}</div>
    </div>
  )
}

function JsonSection({ title, value, expanded = false, t }: { title: string; value: unknown; expanded?: boolean; t: TFunction }) {
  const [expandedAll, setExpandedAll] = useState(false)
  const collapsed = expandedAll ? false : expanded ? 3 : 2

  return (
    <details className="group rounded-md border border-border bg-surface" open={expanded}>
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <span className="truncate">{title}</span>
        </span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setExpandedAll((current) => !current)
            }}
            className="rounded border border-border px-2 py-0.5 text-[11px] font-normal text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            {expandedAll ? t('折叠') : t('展开全部')}
          </button>
      </summary>
      <div className="border-t border-border">
        <JsonViewer value={value} collapsed={collapsed} />
      </div>
    </details>
  )
}
