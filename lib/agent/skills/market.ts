import type { AgentSkill } from '@/lib/agent/types'
import { buildMarketAnalysisContextFromSources, type MarketAnalysisContext } from '@/lib/marketOverview'
import type { MarketIndexSnapshot, NewsItem } from '@/types'

export type MarketAnalysisSkillContext = {
  context: MarketAnalysisContext
  indices: MarketIndexSnapshot[]
  news: NewsItem[]
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
