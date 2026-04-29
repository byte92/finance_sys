import { calcStockSummary } from '@/lib/finance'
import type { Stock } from '@/types'

export type AiChatSuggestionContext = {
  stocks: Stock[]
  pathname?: string
  activeSessionId?: string | null
  messageCount?: number
}

export type AiChatSuggestionRule = {
  id: string
  build: (context: AiChatSuggestionContext) => string | null
}

const MAX_SUGGESTIONS = 4

function getCurrentStock(context: AiChatSuggestionContext) {
  const match = context.pathname?.match(/^\/stock\/([^/?#]+)/)
  const stockId = match?.[1] ? decodeURIComponent(match[1]) : ''
  if (!stockId) return null
  return context.stocks.find((stock) => stock.id === stockId) ?? null
}

function getRecentlyActiveStock(stocks: Stock[]) {
  return stocks
    .map((stock) => ({
      stock,
      latestTradeDate: [...stock.trades].sort((left, right) => right.date.localeCompare(left.date))[0]?.date ?? '',
      tradeCount: stock.trades.length,
    }))
    .filter((item) => item.tradeCount > 0)
    .sort((left, right) => right.latestTradeDate.localeCompare(left.latestTradeDate) || right.tradeCount - left.tradeCount)[0]?.stock ?? null
}

function getLargestHolding(stocks: Stock[]) {
  return stocks
    .map((stock) => {
      const summary = calcStockSummary(stock)
      return {
        stock,
        holdingValue: summary.avgCostPrice * summary.currentHolding,
        currentHolding: summary.currentHolding,
      }
    })
    .filter((item) => item.currentHolding > 0)
    .sort((left, right) => right.holdingValue - left.holdingValue)[0]?.stock ?? null
}

export const DEFAULT_AI_CHAT_SUGGESTION_RULES: AiChatSuggestionRule[] = [
  {
    id: 'current-stock-health',
    build: (context) => {
      const stock = getCurrentStock(context)
      return stock ? `${stock.name} 现在的走势健康吗？我应该继续持有还是调整？` : null
    },
  },
  {
    id: 'current-stock-risk',
    build: (context) => {
      const stock = getCurrentStock(context)
      return stock ? `结合我的成本和交易记录，${stock.name} 当前最大的风险是什么？` : null
    },
  },
  {
    id: 'portfolio-risk',
    build: (context) => context.stocks.length > 0 ? '当前组合最大的风险是什么？优先处理哪一个问题？' : null,
  },
  {
    id: 'largest-holding',
    build: (context) => {
      const stock = getLargestHolding(context.stocks)
      return stock ? `我第一大持仓 ${stock.name} 现在需要重点关注什么？` : null
    },
  },
  {
    id: 'recent-trade-review',
    build: (context) => {
      const stock = getRecentlyActiveStock(context.stocks)
      return stock ? `帮我复盘最近交易过的 ${stock.name}，看看节奏有没有问题。` : null
    },
  },
  {
    id: 'portfolio-structure',
    build: (context) => context.stocks.length > 1 ? '按成本、盈亏和仓位权重帮我总结一下当前仓位结构。' : null,
  },
  {
    id: 'market-impact',
    build: (context) => context.pathname?.startsWith('/markets') ? '当前 A 股、港股、美股的市场节奏，对我的持仓有什么影响？' : null,
  },
  {
    id: 'empty-start',
    build: (context) => context.stocks.length === 0 ? '我还没有录入持仓，你能告诉我应该先记录哪些交易信息吗？' : null,
  },
]

export function buildAiChatSuggestions(
  context: AiChatSuggestionContext,
  rules: AiChatSuggestionRule[] = DEFAULT_AI_CHAT_SUGGESTION_RULES,
) {
  const suggestions: string[] = []
  const seen = new Set<string>()

  for (const rule of rules) {
    const suggestion = rule.build(context)?.trim()
    if (!suggestion || seen.has(suggestion)) continue
    suggestions.push(suggestion)
    seen.add(suggestion)
    if (suggestions.length >= MAX_SUGGESTIONS) break
  }

  return suggestions
}
