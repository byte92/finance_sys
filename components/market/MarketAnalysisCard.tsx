'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { describeClientRequestError, readJsonResponse } from '@/lib/api/client'
import { useStockStore } from '@/store/useStockStore'
import type { AiAnalysisResult } from '@/types'

const AI_ANALYSIS_UNAVAILABLE_MESSAGE = '服务暂时不可用，请稍后重试或点击强制刷新。'

export default function MarketAnalysisCard() {
  const { config, userId } = useStockStore()
  const [result, setResult] = useState<AiAnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const topSignals = useMemo(() => result?.technicalSignals.slice(0, 4) ?? [], [result])

  useEffect(() => {
    if (!userId) return

    const today = new Date().toISOString().slice(0, 10)

    const loadLatestTodayResult = async () => {
      setBootstrapping(true)
      try {
        const params = new URLSearchParams({
          userId,
          type: 'market',
          dateFrom: today,
          dateTo: today,
        })
        const res = await fetch(`/api/ai/history?${params.toString()}`, { cache: 'no-store' })
        const data = await readJsonResponse<{ records?: Array<{ result?: AiAnalysisResult }> }>(res, {
          fallbackMessage: '加载今日大盘分析失败',
          unavailableMessage: AI_ANALYSIS_UNAVAILABLE_MESSAGE,
        })
        const records = Array.isArray(data?.records) ? data.records : []
        const latest = records[0] as { result?: AiAnalysisResult } | undefined
        setResult(latest?.result ?? null)
      } catch (err) {
        console.error('Load market AI analysis history failed:', err)
        setError(describeClientRequestError(err, '加载今日大盘分析失败', AI_ANALYSIS_UNAVAILABLE_MESSAGE))
      } finally {
        setBootstrapping(false)
      }
    }

    void loadLatestTodayResult()
  }, [userId])

  const runAnalysis = async (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/market-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          aiConfig: config.aiConfig,
          forceRefresh,
        }),
      })
      const data = await readJsonResponse<{ result: AiAnalysisResult }>(res, {
        fallbackMessage: '大盘 AI 分析失败',
        unavailableMessage: AI_ANALYSIS_UNAVAILABLE_MESSAGE,
      })
      setResult(data.result as AiAnalysisResult)
    } catch (err) {
      console.error('Run market AI analysis failed:', err)
      setError(describeClientRequestError(err, '大盘 AI 分析失败', AI_ANALYSIS_UNAVAILABLE_MESSAGE))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">AI 大盘分析</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            结合三地指数涨跌结构、技术指标和近期新闻，生成短中期的大盘观察结论。
          </div>
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

      <Card className="border-border bg-card">
        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!result && !error && (
            <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
              {bootstrapping
                ? '正在加载今天的大盘分析结果...'
                : '点击“开始分析”后，系统会结合 A 股、港股、美股代表指数的行情、技术指标与新闻生成结构化大盘判断。'}
            </div>
          )}

          {result && (
            <>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">AI 总结</div>
                    <div className="mt-2 text-base font-medium text-foreground">{result.summary}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground">信心</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{formatConfidence(result.confidence)}</div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  生成于 {new Date(result.generatedAt).toLocaleString('zh-CN')} {result.cached ? '· 命中缓存' : ''}
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <InfoBlock title="事实依据" items={result.facts} emptyText="暂无事实依据" />
                <InfoBlock title="核心判断" items={result.inferences} emptyText="暂无核心判断" />
                <InfoBlock title="行动建议" items={result.actionPlan} emptyText="暂无行动建议" />
                <InfoBlock title="失效信号" items={result.invalidationSignals} emptyText="暂无失效信号" />
                <InfoBlock title="概率分析" items={result.probabilityAssessment.map((item) => `${item.label} ${item.probability}%：${item.rationale}`)} />
                <InfoBlock title="技术信号" items={topSignals.map((item) => `${item.name}：${item.value}，${item.interpretation}`)} emptyText="暂无技术信号" />
                <InfoBlock title="关键价位" items={result.keyLevels} emptyText="暂无关键价位" />
                <InfoBlock title="观察动作" items={result.actionableObservations} emptyText="暂无动作建议" />
                <InfoBlock title="新闻驱动" items={result.newsDrivers.map((item) => `${item.headline}（${item.source}）：${item.impact}`)} emptyText="暂无新闻驱动" />
                <InfoBlock title="风险提示" items={result.risks} emptyText="暂无额外风险" />
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                {result.disclaimer}
              </div>
            </>
          )}
        </div>
      </Card>
    </section>
  )
}

function InfoBlock({ title, items, emptyText = '暂无内容' }: { title: string; items: string[]; emptyText?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item} className="text-sm text-foreground leading-6">{item}</div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">{emptyText}</div>
        )}
      </div>
    </div>
  )
}

function formatConfidence(confidence: AiAnalysisResult['confidence']) {
  if (confidence === 'high') return '较高'
  if (confidence === 'low') return '偏低'
  return '中等'
}
