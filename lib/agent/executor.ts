import { getSkillByName } from '@/lib/agent/skills/registry'
import type { AgentExecutionContext, AgentPlan, AgentSkillCall, AgentSkillResult } from '@/lib/agent/types'
import { estimateTokens } from '@/lib/ai/chat'

const MAX_ROUNDS = 10

function callKey(call: AgentSkillCall) {
  return `${call.name}::${JSON.stringify(call.args)}`
}

function withToken(result: AgentSkillResult) {
  const estimate = result.tokenEstimate ?? estimateTokens(JSON.stringify(result.data ?? result.error ?? ''))
  return { ...result, tokenEstimate: estimate }
}

async function executeSingleCall(call: AgentSkillCall, ctx: AgentExecutionContext): Promise<AgentSkillResult> {
  const skill = getSkillByName(call.name)
  if (!skill) {
    return { skillName: call.name, ok: false, error: `未注册的 Skill：${call.name}` }
  }

  try {
    return await skill.execute(call.args, ctx)
  } catch (error) {
    return {
      skillName: call.name,
      ok: false,
      error: error instanceof Error ? error.message : 'Skill 执行失败',
    }
  }
}

export async function executeAgentPlan(plan: AgentPlan, ctx: AgentExecutionContext): Promise<AgentSkillResult[]> {
  const results: AgentSkillResult[] = []
  const seen = new Set<string>()
  // 待执行队列，初始为 Planner 规划的 requiredSkills
  const queue: AgentSkillCall[] = [...plan.requiredSkills]

  let round = 0
  while (queue.length > 0 && round < MAX_ROUNDS) {
    round++
    const batch = queue.splice(0)
    for (const call of batch) {
      const key = callKey(call)
      // 避免同一轮内重复调用相同的 Skill + 参数
      if (seen.has(key)) continue
      seen.add(key)

      const result = await executeSingleCall(call, ctx)
      results.push(withToken(result))

      // 链式执行：如果 Skill 请求后续调用，加入队列
      if (result.needsFollowUp && result.suggestedSkills?.length) {
        for (const followUp of result.suggestedSkills) {
          const fKey = callKey(followUp)
          if (!seen.has(fKey)) {
            queue.push(followUp)
          }
        }
      }
    }
  }

  return results
}
