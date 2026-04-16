'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import ConfirmDialog from '@/components/ConfirmDialog'
import AddStockModal from '@/components/AddStockModal'
import { useCurrency } from '@/hooks/useCurrency'
import { useStockQuote } from '@/hooks/useStockQuote'
import { useStockStore } from '@/store/useStockStore'
import { calcStockSummary, formatPnl } from '@/lib/finance'
import { MARKET_LABELS } from '@/config/defaults'
import type { Stock } from '@/types'

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
  const { displayCurrency, convertAmountSync, formatWithCurrency } = useCurrency()
  const [showAddStock, setShowAddStock] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; code: string } | null>(null)

  const visibleStocks = useMemo(
    () => (typeof limit === 'number' ? stocks.slice(0, limit) : stocks),
    [limit, stocks],
  )

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="text-xs text-muted-foreground mt-1">
            {description ?? (limit ? `展示前 ${visibleStocks.length} 条持仓，点击进入详情。` : `共 ${stocks.length} 只，支持删除与进入详情。`)}
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.8fr)_auto] gap-4 px-4 py-3 border-b border-border/70">
            <div className="text-xs text-muted-foreground">名称</div>
            <div className="text-xs text-muted-foreground">持仓成本</div>
            <div className="text-xs text-muted-foreground">盈亏</div>
            <div className="text-xs text-muted-foreground text-right">操作</div>
          </div>
          <div className="divide-y divide-border/70">
            {visibleStocks.map((stock) => (
              <StockListRow
                key={stock.id}
                stock={stock}
                displayCurrency={displayCurrency}
                convertAmountSync={convertAmountSync}
                formatWithCurrency={formatWithCurrency}
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
  displayCurrency,
  convertAmountSync,
  formatWithCurrency,
  onOpen,
  onDelete,
}: {
  stock: Stock
  displayCurrency: string
  convertAmountSync: (amount: number, fromMarket: string) => number
  formatWithCurrency: (amount: number) => string
  onOpen: () => void
  onDelete: () => void
}) {
  const { quote } = useStockQuote(stock.code, stock.market, { autoRefresh: true, refreshInterval: 60000 })
  const summary = calcStockSummary(stock, quote?.price)
  const totalCost = convertAmountSync(summary.avgCostPrice * summary.currentHolding, stock.market)
  const avgCost = convertAmountSync(summary.avgCostPrice, stock.market)
  const realizedPnl = convertAmountSync(summary.realizedPnl, stock.market)
  const unrealizedPnl = quote ? convertAmountSync(summary.unrealizedPnl, stock.market) : null
  const totalPnl = quote ? convertAmountSync(summary.totalPnl, stock.market) : null
  const todayPnl = quote ? convertAmountSync(summary.currentHolding * quote.change, stock.market) : null
  const currentPrice = quote ? convertAmountSync(quote.price, stock.market) : null

  return (
    <div
      className="px-4 py-4 grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.8fr)_auto] gap-3 md:gap-4 md:items-center group cursor-pointer hover:bg-secondary/30 transition-colors"
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
          {formatWithCurrency(totalCost)}
        </div>
        <div className="text-xs text-muted-foreground">
          持仓 {summary.currentHolding.toLocaleString()} 股
        </div>
        <div className="text-xs text-muted-foreground">
          均价 {formatWithCurrency(avgCost)}
        </div>
      </div>

      <div className="space-y-1">
        <div className={`text-sm font-mono font-semibold ${(totalPnl ?? realizedPnl) >= 0 ? 'profit-text' : 'loss-text'}`}>
          {formatPnl(totalPnl ?? realizedPnl, displayCurrency)}
        </div>
        {totalPnl === null ? (
          <div className="text-xs text-muted-foreground">
            已实现收益
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              已实现 {formatPnl(realizedPnl, displayCurrency)} · 浮动 {formatPnl(unrealizedPnl ?? 0, displayCurrency)}
            </div>
            <div className="text-xs text-muted-foreground">
              现价 {formatWithCurrency(currentPrice ?? 0)} · 今日{' '}
              <span className={(todayPnl ?? 0) >= 0 ? 'profit-text' : 'loss-text'}>
                {formatPnl(todayPnl ?? 0, displayCurrency)}
              </span>
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
