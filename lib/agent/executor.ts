import { getSkillByName } from '@/lib/agent/skills/registry'
import type { AgentExecutionContext, AgentPlan, AgentSkillResult } from '@/lib/agent/types'
import { estimateTokens } from '@/lib/ai/chat'

export async function executeAgentPlan(plan: AgentPlan, ctx: AgentExecutionContext): Promise<AgentSkillResult[]> {
  const results: AgentSkillResult[] = []

  for (const call of plan.requiredSkills) {
    const skill = getSkillByName(call.name)
    if (!skill) {
      results.push({ skillName: call.name, ok: false, error: `未注册的 Skill：${call.name}` })
      continue
    }

    try {
      const result = await skill.execute(call.args, ctx)
      results.push({
        ...result,
        tokenEstimate: result.tokenEstimate ?? estimateTokens(JSON.stringify(result.data ?? result.error ?? '')),
      })
    } catch (error) {
      results.push({
        skillName: call.name,
        ok: false,
        error: error instanceof Error ? error.message : 'Skill 执行失败',
      })
    }
  }

  return results
}
