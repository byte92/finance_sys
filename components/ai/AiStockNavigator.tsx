'use client'

import Link from 'next/link'
import { ChevronRight, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import { calcStockSummary } from '@/lib/finance'

export default function AiStockNavigator() {
  const { stocks } = useStockStore()

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">个股分析入口</h2>
        <div className="mt-1 text-xs text-muted-foreground">从这里直接进入对应股票详情页，触发 AI 深度分析。</div>
      </div>

      {stocks.length === 0 ? (
        <Card className="border-border bg-card">
          <div className="p-5 text-sm text-muted-foreground">当前没有持仓，先添加股票后再使用个股 AI 分析。</div>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {stocks.map((stock) => {
            const summary = calcStockSummary(stock)
            return (
              <Link
                key={stock.id}
                href={`/stock/${stock.id}`}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-card/80"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{stock.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground font-mono">{stock.code}</div>
                  </div>
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                </div>
                <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                  <div>当前持仓 {summary.currentHolding.toLocaleString()} 股</div>
                  <div>已实现收益 {summary.realizedPnl.toFixed(2)}</div>
                  <div>交易记录 {stock.trades.length} 条</div>
                </div>
                <div className="mt-4 inline-flex items-center text-xs font-medium text-primary">
                  进入详情分析
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
