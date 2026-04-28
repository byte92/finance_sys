'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import ConfirmDialog from '@/components/ConfirmDialog'
import AddStockModal from '@/components/AddStockModal'
import { useCurrency } from '@/hooks/useCurrency'
import { useStockQuote } from '@/hooks/useStockQuote'
import { useStockStore } from '@/store/useStockStore'
import { calcStockSummary, formatPercent, formatPnl } from '@/lib/finance'
import { CURRENCY_SYMBOLS, MARKET_CURRENCY, type Currency } from '@/lib/ExchangeRateService'
import { MARKET_LABELS } from '@/config/defaults'
import type { Stock } from '@/types'
import type { StockQuote } from '@/types/stockApi'

type SortOption =
  | 'default'
  | 'today-pnl-desc'
  | 'today-pnl-asc'
  | 'today-rate-desc'
  | 'total-pnl-desc'
  | 'cost-desc'
  | 'name-asc'

type QuoteByStockId = Record<string, StockQuote | null>

export default function HoldingsList({
  limit,
  showAddButton = true,
  title = '持仓列表',
  description,
}: {
  limit?: number
  showAddButton?: boolean
  title?: string
  description?: string
}) {
  const router = useRouter()
  const { stocks, deleteStock } = useStockStore()
  const { convertAmountSync } = useCurrency()
  const [showAddStock, setShowAddStock] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; code: string } | null>(null)
  const [sortBy, setSortBy] = useState<SortOption>('default')
  const [quotesByStockId, setQuotesByStockId] = useState<QuoteByStockId>({})

  useEffect(() => {
    let cancelled = false

    async function loadQuotes() {
      const activeHoldings = stocks.filter((stock) => calcStockSummary(stock).currentHolding > 0)

      if (activeHoldings.length === 0) {
        setQuotesByStockId({})
        return
      }

      try {
        const responses = await Promise.all(
          activeHoldings.map(async (stock) => {
            const res = await fetch(
              `/api/stock/quote?symbol=${encodeURIComponent(stock.code)}&market=${encodeURIComponent(stock.market)}`,
              { cache: 'no-store' },
            )
            const data = await res.json()
            return [stock.id, (data?.quote ?? null) as StockQuote | null] as const
          }),
        )

        if (!cancelled) {
          setQuotesByStockId(Object.fromEntries(responses))
        }
      } catch (error) {
        console.error('Failed to preload holdings quotes:', error)
        if (!cancelled) {
          setQuotesByStockId({})
        }
      }
    }

    void loadQuotes()
    const timer = window.setInterval(loadQuotes, 60000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [stocks])

  const visibleStocks = useMemo(() => {
    const sorted = sortBy === 'default'
      ? [...stocks]
      : [...stocks].sort((left, right) => {
          if (sortBy === 'name-asc') {
            return left.code.localeCompare(right.code, 'zh-CN')
          }

          const leftQuote = quotesByStockId[left.id]
          const rightQuote = quotesByStockId[right.id]
          const leftSummary = calcStockSummary(left, leftQuote?.price)
          const rightSummary = calcStockSummary(right, rightQuote?.price)

          const leftTodayPnl = leftQuote ? convertAmountSync(leftSummary.currentHolding * leftQuote.change, left.market) : Number.NEGATIVE_INFINITY
          const rightTodayPnl = rightQuote ? convertAmountSync(rightSummary.currentHolding * rightQuote.change, right.market) : Number.NEGATIVE_INFINITY

          const leftPrevValueRaw = leftQuote ? leftSummary.currentHolding * Math.max(leftQuote.price - leftQuote.change, 0) : 0
          const rightPrevValueRaw = rightQuote ? rightSummary.currentHolding * Math.max(rightQuote.price - rightQuote.change, 0) : 0
          const leftPrevValue = leftPrevValueRaw > 0 ? convertAmountSync(leftPrevValueRaw, left.market) : 0
          const rightPrevValue = rightPrevValueRaw > 0 ? convertAmountSync(rightPrevValueRaw, right.market) : 0
          const leftTodayRate = leftPrevValue > 0 ? leftTodayPnl / leftPrevValue : Number.NEGATIVE_INFINITY
          const rightTodayRate = rightPrevValue > 0 ? rightTodayPnl / rightPrevValue : Number.NEGATIVE_INFINITY

          const leftTotalPnl = leftQuote
            ? convertAmountSync(leftSummary.totalPnl, left.market)
            : convertAmountSync(leftSummary.realizedPnl, left.market)
          const rightTotalPnl = rightQuote
            ? convertAmountSync(rightSummary.totalPnl, right.market)
            : convertAmountSync(rightSummary.realizedPnl, right.market)

          const leftCost = convertAmountSync(leftSummary.avgCostPrice * leftSummary.currentHolding, left.market)
          const rightCost = convertAmountSync(rightSummary.avgCostPrice * rightSummary.currentHolding, right.market)

          switch (sortBy) {
            case 'today-pnl-desc':
              return rightTodayPnl - leftTodayPnl
            case 'today-pnl-asc':
              return leftTodayPnl - rightTodayPnl
            case 'today-rate-desc':
              return rightTodayRate - leftTodayRate
            case 'total-pnl-desc':
              return rightTotalPnl - leftTotalPnl
            case 'cost-desc':
              return rightCost - leftCost
            default:
              return 0
          }
        })

    return typeof limit === 'number' ? sorted.slice(0, limit) : sorted
  }, [convertAmountSync, limit, quotesByStockId, sortBy, stocks])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="text-xs text-muted-foreground mt-1">
            {description ?? (limit ? `展示前 ${visibleStocks.length} 条持仓，点击进入详情。` : `共 ${stocks.length} 只，支持删除与进入详情。`)}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortOption)}
            containerClassName="w-[176px]"
            aria-label="持仓排序"
          >
            <option value="default">默认顺序</option>
            <option value="today-pnl-desc">今日盈亏从高到低</option>
            <option value="today-pnl-asc">今日盈亏从低到高</option>
            <option value="today-rate-desc">今日盈亏率从高到低</option>
            <option value="total-pnl-desc">总盈亏从高到低</option>
            <option value="cost-desc">持仓成本从高到低</option>
            <option value="name-asc">代码顺序</option>
          </Select>
          {limit && stocks.length > visibleStocks.length && (
            <Button size="sm" variant="outline" onClick={() => router.push('/portfolio')}>
              查看全部
            </Button>
          )}
          {showAddButton && (
            <Button size="sm" onClick={() => setShowAddStock(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              添加股票
            </Button>
          )}
        </div>
      </div>

      {visibleStocks.length === 0 ? (
        <Card className="border-border bg-card">
          <div className="p-6 text-sm text-muted-foreground">
            还没有添加股票，点击右上角“添加股票”开始记录。
          </div>
        </Card>
      ) : (
        <Card className="border-border bg-card/60 overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_auto] gap-4 px-4 py-3 border-b border-border/70">
            <div className="text-xs text-muted-foreground">名称</div>
            <div className="text-xs text-muted-foreground">持仓成本</div>
            <div className="text-xs text-muted-foreground">今日盈亏</div>
            <div className="text-xs text-muted-foreground">总盈亏</div>
            <div className="text-xs text-muted-foreground text-right">操作</div>
          </div>
          <div className="divide-y divide-border/70">
            {visibleStocks.map((stock) => (
              <StockListRow
                key={stock.id}
                stock={stock}
                preloadedQuote={quotesByStockId[stock.id] ?? null}
                onOpen={() => router.push(`/stock/${stock.id}`)}
                onDelete={() => setDeleteTarget({ id: stock.id, name: stock.name, code: stock.code })}
              />
            ))}
          </div>
        </Card>
      )}

      {showAddStock && (
        <AddStockModal
          onClose={() => setShowAddStock(false)}
          onAdded={(id) => router.push(`/stock/${id}`)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除持仓"
        description={deleteTarget ? `确定删除 ${deleteTarget.name}（${deleteTarget.code}）？该操作不可恢复。` : undefined}
        confirmText="删除"
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={async () => {
          if (!deleteTarget) return
          await deleteStock(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </section>
  )
}

function StockListRow({
  stock,
  preloadedQuote,
  onOpen,
  onDelete,
}: {
  stock: Stock
  preloadedQuote: StockQuote | null
  onOpen: () => void
  onDelete: () => void
}) {
  const { quote: liveQuote } = useStockQuote(stock.code, stock.market, { autoRefresh: true, refreshInterval: 60000 })
  const quote = liveQuote ?? preloadedQuote
  const summary = calcStockSummary(stock, quote?.price)
  const nativeCurrency = MARKET_CURRENCY[stock.market] || 'CNY'
  const formatNativeAmount = (amount: number) => formatWithNativeCurrency(amount, nativeCurrency)
  const totalCost = summary.avgCostPrice * summary.currentHolding
  const avgCost = summary.avgCostPrice
  const realizedPnl = summary.realizedPnl
  const unrealizedPnl = quote ? summary.unrealizedPnl : null
  const totalPnl = quote ? summary.totalPnl : null
  const todayPnl = quote ? summary.currentHolding * quote.change : null
  const previousClose = quote ? quote.price - quote.change : null
  const todayPnlRate = quote && previousClose && previousClose > 0 ? (quote.change / previousClose) * 100 : null
  const currentPrice = quote ? quote.price : null

  return (
    <div
      className="px-4 py-4 grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_auto] gap-3 md:gap-4 md:items-center group cursor-pointer hover:bg-secondary/30 transition-colors"
      onClick={onOpen}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-foreground truncate">{stock.name}</div>
          <span className="text-xs text-muted-foreground font-mono">{stock.code}</span>
          <span className="neutral-badge">{MARKET_LABELS[stock.market]}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {stock.code} · {MARKET_LABELS[stock.market]}
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-sm font-mono font-semibold text-foreground">
          {formatNativeAmount(totalCost)}
        </div>
        <div className="text-xs text-muted-foreground">
          持仓 {summary.currentHolding.toLocaleString()} 股
        </div>
        <div className="text-xs text-muted-foreground">
          均价 {formatNativeAmount(avgCost)}
        </div>
      </div>

      <div className="space-y-1">
        <div className={`text-sm font-mono font-semibold ${(todayPnl ?? 0) >= 0 ? 'profit-text' : 'loss-text'}`}>
          {quote ? formatPnl(todayPnl ?? 0, nativeCurrency) : '--'}
        </div>
        <div className={`text-xs ${(todayPnlRate ?? 0) >= 0 ? 'profit-text' : 'loss-text'}`}>
          {todayPnlRate === null ? '暂无当日行情' : formatPercent(todayPnlRate)}
        </div>
        <div className="text-xs text-muted-foreground">
          {quote ? `现价 ${formatNativeAmount(currentPrice ?? 0)}` : '等待行情返回'}
        </div>
      </div>

      <div className="space-y-1">
        <div className={`text-sm font-mono font-semibold ${(totalPnl ?? realizedPnl) >= 0 ? 'profit-text' : 'loss-text'}`}>
          {formatPnl(totalPnl ?? realizedPnl, nativeCurrency)}
        </div>
        {totalPnl === null ? (
          <div className="text-xs text-muted-foreground">
            已实现收益
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              已实现 {formatPnl(realizedPnl, nativeCurrency)} · 浮动 {formatPnl(unrealizedPnl ?? 0, nativeCurrency)}
            </div>
            <div className="text-xs text-muted-foreground">
              累计视角
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between md:justify-end gap-1">
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive opacity-70 md:opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function formatWithNativeCurrency(amount: number, currency: Currency) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '¥'
  return `${symbol}${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
