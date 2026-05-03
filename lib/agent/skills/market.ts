import type { AgentSkill } from '@/lib/agent/types'
import { resolveSecurityCandidates } from '@/lib/agent/entity/securityResolver'
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

export const marketResolveCandidateSkill: AgentSkill<ResolveCandidateInput, ResolveCandidateResult> = {
  name: 'market.resolveCandidate',
  description: '兼容旧接口：转发到 security.resolve，返回候选标的列表。',
  inputSchema: { query: 'string' },
  requiredScopes: ['stock.read', 'quote.read'],
  async execute(args, ctx) {
    const query = String(args.query ?? '').trim()
    if (!query) {
      return { skillName: 'market.resolveCandidate', ok: false, error: 'query 不能为空' }
    }
    const candidates = await resolveSecurityCandidates(query, ctx.stocks, 5)
    return {
      skillName: 'market.resolveCandidate',
      ok: true,
      data: {
        candidates,
        source: candidates.some((candidate) => candidate.inPortfolio) ? 'portfolio' : 'inference',
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
