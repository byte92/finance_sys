'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Filter, Tag, Trash2, TrendingUp } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useStockStore } from '@/store/useStockStore'
import type { AiAnalysisHistoryRecord, AiConfidence } from '@/types'

const CONFIDENCE_LABELS: Record<AiConfidence, string> = {
  high: '高信心',
  medium: '中等信心',
  low: '低信心',
}

type HeatmapGranularity = 'day' | 'week' | 'month'
type HeatmapWindow = '90d' | 'year'

type BucketSummary = {
  key: string
  label: string
  count: number
  dominantConfidence: AiConfidence
  records: AiAnalysisHistoryRecord[]
}

export default function AiHistoryView() {
  const { userId } = useStockStore()
  const [records, setRecords] = useState<AiAnalysisHistoryRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'portfolio' | 'stock'>('ALL')
  const [confidenceFilter, setConfidenceFilter] = useState<'ALL' | AiConfidence>('ALL')
  const [tagFilter, setTagFilter] = useState('ALL')
  const [stockQuery, setStockQuery] = useState('')
  const [heatmapGranularity, setHeatmapGranularity] = useState<HeatmapGranularity>('day')
  const [heatmapWindow, setHeatmapWindow] = useState<HeatmapWindow>('90d')
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AiAnalysisHistoryRecord | null>(null)

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

  const handleDeleteRecord = async () => {
    if (!deleteTarget || !userId) return
    try {
      const res = await fetch('/api/ai/history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, id: deleteTarget.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error ?? '删除分析记录失败')
      }
      setRecords((current) => current.filter((record) => record.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除分析记录失败')
    }
  }

  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const record of records) {
      for (const tag of record.tags) tags.add(tag)
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [records])

  const recordsAfterFilters = useMemo(() => {
    const normalizedQuery = stockQuery.trim().toLowerCase()
    return records.filter((record) => {
      if (tagFilter !== 'ALL' && !record.tags.includes(tagFilter)) {
        return false
      }

      if (typeFilter === 'stock' && normalizedQuery) {
        const haystack = `${record.stockName ?? ''} ${record.stockCode ?? ''}`.toLowerCase()
        return haystack.includes(normalizedQuery)
      }

      return true
    })
  }, [records, stockQuery, tagFilter, typeFilter])

  const heatmapRecords = useMemo(() => {
    if (heatmapWindow === 'year') return recordsAfterFilters
    const threshold = new Date()
    threshold.setDate(threshold.getDate() - 89)
    const thresholdTime = threshold.getTime()
    return recordsAfterFilters.filter((record) => new Date(record.generatedAt).getTime() >= thresholdTime)
  }, [heatmapWindow, recordsAfterFilters])

  const heatmapBuckets = useMemo(() => {
    const grouped = new Map<string, BucketSummary>()

    for (const record of heatmapRecords) {
      const bucket = getTimeBucket(record.generatedAt, heatmapGranularity)
      const prev = grouped.get(bucket.key)
      if (!prev) {
        grouped.set(bucket.key, {
          key: bucket.key,
          label: bucket.label,
          count: 1,
          dominantConfidence: record.confidence,
          records: [record],
        })
        continue
      }

      prev.count += 1
      prev.records.push(record)
      prev.dominantConfidence = chooseStrongerConfidence(prev.dominantConfidence, record.confidence)
    }

    return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key))
  }, [heatmapGranularity, heatmapRecords])

  useEffect(() => {
    if (selectedBucketKey && !heatmapBuckets.some((bucket) => bucket.key === selectedBucketKey)) {
      setSelectedBucketKey(null)
    }
  }, [heatmapBuckets, selectedBucketKey])

  const selectedBucket = useMemo(
    () => heatmapBuckets.find((bucket) => bucket.key === selectedBucketKey) ?? null,
    [heatmapBuckets, selectedBucketKey],
  )

  const visibleRecords = useMemo(() => {
    if (!selectedBucket) return recordsAfterFilters
    const ids = new Set(selectedBucket.records.map((record) => record.id))
    return recordsAfterFilters.filter((record) => ids.has(record.id))
  }, [recordsAfterFilters, selectedBucket])

  const overviewStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const todayCount = recordsAfterFilters.filter((record) => record.generatedAt.slice(0, 10) === today).length
    const highCount = recordsAfterFilters.filter((record) => record.confidence === 'high').length
    const portfolioCount = recordsAfterFilters.filter((record) => record.type === 'portfolio').length
    const stockCount = recordsAfterFilters.filter((record) => record.type === 'stock').length

    return {
      total: recordsAfterFilters.length,
      todayCount,
      highCount,
      highShare: recordsAfterFilters.length > 0 ? Math.round((highCount / recordsAfterFilters.length) * 100) : 0,
      portfolioCount,
      stockCount,
    }
  }, [recordsAfterFilters])

  const pageCopy = useMemo(() => {
    if (typeFilter === 'portfolio') {
      return {
        title: '组合分析记录',
        description: '这里聚合的是面向整仓视角的历史分析，适合回看当时的仓位结构、风险暴露和组合判断。',
      }
    }
    if (typeFilter === 'stock') {
      return {
        title: '个股分析记录',
        description: '这里聚合的是单只股票的历史分析，更适合按股票代码、名称和时间回看当时的判断变化。',
      }
    }
    return {
      title: '全部分析记录',
      description: '先按频道切换记录类型，再通过信心、标签和时间导航进一步缩小范围。',
    }
  }, [typeFilter])

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <div className="p-5 space-y-4">
          <div>
            <div className="text-sm font-medium text-foreground">记录频道</div>
            <div className="mt-1 text-xs text-muted-foreground">先区分你要看的是组合分析，还是个股分析，再进入后续筛选。</div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <ChannelCard
              title="全部"
              description="混合查看组合与个股历史，用来纵览整体 AI 使用节奏。"
              active={typeFilter === 'ALL'}
              onClick={() => setTypeFilter('ALL')}
            />
            <ChannelCard
              title="组合分析"
              description="聚焦整仓视角的判断、仓位风险与组合观察。"
              active={typeFilter === 'portfolio'}
              onClick={() => setTypeFilter('portfolio')}
            />
            <ChannelCard
              title="个股分析"
              description="聚焦单只股票的历史结论、信心变化和重点观察。"
              active={typeFilter === 'stock'}
              onClick={() => setTypeFilter('stock')}
            />
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <div>
              <div className="text-sm font-medium text-foreground">{pageCopy.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{pageCopy.description}</div>
            </div>
          </div>

          <div className={`grid grid-cols-1 gap-3 ${typeFilter === 'stock' ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
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
            {typeFilter === 'stock' && (
              <input
                type="text"
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                placeholder="搜索股票名称或代码"
                className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
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

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="总分析次数" value={`${overviewStats.total}`} detail={loading ? '正在更新...' : '当前筛选结果'} />
        <StatCard label="今天新增" value={`${overviewStats.todayCount}`} detail="当天生成的分析数" />
        <StatCard label="高信心占比" value={`${overviewStats.highShare}%`} detail={`共 ${overviewStats.highCount} 条高信心记录`} />
        <StatCard label="分析构成" value={`${overviewStats.portfolioCount} / ${overviewStats.stockCount}`} detail="组合 / 个股" />
      </section>

      <Card className="border-border bg-card">
        <div className="p-5 space-y-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                <div className="text-sm font-medium text-foreground">时间导航</div>
              </div>
              <div className="mt-2 text-sm text-foreground">
                用热力图快速定位哪一天、哪一周或哪一月分析最密集。点击任意格子后，下面的历史记录会自动筛到对应时间段。
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                颜色代表该时间段的主导信心，深浅代表分析次数。
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <TagBadge active={heatmapWindow === '90d'} onClick={() => setHeatmapWindow('90d')}>
                近 90 天
              </TagBadge>
              <TagBadge active={heatmapWindow === 'year'} onClick={() => setHeatmapWindow('year')}>
                全年
              </TagBadge>
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
          </div>

          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            {heatmapBuckets.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {heatmapBuckets.map((bucket) => {
                  const active = bucket.key === selectedBucketKey
                  return (
                    <button
                      key={bucket.key}
                      type="button"
                      title={`${bucket.label} · ${bucket.count} 次 · ${CONFIDENCE_LABELS[bucket.dominantConfidence]}`}
                      onClick={() => setSelectedBucketKey((current) => current === bucket.key ? null : bucket.key)}
                      className={`flex h-12 min-w-12 items-center justify-center rounded-xl px-3 text-[11px] font-medium transition-all ${
                        active
                          ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background'
                          : ''
                      } ${heatColor(bucket.dominantConfidence, bucket.count)}`}
                    >
                      {bucket.label}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">暂无历史分析记录，先触发几次 AI 分析后这里会形成时间导航图。</div>
            )}
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
            <div className="rounded-xl border border-border/70 bg-card/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">当前时间焦点</div>
                  <div className="mt-2 text-base font-medium text-foreground">
                    {selectedBucket ? selectedBucket.label : heatmapWindow === '90d' ? '近 90 天整体节奏' : '全年整体节奏'}
                  </div>
                </div>
                {selectedBucket && (
                  <TagBadge active onClick={() => setSelectedBucketKey(null)}>
                    清除时间定位
                  </TagBadge>
                )}
              </div>
              <div className="mt-3 text-sm text-muted-foreground">
                {selectedBucket
                  ? `当前选中时间段共 ${selectedBucket.count} 次分析，下面的记录列表已自动同步筛选。`
                  : `你还没有选中具体时间段，下面列表展示的是${pageCopy.title}范围内的全部记录。`}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card/70 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">信心分布</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(['high', 'medium', 'low'] as const).map((confidence) => {
                  const count = (selectedBucket?.records ?? heatmapRecords).filter((record) => record.confidence === confidence).length
                  return (
                    <span
                      key={confidence}
                      className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium ${heatColor(confidence, Math.max(count, 1))}`}
                    >
                      {CONFIDENCE_LABELS[confidence]} {count}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card">
        <div className="p-5 space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">分析记录</div>
              <div className="mt-1 text-xs text-muted-foreground">
                这里是主工作区。先用频道、筛选器和时间导航锁定范围，再往下看具体分析。
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {loading ? '加载中...' : `共 ${visibleRecords.length} 条`}
            </div>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}

          {!error && visibleRecords.length === 0 && (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
              当前筛选条件下暂无分析记录。
            </div>
          )}

          <div className="space-y-3">
            {visibleRecords.map((record) => (
              record.type === 'portfolio' ? (
                <PortfolioRecordCard key={record.id} record={record} onDelete={() => setDeleteTarget(record)} />
              ) : (
                <StockRecordCard key={record.id} record={record} onDelete={() => setDeleteTarget(record)} />
              )
            ))}
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除分析记录"
        description={deleteTarget ? `确定删除 ${deleteTarget.type === 'portfolio' ? '这条组合分析' : `${deleteTarget.stockName ?? '该个股'}分析`} 吗？删除后无法恢复。` : undefined}
        confirmText="删除"
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={handleDeleteRecord}
      />
    </div>
  )
}

function ChannelCard({
  title,
  description,
  active,
  onClick,
}: {
  title: string
  description: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition-colors ${
        active
          ? 'border-primary/30 bg-primary/10'
          : 'border-border/70 bg-muted/20 hover:border-primary/20 hover:bg-card'
      }`}
    >
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">{description}</div>
    </button>
  )
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-foreground">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}

function TagBadge({
  children,
  active = false,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  onClick?: () => void
}) {
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

function StaticTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground">
      {children}
    </span>
  )
}

function PortfolioRecordCard({
  record,
  onDelete,
}: {
  record: AiAnalysisHistoryRecord
  onDelete: () => void
}) {
  return (
    <div className="group relative rounded-xl border border-border/70 bg-muted/20 p-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-3 top-3 opacity-0 transition-opacity text-muted-foreground hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 xl:pr-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">组合分析</span>
            {record.tags.slice(0, 4).map((tag) => (
              <StaticTag key={tag}>{tag}</StaticTag>
            ))}
          </div>
          <div className="mt-2 text-sm leading-6 text-foreground">{record.result.summary}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            {new Date(record.generatedAt).toLocaleString('zh-CN')} · {record.result.stance}
          </div>
        </div>

        <div className="shrink-0 rounded-xl border border-border/70 bg-card/70 px-3 py-2 pr-12 text-right">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">组合视角</div>
          <div className="mt-1 flex items-center justify-end gap-1 text-sm font-medium text-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            {record.result.portfolioRiskNotes?.length ?? 0} 个风险点
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <SmallBlock title="风险观察" items={record.result.portfolioRiskNotes?.slice(0, 3) ?? []} />
        <SmallBlock title="建议动作" items={record.result.actionableObservations.slice(0, 3)} />
      </div>
    </div>
  )
}

function StockRecordCard({
  record,
  onDelete,
}: {
  record: AiAnalysisHistoryRecord
  onDelete: () => void
}) {
  return (
    <div className="group relative rounded-xl border border-border/70 bg-muted/20 p-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-3 top-3 opacity-0 transition-opacity text-muted-foreground hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 xl:pr-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {record.stockName ?? '个股'} · {record.stockCode ?? ''}
            </span>
            {record.tags.slice(0, 5).map((tag) => (
              <StaticTag key={tag}>{tag}</StaticTag>
            ))}
          </div>
          <div className="mt-2 text-sm leading-6 text-foreground">{record.result.summary}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            {new Date(record.generatedAt).toLocaleString('zh-CN')} · {record.result.stance}
          </div>
        </div>

        <div className="shrink-0 rounded-xl border border-border/70 bg-card/70 px-3 py-2 pr-12 text-right">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">个股视角</div>
          <div className="mt-1 flex items-center justify-end gap-1 text-sm font-medium text-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            {record.result.probabilityAssessment.length} 个场景
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <SmallBlock title="概率分析" items={record.result.probabilityAssessment.map((item) => `${item.label} ${item.probability}%`)} />
        <SmallBlock title="关键动作" items={record.result.actionableObservations.slice(0, 3)} />
      </div>
    </div>
  )
}

function SmallBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-1.5">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item} className="text-sm text-foreground">
              {item}
            </div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">暂无内容</div>
        )}
      </div>
    </div>
  )
}

function chooseStrongerConfidence(current: AiConfidence | undefined, incoming: AiConfidence): AiConfidence {
  const score: Record<AiConfidence, number> = { low: 1, medium: 2, high: 3 }
  if (!current) return incoming
  return score[incoming] >= score[current] ? incoming : current
}

function getTimeBucket(isoString: string, granularity: HeatmapGranularity) {
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
    label: `${month}/${day}`,
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
  const level = count >= 6 ? 'shadow-sm' : count >= 3 ? 'opacity-100' : 'opacity-80'
  if (confidence === 'high') return `bg-emerald-500/25 text-emerald-200 ${level}`
  if (confidence === 'medium') return `bg-sky-500/20 text-sky-200 ${level}`
  return `bg-amber-500/20 text-amber-200 ${level}`
}
