'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Filter, Tag } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import type { AiAnalysisHistoryRecord, AiConfidence } from '@/types'

const CONFIDENCE_LABELS: Record<AiConfidence, string> = {
  high: '高信心',
  medium: '中等信心',
  low: '低信心',
}

export default function AiHistoryView() {
  const { userId } = useStockStore()
  const [records, setRecords] = useState<AiAnalysisHistoryRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'portfolio' | 'stock'>('ALL')
  const [confidenceFilter, setConfidenceFilter] = useState<'ALL' | AiConfidence>('ALL')
  const [tagFilter, setTagFilter] = useState('ALL')
  const [heatmapGranularity, setHeatmapGranularity] = useState<'day' | 'week' | 'month'>('day')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    if (!userId) return
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ userId })
        if (typeFilter !== 'ALL') params.set('type', typeFilter)
        if (confidenceFilter !== 'ALL') params.set('confidence', confidenceFilter)
        if (dateFrom) params.set('dateFrom', dateFrom)
        if (dateTo) params.set('dateTo', dateTo)
        const res = await fetch(`/api/ai/history?${params.toString()}`, { cache: 'no-store' })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? '获取历史失败')
        setRecords(data.records as AiAnalysisHistoryRecord[])
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取历史失败')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [confidenceFilter, dateFrom, dateTo, typeFilter, userId])

  const heatmapBuckets = useMemo(() => {
    const source = records.filter((record) => tagFilter === 'ALL' || record.tags.includes(tagFilter))
    const grouped = new Map<string, { count: number; confidence: AiConfidence; label: string }>()
    for (const record of source) {
      const { key, label } = getTimeBucket(record.generatedAt, heatmapGranularity)
      const prev = grouped.get(key)
      const nextConfidence = chooseStrongerConfidence(prev?.confidence, record.confidence)
      grouped.set(key, {
        count: (prev?.count ?? 0) + 1,
        confidence: nextConfidence,
        label,
      })
    }
    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => ({ key, ...value }))
  }, [heatmapGranularity, records, tagFilter])

  const visibleRecords = useMemo(
    () => records.filter((record) => tagFilter === 'ALL' || record.tags.includes(tagFilter)),
    [records, tagFilter],
  )

  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const record of records) {
      for (const tag of record.tags) tags.add(tag)
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [records])

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <div className="text-sm font-medium text-foreground">筛选条件</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="ALL">全部分析类型</option>
              <option value="portfolio">组合分析</option>
              <option value="stock">个股分析</option>
            </select>
            <select
              value={confidenceFilter}
              onChange={(e) => setConfidenceFilter(e.target.value as typeof confidenceFilter)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="ALL">全部信心标签</option>
              <option value="high">高信心</option>
              <option value="medium">中等信心</option>
              <option value="low">低信心</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <TagBadge active={tagFilter === 'ALL'} onClick={() => setTagFilter('ALL')}>全部标签</TagBadge>
            {availableTags.map((tag) => (
              <TagBadge key={tag} active={tagFilter === tag} onClick={() => setTagFilter(tag)}>
                {tag}
              </TagBadge>
            ))}
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <div>
              <div className="text-sm font-medium text-foreground">AI 信心热力图</div>
              <div className="text-xs text-muted-foreground mt-1">
                支持按天、按周、按月聚合展示 AI 分析次数，并用颜色表示该时间桶内的最高信心标签。
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <TagBadge active={heatmapGranularity === 'day'} onClick={() => setHeatmapGranularity('day')}>
              按天
            </TagBadge>
            <TagBadge active={heatmapGranularity === 'week'} onClick={() => setHeatmapGranularity('week')}>
              按周
            </TagBadge>
            <TagBadge active={heatmapGranularity === 'month'} onClick={() => setHeatmapGranularity('month')}>
              按月
            </TagBadge>
          </div>
          <div className="flex flex-wrap gap-2">
            {heatmapBuckets.length > 0 ? heatmapBuckets.map((item) => (
              <div
                key={item.key}
                title={`${item.label} · ${item.count} 次 · ${CONFIDENCE_LABELS[item.confidence]}`}
                className={`flex h-12 min-w-12 items-center justify-center rounded-md px-2 text-[10px] font-medium ${heatColor(item.confidence, item.count)}`}
              >
                {item.label}
              </div>
            )) : (
              <div className="text-sm text-muted-foreground">暂无历史分析记录，先触发几次 AI 分析后这里会形成日历图。</div>
            )}
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card">
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-foreground">分析记录</div>
            <div className="text-xs text-muted-foreground">{loading ? '加载中...' : `共 ${visibleRecords.length} 条`}</div>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}

          {!error && visibleRecords.length === 0 && (
            <div className="text-sm text-muted-foreground">暂无符合条件的分析记录。</div>
          )}

          <div className="space-y-3">
            {visibleRecords.map((record) => (
              <div key={record.id} className="rounded-xl border border-border/70 bg-muted/20 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {record.type === 'portfolio' ? '组合分析' : `${record.stockName ?? '个股'} · ${record.stockCode ?? ''}`}
                      </span>
                      {record.tags.slice(0, 5).map((tag) => (
                        <TagBadge key={tag} active={tagFilter === tag} onClick={() => setTagFilter(tag)}>
                          {tag}
                        </TagBadge>
                      ))}
                    </div>
                    <div className="mt-2 text-sm text-foreground leading-6">{record.result.summary}</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {new Date(record.generatedAt).toLocaleString('zh-CN')} · {record.result.stance}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    概率数：{record.result.probabilityAssessment.length}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <SmallBlock title="概率分析" items={record.result.probabilityAssessment.map((item) => `${item.label} ${item.probability}%`)} />
                  <SmallBlock title="关键动作" items={record.result.actionableObservations.slice(0, 3)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

function TagBadge({ children, active = false, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border/70 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function SmallBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-1.5">
        {items.length > 0 ? items.map((item) => (
          <div key={item} className="text-sm text-foreground">{item}</div>
        )) : <div className="text-sm text-muted-foreground">暂无内容</div>}
      </div>
    </div>
  )
}

function chooseStrongerConfidence(current: AiConfidence | undefined, incoming: AiConfidence): AiConfidence {
  const score: Record<AiConfidence, number> = { low: 1, medium: 2, high: 3 }
  if (!current) return incoming
  return score[incoming] >= score[current] ? incoming : current
}

function getTimeBucket(isoString: string, granularity: 'day' | 'week' | 'month') {
  const date = new Date(isoString)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  if (granularity === 'month') {
    return {
      key: `${year}-${month}`,
      label: `${month}月`,
    }
  }

  if (granularity === 'week') {
    const week = getWeekNumber(date)
    return {
      key: `${year}-W${String(week).padStart(2, '0')}`,
      label: `W${String(week).padStart(2, '0')}`,
    }
  }

  return {
    key: `${year}-${month}-${day}`,
    label: day,
  }
}

function getWeekNumber(date: Date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = utcDate.getUTCDay() || 7
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1))
  return Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function heatColor(confidence: AiConfidence, count: number) {
  const intensity = count >= 4 ? 'font-semibold' : 'font-medium'
  if (confidence === 'high') return `bg-emerald-500/25 text-emerald-300 ${intensity}`
  if (confidence === 'medium') return `bg-sky-500/20 text-sky-300 ${intensity}`
  return `bg-amber-500/20 text-amber-300 ${intensity}`
}
