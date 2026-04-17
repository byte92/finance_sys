'use client'

import { useState } from 'react'
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import type { AiAnalysisResult, Stock } from '@/types'

export default function StockAnalysisPanel({ stock }: { stock: Stock }) {
  const { config, userId } = useStockStore()
  const [result, setResult] = useState<AiAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
            点击“开始分析”后，系统会结合最新行情、估值、K 线技术指标和相关新闻生成结构化报告。
          </div>
        )}

        {result && (
          <>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">AI 结论</div>
              <div className="mt-2 text-base font-medium text-foreground">{result.summary}</div>
              <div className="mt-3 text-xs text-muted-foreground">
                生成于 {new Date(result.generatedAt).toLocaleString('zh-CN')} {result.cached ? '· 命中缓存' : ''}
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
