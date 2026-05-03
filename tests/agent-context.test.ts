import test from 'node:test'
import assert from 'node:assert/strict'
import { composeAgentContext } from '@/lib/agent/context'
import type { AgentPlan, AgentSkillResult } from '@/lib/agent/types'
import type { AiConfig } from '@/types'

const mockAiConfig: AiConfig = {
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:8080/v1',
  model: 'test-model',
  apiKey: 'test-key',
  temperature: 0,
  maxContextTokens: 4096,
  newsEnabled: false,
  analysisLanguage: 'zh-CN',
}

test('agent context compresses oversized skill results before sending them to the model', () => {
  const plan: AgentPlan = {
    intent: 'market_question',
    entities: [],
    requiredSkills: [{ name: 'web.fetch', args: { url: 'https://finance.yahoo.com' }, reason: '抓取页面' }],
    responseMode: 'answer',
  }
  const hugeBody = `${'正文'.repeat(6000)}TAIL_MARKER`
  const skillResults: AgentSkillResult[] = [{
    skillName: 'web.fetch',
    ok: true,
    data: {
      url: 'https://finance.yahoo.com',
      status: 200,
      body: hugeBody,
    },
  }]

  const result = composeAgentContext({
    aiConfig: mockAiConfig,
    history: [],
    userMessage: '总结一下这个页面',
    plan,
    skillResults,
  })
  const context = result.messages[1]?.content ?? ''

  assert.match(context, /内容已截断/)
  assert.doesNotMatch(context, /TAIL_MARKER/)
  assert.ok(context.length < hugeBody.length)
})
