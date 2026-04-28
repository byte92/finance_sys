'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Clock, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import type { AiAnalysisHistoryRecord, AiAnalysisResult, Stock } from '@/types'

export default function StockAnalysisPanel({ stock }: { stock: Stock }) {
  const { config, userId } = useStockStore()
  const [result, setResult] = useState<AiAnalysisResult | null>(null)
  const [restoredFromHistory, setRestoredFromHistory] = useState(false)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId || !stock.id) return

    const currentUserId = userId
    const controller = new AbortController()
    async function loadLatestAnalysis() {
      setHistoryLoading(true)
      setError(null)
      setResult(null)
      setRestoredFromHistory(false)
      try {
        const params = new URLSearchParams({
          userId: currentUserId,
          type: 'stock',
          stockId: stock.id,
          limit: '1',
        })
        const res = await fetch(`/api/ai/history?${params.toString()}`, { signal: controller.signal })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? '读取个股 AI 历史失败')
        const latest = (data.records as AiAnalysisHistoryRecord[] | undefined)?.[0]
        if (latest) {
          setResult(latest.result)
          setRestoredFromHistory(true)
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : '读取个股 AI 历史失败')
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false)
      }
    }

    loadLatestAnalysis()
    return () => controller.abort()
  }, [stock.id, userId])

  const runAnalysis = async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/stock-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          stock,
          aiConfig: config.aiConfig,
          forceRefresh,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? '个股 AI 分析失败')
      setResult(data.result as AiAnalysisResult)
      setRestoredFromHistory(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '个股 AI 分析失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">AI 深度分析</div>
            <div className="mt-1 text-xs text-muted-foreground">结合持仓、技术指标、估值和新闻驱动给出短中期观察建议。</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => runAnalysis(true)} disabled={loading}>
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              强制刷新
            </Button>
            <Button size="sm" onClick={() => runAnalysis(false)} disabled={loading}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {result ? '重新分析' : '开始分析'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!result && !error && (
          <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
            {historyLoading ? '正在读取最近一次个股 AI 分析...' : '点击“开始分析”后，系统会结合最新行情、估值、K 线技术指标和相关新闻生成结构化报告。'}
          </div>
        )}

        {result && (
          <>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">AI 结论</div>
                  <div className="mt-2 text-base font-medium text-foreground leading-7">{result.summary}</div>
                </div>
                <div className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-100">
                  <Clock className="mr-1 inline h-3.5 w-3.5" />
                  {restoredFromHistory ? '历史快照 · 非实时' : result.cached ? '缓存结果 · 非实时' : '分析快照 · 非实时'}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>分析时间：{new Date(result.generatedAt).toLocaleString('zh-CN')}</span>
                {result.cached && <span>命中缓存</span>}
                {restoredFromHistory && <span>刷新后自动恢复最近一次结果</span>}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Block title="事实依据" items={result.facts} />
              <Block title="核心判断" items={result.inferences} />
              <Block title="行动建议" items={result.actionPlan} />
              <Block title="失效信号" items={result.invalidationSignals} />
              <Block title="概率分析" items={result.probabilityAssessment.map((item) => `${item.label} ${item.probability}%：${item.rationale}`)} />
              <Block title="技术信号" items={result.technicalSignals.map((item) => `${item.name}：${item.value}，${item.interpretation}`)} />
              <Block title="关键价位" items={result.keyLevels} />
              <Block title="持仓建议" items={result.positionAdvice ?? []} />
              <Block title="新闻驱动" items={result.newsDrivers.map((item) => `${item.headline}（${item.source}）：${item.impact}`)} />
              <Block title="风险提示" items={result.risks} />
            </div>

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              {result.disclaimer}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items.map((item) => <div key={item} className="text-sm text-foreground leading-6">{item}</div>)
        ) : (
          <div className="text-sm text-muted-foreground">暂无内容</div>
        )}
      </div>
    </div>
  )
}
