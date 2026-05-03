import { resolveSecurityCandidates, type SecurityCandidate } from '@/lib/agent/entity/securityResolver'
import type { AgentSkill } from '@/lib/agent/types'

export type SecurityResolveInput = {
  query?: string
  limit?: number
}

export type SecurityResolveResult = {
  candidates: SecurityCandidate[]
  source: 'portfolio' | 'resolver'
}

export const securityResolveSkill: AgentSkill<SecurityResolveInput, SecurityResolveResult> = {
  name: 'security.resolve',
  description: '基础标的实体解析：将名称、代码、简称或自然语言提问解析为标准代码、市场和持仓状态。',
  inputSchema: { query: 'string', limit: 'number' },
  requiredScopes: ['stock.read', 'quote.read'],
  async execute(args, ctx) {
    const query = String(args.query ?? '').trim()
    if (!query) return { skillName: 'security.resolve', ok: false, error: 'query 不能为空' }

    const limit = Math.max(1, Math.min(Number(args.limit ?? 5), 10))
    const candidates = await resolveSecurityCandidates(query, ctx.stocks, limit)

    return {
      skillName: 'security.resolve',
      ok: true,
      data: {
        candidates,
        source: candidates.some((candidate) => candidate.inPortfolio) ? 'portfolio' : 'resolver',
      },
    }
  },
}
