'use client'

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { MarketIndexSnapshot, MarketRegion } from '@/types'

type MarketGroup = {
  region: MarketRegion
  label: string
  indices: MarketIndexSnapshot[]
  upCount: number
  downCount: number
  flatCount: number
}

type MarketOverviewResponse = {
  groups: MarketGroup[]
  totalUpCount: number
  totalDownCount: number
  totalFlatCount: number
  strongestIndex: MarketIndexSnapshot | null
  weakestIndex: MarketIndexSnapshot | null
  updatedAt: string
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  HKD: 'HK$',
  USD: '$',
}

export default function MarketOverviewBoard() {
  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadOverview = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/market/overview', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error ?? '获取大盘数据失败')
      }
      setOverview(data as MarketOverviewResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取大盘数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOverview()
  }, [])

  const totalIndices = useMemo(
    () => overview?.groups.reduce((sum, group) => sum + group.indices.length, 0) ?? 0,
    [overview],
  )

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">三地大盘概览</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            同时查看 A 股、港股和美股代表性指数，快速判断今天的大盘情绪和强弱结构。
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => loadOverview()} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新数据
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="覆盖指数" value={`${totalIndices}`} detail={loading ? '正在刷新...' : '当前面板内全部指数'} />
        <StatCard label="上涨指数" value={`${overview?.totalUpCount ?? 0}`} detail="今日收涨数量" />
        <StatCard label="下跌指数" value={`${overview?.totalDownCount ?? 0}`} detail="今日收跌数量" />
        <StatCard
          label="最强 / 最弱"
          value={overview ? `${overview.strongestIndex?.name ?? '--'} / ${overview.weakestIndex?.name ?? '--'}` : '--'}
          detail={overview ? `${overview.strongestIndex?.changePercent.toFixed(2) ?? '--'}% / ${overview.weakestIndex?.changePercent.toFixed(2) ?? '--'}%` : '等待数据'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {overview?.groups.map((group) => (
          <Card key={group.region} className="border-border bg-card">
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{group.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    上涨 {group.upCount} · 下跌 {group.downCount} · 平盘 {group.flatCount}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {overview.updatedAt ? `更新于 ${new Date(overview.updatedAt).toLocaleTimeString('zh-CN')}` : ''}
                </div>
              </div>

              <div className="space-y-3">
                {group.indices.map((index) => (
                  <div key={index.id} className="rounded-xl border border-border/70 bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">{index.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{index.code}</div>
                      </div>
                      <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${index.change >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                        {index.change >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                        {index.change >= 0 ? '偏强' : '偏弱'}
                      </div>
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <div className="text-xl font-semibold font-mono text-foreground">
                          {formatIndexValue(index.price, index.currency)}
                        </div>
                        <div className={`mt-1 text-sm font-mono ${index.change >= 0 ? 'profit-text' : 'loss-text'}`}>
                          {formatSignedValue(index.change, index.currency)} · {formatSignedPercent(index.changePercent)}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground space-y-1">
                        <div>开盘 {index.open ? formatIndexValue(index.open, index.currency) : '--'}</div>
                        <div>高低 {index.high ? formatIndexValue(index.high, index.currency) : '--'} / {index.low ? formatIndexValue(index.low, index.currency) : '--'}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-3 text-xl font-semibold text-foreground">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}

function formatIndexValue(value: number, currency: string) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? ''
  return `${symbol}${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatSignedValue(value: number, currency: string) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? ''
  const sign = value >= 0 ? '+' : ''
  return `${sign}${symbol}${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatSignedPercent(value: number) {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}
