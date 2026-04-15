'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Trash2, ChevronRight, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import { calcStockSummary, formatPnl, formatPercent } from '@/lib/finance'
import { MARKET_LABELS } from '@/config/defaults'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useCurrency } from '@/hooks/useCurrency'
import AddStockModal from '@/components/AddStockModal'
import SettingsModal from '@/components/SettingsModal'
import StockDetail from '@/components/StockDetail'
import type { Stock } from '@/types'

export default function Dashboard() {
  const {
    stocks,
    isOffline,
    init,
    sync,
    deleteStock,
  } = useStockStore()
  const { displayCurrency, setDisplayCurrency, convertAmountSync, formatWithCurrency } = useCurrency()

  const [showAddStock, setShowAddStock] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedStockId, setSelectedStockId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; code: string } | null>(null)

  useEffect(() => {
    init()
  }, [init])

  const selectedStock = useMemo(
    () => stocks.find((s) => s.id === selectedStockId) || null,
    [stocks, selectedStockId]
  )

  const portfolio = useMemo(() => {
    let totalPnl = 0
    let totalInvested = 0
    let totalCommission = 0
    let totalDividend = 0
    let totalHolding = 0

    for (const stock of stocks) {
      const summary = calcStockSummary(stock)
      totalPnl += convertAmountSync(summary.totalPnl, stock.market)
      totalInvested += convertAmountSync(summary.totalBuyAmount, stock.market)
      totalCommission += convertAmountSync(summary.totalCommission, stock.market)
      totalDividend += convertAmountSync(summary.totalDividend, stock.market)
      totalHolding += summary.currentHolding
    }

    const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

    return { totalPnl, totalInvested, totalPnlPercent, totalCommission, totalDividend, totalHolding }
  }, [stocks, convertAmountSync])

  if (selectedStock) {
    return (
      <StockDetail
        stock={selectedStock}
        onBack={() => setSelectedStockId(null)}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center">
          <div className="text-sm font-semibold">StockTracker</div>

          <div className="flex items-center gap-2 ml-auto">
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
            {!isOffline && (
              <Button size="sm" variant="ghost" onClick={sync}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
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
            <div className="text-xs text-muted-foreground">基于已录入交易</div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">总盈亏</div>
            <div className={`text-xl font-bold font-mono ${portfolio.totalPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPnl(portfolio.totalPnl, displayCurrency)}
            </div>
            <div className={`text-xs mt-1 ${portfolio.totalPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPercent(portfolio.totalPnlPercent)}
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
              <div className="px-4 py-3 border-b border-border/70 flex items-center justify-between">
                <div className="text-xs text-muted-foreground">名称 / 代码</div>
                <div className="text-xs text-muted-foreground hidden md:block">持仓与成本</div>
                <div className="text-xs text-muted-foreground hidden md:block">盈亏</div>
                <div className="text-xs text-muted-foreground">操作</div>
              </div>
              <div className="divide-y divide-border/70">
                {stocks.map((stock: Stock) => {
                  const summary = calcStockSummary(stock)
                  const totalPnl = convertAmountSync(summary.totalPnl, stock.market)
                  return (
                    <div
                      key={stock.id}
                      className="px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 group cursor-pointer hover:bg-secondary/30 transition-colors"
                      onClick={() => setSelectedStockId(stock.id)}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-foreground truncate">{stock.name}</div>
                          <span className="text-xs text-muted-foreground font-mono">{stock.code}</span>
                          <span className="neutral-badge">{MARKET_LABELS[stock.market]}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          持仓 {summary.currentHolding.toLocaleString()} 股 · 均成本 {formatWithCurrency(convertAmountSync(summary.avgCostPrice, stock.market))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between md:justify-end gap-4 md:gap-6">
                        <div className="text-right">
                          <div className={`text-sm font-mono font-semibold ${totalPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                            {formatPnl(totalPnl, displayCurrency)}
                          </div>
                          <div className="text-xs text-muted-foreground">已实现</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteTarget({ id: stock.id, name: stock.name, code: stock.code })
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
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
          onAdded={(id) => setSelectedStockId(id)}
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
