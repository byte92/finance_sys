'use client'

import { useState } from 'react'
import { ArrowLeft, Plus, Trash2, TrendingUp, TrendingDown, DollarSign, RefreshCw, Gift, Sun, Moon, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import { calcStockSummary, formatPnl, formatPercent } from '@/lib/finance'
import { MARKET_LABELS } from '@/config/defaults'
import { useStockQuote } from '@/hooks/useStockQuote'
import { useTheme } from '@/hooks/useTheme'
import { useCurrency } from '@/hooks/useCurrency'
import AddTradeModal from '@/components/AddTradeModal'
import AddStockModal from '@/components/AddStockModal'
import StockKline from '@/components/StockKline'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { Stock, Trade, TradePnlDetail } from '@/types'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'

interface StockDetailProps {
  stock: Stock
  onBack: () => void
}

export default function StockDetail({ stock, onBack }: StockDetailProps) {
  const { deleteTrade } = useStockStore()
  const { theme, toggleTheme, mounted } = useTheme()
  const { displayCurrency, setDisplayCurrency, convertAmountSync, formatWithCurrency } = useCurrency()
  const [showAddTrade, setShowAddTrade] = useState(false)
  const [showEditStock, setShowEditStock] = useState(false)
  const [editTrade, setEditTrade] = useState<Trade | undefined>(undefined)
  const [manualPrice, setManualPrice] = useState('')
  const [deleteTradeTarget, setDeleteTradeTarget] = useState<Trade | null>(null)

  const { quote, loading, error, forceRefresh } = useStockQuote(
    stock.code, stock.market,
    { autoRefresh: true, refreshInterval: 60000 }
  )

  const currentPriceNum = quote?.price || parseFloat(manualPrice) || undefined
  const summary = calcStockSummary(stock, currentPriceNum)
  const convertMoney = (amount: number) => convertAmountSync(amount, stock.market)
  const isFundLike = stock.market === 'FUND' || isEtfLikeCode(stock.code, stock.market)

  // 按日期倒序展示，且 tradePnlDetails 与 trades 对齐
  const sortedTrades = [...stock.trades].sort((a, b) => b.date.localeCompare(a.date))
  // 构建 tradeId -> pnlDetail 的映射（finance.ts 按时间正序计算）
  const pnlMap = new Map<string, TradePnlDetail>(
    summary.tradePnlDetails.map((d) => [d.tradeId, d])
  )
  const closingTradeIds = (() => {
    const sorted = [...stock.trades].sort((a, b) => a.date.localeCompare(b.date))
    let holding = 0
    const ids = new Set<string>()

    for (const trade of sorted) {
      if (trade.type === 'BUY') {
        holding += trade.quantity
      } else if (trade.type === 'SELL') {
        const nextHolding = holding - trade.quantity
        if (holding > 0 && nextHolding === 0) {
          ids.add(trade.id)
        }
        holding = nextHolding
      }
    }

    return ids
  })()

  // 构建盈亏曲线数据（按时间正序，只显示有盈亏变化的点）
  const chartData = (() => {
    const sorted = [...stock.trades].sort((a, b) => a.date.localeCompare(b.date))
    let cumPnl = 0
    const pts: Array<{ date: string; pnl: number; type: string }> = []
    // 添加起始点（显示为0）
    pts.push({ date: '起始', pnl: 0, type: 'START' })
    for (const t of sorted) {
      const detail = pnlMap.get(t.id)
      if (t.type === 'SELL' && detail) {
        cumPnl += detail.pnl
        pts.push({ date: t.date, pnl: convertMoney(cumPnl), type: 'SELL' })
      } else if (t.type === 'DIVIDEND' && detail) {
        cumPnl += detail.pnl
        pts.push({ date: t.date, pnl: convertMoney(cumPnl), type: 'DIVIDEND' })
      }
    }
    return pts
  })()

  const isProfitable = summary.realizedPnl >= 0

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">{stock.name}</span>
              <span className="text-xs text-muted-foreground font-mono">{stock.code}</span>
              <span className="neutral-badge">{MARKET_LABELS[stock.market]}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mounted && (
              <Button variant="ghost" size="sm" onClick={toggleTheme} title={theme === 'dark' ? '切换亮色' : '切换暗色'}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            )}
            <div className="flex items-center gap-1 mr-3">
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
            <Button size="sm" onClick={() => setShowAddTrade(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              添加交易
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowEditStock(true)}>
              <Edit className="h-3.5 w-3.5 mr-1" />
              编辑股票
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* 汇总卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">总收益</div>
            <div className={`text-xl font-bold font-mono ${summary.totalPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPnl(convertMoney(summary.totalPnl), displayCurrency)}
            </div>
            {summary.currentHolding > 0 && currentPriceNum ? (
              <div className="text-xs text-muted-foreground mt-1">
                已实现 + 浮动
              </div>
            ) : (
              <div className={`text-xs mt-1 ${summary.totalPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                {formatPercent(summary.totalPnlPercent)}
              </div>
            )}
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">已实现收益</div>
            <div className={`text-lg font-bold font-mono ${summary.realizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPnl(convertMoney(summary.realizedPnl), displayCurrency)}
            </div>
            {summary.totalDividend > 0 && (
              <div className="text-xs text-primary mt-0.5">含分红 {formatWithCurrency(convertMoney(summary.totalDividend))}</div>
            )}
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">当前持仓</div>
            <div className="text-lg font-bold font-mono text-foreground">
              {summary.currentHolding.toLocaleString()} 股
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              均成本 {formatWithCurrency(convertMoney(summary.avgCostPrice))}
            </div>
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">总手续费</div>
            <div className="text-lg font-bold font-mono text-foreground">
              {formatWithCurrency(convertMoney(summary.totalCommission))}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{summary.tradeCount} 笔买卖</div>
          </Card>
        </div>

        {/* 当前价格 & 浮动盈亏 */}
        {summary.currentHolding > 0 && (
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground whitespace-nowrap">当前价格</span>

                {quote ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-foreground">{formatWithCurrency(convertMoney(quote.price))}</span>
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${quote.changePercent >= 0 ? 'bg-profit/15 profit-text' : 'bg-loss/15 loss-text'}`}>
                      {quote.changePercent >= 0 ? '↑' : '↓'} {Math.abs(quote.changePercent).toFixed(2)}%
                    </span>
                    <span className="text-xs text-muted-foreground">· {quote.source}</span>
                  </div>
                ) : (
                  <Input
                    type="number" step="0.001" min="0"
                    placeholder={loading ? '获取中...' : '手动输入当前价格...'}
                    value={manualPrice} onChange={(e) => setManualPrice(e.target.value)}
                    className="max-w-44 h-8 text-sm"
                  />
                )}

                <div className="ml-auto flex items-center gap-2">
                  {error && !quote && (
                    <span className="text-xs text-muted-foreground">{error}，请手动输入</span>
                  )}
                  <Button size="sm" variant="ghost" onClick={forceRefresh} disabled={loading} className="h-8 px-2">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              {currentPriceNum && currentPriceNum > 0 && (
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-6">
                  <div>
                    <div className="text-xs text-muted-foreground">浮动盈亏</div>
                    <div className={`text-base font-bold font-mono ${summary.unrealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                      {formatPnl(convertMoney(summary.unrealizedPnl), displayCurrency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">市值</div>
                    <div className="text-base font-bold font-mono text-foreground">
                      {formatWithCurrency(convertMoney(currentPriceNum * summary.currentHolding))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">总收益</div>
                    <div className={`text-base font-bold font-mono ${summary.totalPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                      {formatPnl(convertMoney(summary.totalPnl), displayCurrency)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">成本</div>
                    <div className="text-base font-bold font-mono text-foreground">
                      {formatWithCurrency(convertMoney(summary.avgCostPrice * summary.currentHolding))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(quote || !isFundLike) && (
          <Card className="border-border bg-card">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-foreground">估值信息</div>
                {quote?.valuationSource && (
                  <div className="text-xs text-muted-foreground">估值源：{quote.valuationSource}</div>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                  label="PE(TTM)"
                  value={isFundLike ? '不适用' : formatOptionalRatio(quote?.peTtm)}
                />
                <MetricCard
                  label="EPS(TTM)"
                  value={isFundLike ? '不适用' : formatOptionalMoney(quote?.epsTtm, quote?.currency)}
                />
                <MetricCard
                  label="PB"
                  value={isFundLike ? '不适用' : formatOptionalRatio(quote?.pb)}
                />
                <MetricCard
                  label="总市值"
                  value={isFundLike ? '不适用' : formatOptionalMarketCap(quote?.marketCap, quote?.currency)}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* 盈亏曲线 */}
        {chartData.length > 1 && (
          <Card className="border-border">
            <div className="p-5 pb-3">
              <h3 className="text-sm font-medium text-foreground">已实现盈亏曲线</h3>
            </div>
            <div className="h-48 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%" className="focus:outline-none">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={isProfitable ? 'hsl(4 90% 58%)' : 'hsl(142 71% 45%)'} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={isProfitable ? 'hsl(4 90% 58%)' : 'hsl(142 71% 45%)'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 12% 20%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickFormatter={(v) => formatWithCurrency(Number(v))} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      borderColor: 'hsl(var(--border))',
                      borderRadius: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}
                    cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                    labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    itemStyle={{ color: 'hsl(var(--foreground))', fontSize: 12 }}
                    formatter={(value: any, name: any, props: any) => {
                      const pnlValue = Number(value) || 0
                      const sign = pnlValue >= 0 ? '+' : ''
                      const color = pnlValue >= 0 ? 'var(--profit)' : 'var(--loss)'
                      return [
                        <span style={{ color, fontWeight: 'bold' }}>
                          {sign}{formatWithCurrency(Math.abs(pnlValue))}
                        </span>,
                        '累计盈亏'
                      ]
                    }}
                    labelFormatter={(label: any) => {
                      return `日期: ${label}`
                    }}
                  />
                  <ReferenceLine y={0} stroke="hsl(215 12% 52%)" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="pnl"
                    stroke={isProfitable ? 'hsl(4 90% 58%)' : 'hsl(142 71% 45%)'}
                    fill="url(#pnlGradient)" strokeWidth={2}
                    dot={(props) => {
                      const { payload } = props
                      const color = payload.type === 'DIVIDEND' ? 'hsl(217 91% 60%)'
                        : payload.type === 'BUY' ? 'hsl(215 12% 52%)' : 'hsl(4 90% 58%)'
                      return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill={color} stroke="none" />
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        <StockKline symbol={stock.code} market={stock.market} trades={stock.trades} />

        {stock.note && (
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-2">股票备注</div>
              <div className="text-sm text-foreground whitespace-pre-wrap">{stock.note}</div>
            </CardContent>
          </Card>
        )}

        {/* 交易记录列表 */}
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">交易记录</h3>
          {sortedTrades.length === 0 ? (
            <Card className="border-border border-dashed">
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground text-sm">暂无交易记录</p>
                <Button size="sm" className="mt-3" onClick={() => setShowAddTrade(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  添加第一笔
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {sortedTrades.map((trade) => (
                <TradeRow
                  key={trade.id}
                  trade={trade}
                  pnlDetail={pnlMap.get(trade.id)}
                  isClosingTrade={closingTradeIds.has(trade.id)}
                  market={stock.market}
                  displayCurrency={displayCurrency}
                  convertAmountSync={convertAmountSync}
                  formatWithCurrency={formatWithCurrency}
                  onEdit={() => setEditTrade(trade)}
                  onDelete={() => setDeleteTradeTarget(trade)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {(showAddTrade || editTrade) && (
        <AddTradeModal
          stockId={stock.id}
          stockCode={stock.code}
          stockName={stock.name}
          market={stock.market}
          editTrade={editTrade}
          onClose={() => {
            setShowAddTrade(false)
            setEditTrade(undefined)
          }}
        />
      )}

      {showEditStock && (
        <AddStockModal
          editStock={{
            id: stock.id,
            code: stock.code,
            name: stock.name,
            market: stock.market,
            note: stock.note,
          }}
          onClose={() => setShowEditStock(false)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTradeTarget}
        title="确认删除交易"
        description={
          deleteTradeTarget
            ? `确定删除 ${deleteTradeTarget.date} 的${deleteTradeTarget.type === 'BUY' ? '买入' : deleteTradeTarget.type === 'SELL' ? '卖出' : '分红'}记录？删除后会重算后续持仓成本和 FIFO 盈亏，该操作不可恢复。`
            : undefined
        }
        confirmText="删除"
        onOpenChange={(open) => {
          if (!open) setDeleteTradeTarget(null)
        }}
        onConfirm={async () => {
          if (!deleteTradeTarget) return
          await deleteTrade(stock.id, deleteTradeTarget.id)
          setDeleteTradeTarget(null)
        }}
      />
    </div>
  )
}

function isEtfLikeCode(code: string, market: Stock['market']) {
  if (market !== 'A') return false
  return ['5', '15', '16', '18'].some((prefix) => code.startsWith(prefix))
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-mono font-semibold text-foreground">{value}</div>
    </div>
  )
}

function formatOptionalRatio(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '--'
  return value.toFixed(2)
}

function formatOptionalMoney(value?: number | null, currency = 'CNY'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  const symbols: Record<string, string> = {
    CNY: '¥',
    HKD: 'HK$',
    USD: '$',
    USDT: '$',
  }
  return `${symbols[currency] ?? ''}${value.toFixed(2)}`
}

function formatOptionalMarketCap(value?: number | null, currency = 'CNY'): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '--'
  const symbols: Record<string, string> = {
    CNY: '¥',
    HKD: 'HK$',
    USD: '$',
    USDT: '$',
  }
  const abs = Math.abs(value)
  const units = [
    { threshold: 1e12, suffix: 'T' },
    { threshold: 1e9, suffix: 'B' },
    { threshold: 1e6, suffix: 'M' },
    { threshold: 1e4, suffix: '万' },
  ]
  const unit = units.find((item) => abs >= item.threshold)
  if (!unit) return `${symbols[currency] ?? ''}${value.toFixed(0)}`
  return `${symbols[currency] ?? ''}${(value / unit.threshold).toFixed(2)}${unit.suffix}`
}

function TradeRow({
  trade, pnlDetail, isClosingTrade, market, displayCurrency, convertAmountSync, formatWithCurrency, onEdit, onDelete,
}: {
  trade: Trade
  pnlDetail?: TradePnlDetail
  isClosingTrade: boolean
  market: Stock['market']
  displayCurrency: string
  convertAmountSync: (amount: number, fromMarket: string) => number
  formatWithCurrency: (amount: number) => string
  onEdit: () => void
  onDelete: () => void
}) {
  const isBuy = trade.type === 'BUY'
  const isSell = trade.type === 'SELL'
  const isDividend = trade.type === 'DIVIDEND'

  // 每笔卖出的盈亏
  const hasPnl = isSell && pnlDetail && pnlDetail.pnl !== 0
  const convertMoney = (amount: number) => convertAmountSync(amount, market)

  return (
    <div className="rounded-xl border border-border bg-card p-4 hover:border-border/80 transition-all group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
              isBuy ? 'bg-profit/15' : isDividend ? 'bg-primary/15' : 'bg-loss/15'
            }`}>
              {isBuy ? <TrendingUp className="h-3.5 w-3.5 text-profit" />
                : isDividend ? <Gift className="h-3.5 w-3.5 text-primary" />
                : <TrendingDown className="h-3.5 w-3.5 text-loss" />}
            </div>
            <span className={`text-xs font-semibold ${isBuy ? 'profit-text' : isDividend ? 'text-primary' : 'loss-text'}`}>
              {isBuy ? '买入' : isDividend ? '分红' : '卖出'}
            </span>
            <span className="text-xs text-muted-foreground">{trade.date}</span>
            {isSell && isClosingTrade && (
              <span className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold tracking-[0.08em] text-primary-foreground shadow-sm">
                清仓
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
              <div className="text-[11px] text-muted-foreground">{isDividend ? '分红基数' : '数量'}</div>
              <div className="text-xs font-mono text-foreground">{trade.quantity.toLocaleString()} 股</div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
              <div className="text-[11px] text-muted-foreground">{isDividend ? '每股分红' : '成交价'}</div>
              <div className="text-xs font-mono text-foreground">{formatWithCurrency(convertMoney(trade.price))}</div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
              <div className="text-[11px] text-muted-foreground">{isDividend ? '税费/手续费' : '费用'}</div>
              <div className="text-xs font-mono text-foreground">{formatWithCurrency(convertMoney(trade.commission + trade.tax))}</div>
            </div>
            <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
              <div className="text-[11px] text-muted-foreground">{isBuy ? '成交额' : isDividend ? '税后实收' : '到账额'}</div>
              <div className={`text-xs font-mono ${isBuy ? 'profit-text' : isDividend ? 'text-primary' : 'loss-text'}`}>
                {isBuy ? '-' : '+'}{formatWithCurrency(convertMoney(Math.abs(trade.netAmount)))}
              </div>
            </div>
          </div>
          {trade.note && (
            <div className="mt-2 text-xs text-muted-foreground">备注：{trade.note}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          {hasPnl && pnlDetail && (
            <div className={`text-sm font-mono ${pnlDetail.pnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPnl(convertMoney(pnlDetail.pnl), displayCurrency)}
              <span className="ml-1 text-xs opacity-75">({formatPercent(pnlDetail.pnlPercent)})</span>
            </div>
          )}
          {isBuy && (
            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
              <div>摊薄成本 {formatWithCurrency(convertMoney(trade.netAmount / trade.quantity))}</div>
              <div>当时总持仓 {(pnlDetail?.holdingAfterTrade ?? 0).toLocaleString()} 股</div>
              <div>该笔剩余 {(pnlDetail?.remainingQuantity ?? 0).toLocaleString()} 股</div>
            </div>
          )}
          {isDividend && (
            <div className="mt-1 text-xs text-muted-foreground">
              税前分红 {formatWithCurrency(convertMoney(trade.totalAmount))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1">
        <button
          onClick={onEdit}
          className="opacity-70 md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all"
        >
          <Edit className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="opacity-70 md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
