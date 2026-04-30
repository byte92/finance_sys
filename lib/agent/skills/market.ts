import type { AgentSkill } from '@/lib/agent/types'
import { matchStocks, detectStockCode } from '@/lib/agent/entity/stockMatcher'
import { buildMarketAnalysisContextFromSources, type MarketAnalysisContext } from '@/lib/marketOverview'
import type { Market, MarketIndexSnapshot, NewsItem } from '@/types'

export type MarketAnalysisSkillContext = {
  context: MarketAnalysisContext
  indices: MarketIndexSnapshot[]
  news: NewsItem[]
}

export type ResolveCandidateInput = { query: string }

export type ResolveCandidate = {
  code: string
  name: string
  market: Market
  confidence: number
  inPortfolio: boolean
}

export type ResolveCandidateResult = {
  candidates: ResolveCandidate[]
  source: 'portfolio' | 'inference'
}

const MARKET_OPTIONS: Market[] = ['A', 'HK', 'US']

function inferCandidates(query: string): ResolveCandidate[] {
  const code = detectStockCode(query)
  if (!code) return []
  const upper = code.toUpperCase()
  // 纯数字 → 优先 A 股
  if (/^\d{5,6}$/.test(upper)) {
    return MARKET_OPTIONS.map((m) => ({ code: upper, name: upper, market: m, confidence: m === 'A' ? 0.65 : 0.35, inPortfolio: false }))
  }
  // 字母 → 优先美股
  return MARKET_OPTIONS.map((m) => ({ code: upper, name: upper, market: m, confidence: m === 'US' ? 0.65 : 0.35, inPortfolio: false }))
}

export const marketResolveCandidateSkill: AgentSkill<ResolveCandidateInput, ResolveCandidateResult> = {
  name: 'market.resolveCandidate',
  description: '根据用户输入的名称或代码，返回候选标的列表（含市场推断），优先匹配本地持仓。',
  inputSchema: { query: 'string' },
  requiredScopes: ['quote.read'],
  async execute(args, ctx) {
    const query = String(args.query ?? '').trim()
    if (!query) {
      return { skillName: 'market.resolveCandidate', ok: false, error: 'query 不能为空' }
    }
    // 先查本地持仓
    const local = matchStocks(query, ctx.stocks, 5)
    if (local.length > 0) {
      return {
        skillName: 'market.resolveCandidate',
        ok: true,
        data: {
          candidates: local.map((m) => ({
            code: m.stock.code,
            name: m.stock.name,
            market: m.stock.market,
            confidence: m.confidence,
            inPortfolio: true,
          })),
          source: 'portfolio' as const,
        },
      }
    }
    // 无本地匹配，按代码规则推断
    const inferred = inferCandidates(query)
    return {
      skillName: 'market.resolveCandidate',
      ok: true,
      data: {
        candidates: inferred,
        source: 'inference' as const,
      },
    }
  },
}

export const marketGetAnalysisContextSkill: AgentSkill<Record<string, unknown>, MarketAnalysisSkillContext> = {
  name: 'market.getAnalysisContext',
  description: '为固定大盘 AI 分析读取 A 股、港股、美股指数、技术指标和新闻上下文。',
  inputSchema: {},
  requiredScopes: ['market.read', 'quote.read'],
  async execute(_args, ctx) {
    return {
      skillName: 'market.getAnalysisContext',
      ok: true,
      data: await buildMarketAnalysisContextFromSources(ctx.aiConfig),
    }
  },
}
