'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, ChevronRight, Settings, Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import { calcStockSummary, formatPnl, formatPercent } from '@/lib/finance'
import { MARKET_LABELS } from '@/config/defaults'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useCurrency } from '@/hooks/useCurrency'
import { useStockQuote } from '@/hooks/useStockQuote'
import { useTheme } from '@/hooks/useTheme'
import AddStockModal from '@/components/AddStockModal'
import SettingsModal from '@/components/SettingsModal'
import type { Stock } from '@/types'

export default function Dashboard() {
  const router = useRouter()
  const {
    stocks,
    init,
    deleteStock,
  } = useStockStore()
  const { theme, toggleTheme, mounted } = useTheme()
  const { displayCurrency, setDisplayCurrency, convertAmountSync, formatWithCurrency } = useCurrency()

  const [showAddStock, setShowAddStock] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; code: string } | null>(null)

  useEffect(() => {
    init()
  }, [init])

  const portfolio = useMemo(() => {
    let totalRealizedPnl = 0
    let totalInvested = 0
    let totalCommission = 0
    let totalDividend = 0
    let totalHolding = 0

    for (const stock of stocks) {
      const summary = calcStockSummary(stock)
      totalRealizedPnl += convertAmountSync(summary.realizedPnl, stock.market)
      totalInvested += convertAmountSync(summary.totalBuyAmount, stock.market)
      totalCommission += convertAmountSync(summary.totalCommission, stock.market)
      totalDividend += convertAmountSync(summary.totalDividend, stock.market)
      totalHolding += summary.currentHolding
    }

    const totalRealizedPnlPercent = totalInvested > 0 ? (totalRealizedPnl / totalInvested) * 100 : 0

    return {
      totalRealizedPnl,
      totalInvested,
      totalRealizedPnlPercent,
      totalCommission,
      totalDividend,
      totalHolding,
    }
  }, [stocks, convertAmountSync])

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center">
          <div className="text-sm font-semibold">StockTracker</div>

          <div className="flex items-center gap-2 ml-auto">
            {mounted && (
              <Button variant="ghost" size="sm" onClick={toggleTheme} title={theme === 'dark' ? '切换亮色' : '切换暗色'}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            )}
            <div className="flex items-center gap-1 mr-2">
              <select
                value={displayCurrency}
                onChange={(e) => e.target.value && setDisplayCurrency(e.target.value as any)}
                className="text-xs bg-transparent border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="CNY">CNY</option>
                <option value="HKD">HKD</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setShowSettings(true)}>
              <Settings className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => setShowAddStock(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              添加股票
            </Button>
            <span className="text-xs text-muted-foreground">本地模式</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">资产概览</h2>
            <div className="text-xs text-muted-foreground">概览默认按已实现收益统计，不混入实时浮盈</div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">累计已实现收益</div>
            <div className={`text-xl font-bold font-mono ${portfolio.totalRealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPnl(portfolio.totalRealizedPnl, displayCurrency)}
            </div>
            <div className={`text-xs mt-1 ${portfolio.totalRealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPercent(portfolio.totalRealizedPnlPercent)}
            </div>
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">总手续费</div>
            <div className="text-lg font-bold font-mono text-foreground">
              {formatWithCurrency(portfolio.totalCommission)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">累计手续费</div>
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">累计分红</div>
            <div className="text-lg font-bold font-mono text-foreground">
              {formatWithCurrency(portfolio.totalDividend)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">税后到账</div>
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">持仓股数</div>
            <div className="text-lg font-bold font-mono text-foreground">
              {portfolio.totalHolding.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">全部市场</div>
          </Card>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">持仓列表</h2>
            <div className="text-xs text-muted-foreground">共 {stocks.length} 只</div>
          </div>

          {stocks.length === 0 ? (
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
                {stocks.map((stock: Stock) => {
                  return (
                    <StockListRow
                      key={stock.id}
                      stock={stock}
                      displayCurrency={displayCurrency}
                      convertAmountSync={convertAmountSync}
                      formatWithCurrency={formatWithCurrency}
                      onOpen={() => router.push(`/stock/${stock.id}`)}
                      onDelete={() => setDeleteTarget({ id: stock.id, name: stock.name, code: stock.code })}
                    />
                  )
                })}
              </div>
            </Card>
          )}
        </section>
      </main>

      {showAddStock && (
        <AddStockModal
          onClose={() => setShowAddStock(false)}
          onAdded={(id) => router.push(`/stock/${id}`)}
        />
      )}

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />

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
    </div>
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
              现价 {formatWithCurrency(currentPrice ?? 0)}
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
