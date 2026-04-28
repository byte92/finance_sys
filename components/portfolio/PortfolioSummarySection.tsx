'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import { useCurrency } from '@/hooks/useCurrency'
import { calcStockSummary, formatPnl, formatPercent } from '@/lib/finance'
import { MARKET_CURRENCY } from '@/lib/ExchangeRateService'
import type { StockQuote } from '@/types/stockApi'

type TodayPnlSnapshot = {
  amount: number
  rate: number
  marketValue: number
  costBasis: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
  gainers: number
  losers: number
  flat: number
  quoted: number
}

export default function PortfolioSummarySection() {
  const { stocks } = useStockStore()
  const { displayCurrency, convertAmountSync, formatWithCurrency, rates } = useCurrency()
  const [todayPnl, setTodayPnl] = useState<TodayPnlSnapshot>({
    amount: 0,
    rate: 0,
    marketValue: 0,
    costBasis: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    gainers: 0,
    losers: 0,
    flat: 0,
    quoted: 0,
  })
  const [todayPnlLoading, setTodayPnlLoading] = useState(false)

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

  useEffect(() => {
    let cancelled = false

    const convertWithRates = (amount: number, market: string) => {
      const fromCurrency = MARKET_CURRENCY[market] || 'CNY'
      if (fromCurrency === displayCurrency) {
        return amount
      }
      const fromRate = rates[fromCurrency] || 1
      const toRate = rates[displayCurrency] || 1
      return (amount * fromRate) / toRate
    }

    async function loadTodayPnl() {
      const activeHoldings = stocks
        .map((stock) => ({ stock, summary: calcStockSummary(stock) }))
        .filter(({ summary }) => summary.currentHolding > 0)

      if (activeHoldings.length === 0) {
        setTodayPnl({ amount: 0, rate: 0, marketValue: 0, costBasis: 0, unrealizedPnl: 0, unrealizedPnlPercent: 0, gainers: 0, losers: 0, flat: 0, quoted: 0 })
        return
      }

      setTodayPnlLoading(true)

      try {
        const responses = await Promise.all(
          activeHoldings.map(async ({ stock, summary }) => {
            const res = await fetch(
              `/api/stock/quote?symbol=${encodeURIComponent(stock.code)}&market=${encodeURIComponent(stock.market)}`,
              { cache: 'no-store' },
            )
            const data = await res.json()
            const quote = (data?.quote ?? null) as StockQuote | null
            if (!quote) {
              return null
            }

            const quotedSummary = calcStockSummary(stock, quote.price)
            const rawTodayPnl = summary.currentHolding * quote.change
            const rawPreviousValue = summary.currentHolding * Math.max(quote.price - quote.change, 0)
            const rawMarketValue = summary.currentHolding * quote.price
            const rawCostBasis = quotedSummary.avgCostPrice * quotedSummary.currentHolding
            return {
              todayPnl: convertWithRates(rawTodayPnl, stock.market),
              previousValue: convertWithRates(rawPreviousValue, stock.market),
              marketValue: convertWithRates(rawMarketValue, stock.market),
              costBasis: convertWithRates(rawCostBasis, stock.market),
            }
          }),
        )

        if (cancelled) {
          return
        }

        const next = responses.filter((item): item is { todayPnl: number; previousValue: number; marketValue: number; costBasis: number } => item !== null)
        const snapshot = next.reduce(
          (acc, item) => {
            acc.amount += item.todayPnl
            acc.rateBase += item.previousValue
            acc.marketValue += item.marketValue
            acc.costBasis += item.costBasis
            acc.quoted += 1
            if (item.todayPnl > 0) {
              acc.gainers += 1
            } else if (item.todayPnl < 0) {
              acc.losers += 1
            } else {
              acc.flat += 1
            }
            return acc
          },
          { amount: 0, rateBase: 0, marketValue: 0, costBasis: 0, gainers: 0, losers: 0, flat: 0, quoted: 0 },
        )
        const unrealizedPnl = snapshot.marketValue - snapshot.costBasis

        setTodayPnl({
          amount: snapshot.amount,
          rate: snapshot.rateBase > 0 ? (snapshot.amount / snapshot.rateBase) * 100 : 0,
          marketValue: snapshot.marketValue,
          costBasis: snapshot.costBasis,
          unrealizedPnl,
          unrealizedPnlPercent: snapshot.costBasis > 0 ? (unrealizedPnl / snapshot.costBasis) * 100 : 0,
          gainers: snapshot.gainers,
          losers: snapshot.losers,
          flat: snapshot.flat,
          quoted: snapshot.quoted,
        })
      } catch (error) {
        console.error('Failed to load portfolio daily pnl:', error)
        if (!cancelled) {
          setTodayPnl({ amount: 0, rate: 0, marketValue: 0, costBasis: 0, unrealizedPnl: 0, unrealizedPnlPercent: 0, gainers: 0, losers: 0, flat: 0, quoted: 0 })
        }
      } finally {
        if (!cancelled) {
          setTodayPnlLoading(false)
        }
      }
    }

    void loadTodayPnl()

    return () => {
      cancelled = true
    }
  }, [stocks, displayCurrency, rates])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">资产概览</h2>
          <div className="mt-1 text-xs text-muted-foreground">组合概览默认按已实现收益统计，并额外展示当日持仓涨跌</div>
        </div>
        <div className="text-xs text-muted-foreground">共 {portfolio.stockCount} 只资产</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-3">
        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">今日盈亏</div>
          <div className={`stat-value ${todayPnl.amount >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPnl(todayPnl.amount, displayCurrency)}
          </div>
          <div className={`stat-subvalue ${todayPnl.amount >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPercent(todayPnl.rate)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {todayPnlLoading
              ? '正在刷新当日行情'
              : todayPnl.quoted > 0
                ? `${todayPnl.gainers} 只上涨 · ${todayPnl.losers} 只下跌${todayPnl.flat > 0 ? ` · ${todayPnl.flat} 只平盘` : ''}`
                : '暂无可用行情'}
          </div>
        </Card>

        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">持有市值</div>
          <div className="stat-value text-foreground">
            {formatWithCurrency(todayPnl.marketValue)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {todayPnlLoading ? '正在刷新行情' : todayPnl.quoted > 0 ? `${todayPnl.quoted} 只持仓有行情` : '暂无可用行情'}
          </div>
        </Card>

        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">浮动盈亏</div>
          <div className={`stat-value ${todayPnl.unrealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPnl(todayPnl.unrealizedPnl, displayCurrency)}
          </div>
          <div className={`stat-subvalue ${todayPnl.unrealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPercent(todayPnl.unrealizedPnlPercent)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            成本 {formatWithCurrency(todayPnl.costBasis)}
          </div>
        </Card>

        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">累计已实现收益</div>
          <div className={`stat-value ${portfolio.totalRealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPnl(portfolio.totalRealizedPnl, displayCurrency)}
          </div>
          <div className={`stat-subvalue ${portfolio.totalRealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPercent(portfolio.totalRealizedPnlPercent)}
          </div>
        </Card>

        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">总手续费</div>
          <div className="stat-value text-foreground">
            {formatWithCurrency(portfolio.totalCommission)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">累计手续费</div>
        </Card>

        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">累计分红</div>
          <div className="stat-value text-foreground">
            {formatWithCurrency(portfolio.totalDividend)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">税后到账</div>
        </Card>

        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">持仓股数</div>
          <div className="stat-value text-foreground">
            {portfolio.totalHolding.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-1">全部市场</div>
        </Card>
      </div>
    </section>
  )
}
