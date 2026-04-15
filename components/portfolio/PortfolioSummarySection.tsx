'use client'

import { useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import { useCurrency } from '@/hooks/useCurrency'
import { calcStockSummary, formatPnl, formatPercent } from '@/lib/finance'

export default function PortfolioSummarySection() {
  const { stocks } = useStockStore()
  const { displayCurrency, convertAmountSync, formatWithCurrency } = useCurrency()

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
      stockCount: stocks.length,
    }
  }, [stocks, convertAmountSync])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">资产概览</h2>
          <div className="mt-1 text-xs text-muted-foreground">组合概览默认按已实现收益统计，不混入实时浮盈</div>
        </div>
        <div className="text-xs text-muted-foreground">共 {portfolio.stockCount} 只资产</div>
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
  )
}
