import test from 'node:test'
import assert from 'node:assert/strict'
import { executeAgentPlan } from '@/lib/agent/executor'
import type { AgentExecutionContext, AgentPlan } from '@/lib/agent/types'
import type { AiConfig } from '@/types'

const mockAiConfig: AiConfig = {
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:8080/v1',
  model: 'test-model',
  apiKey: 'test-key',
  temperature: 0,
  maxContextTokens: 128000,
  newsEnabled: false,
  analysisLanguage: 'zh-CN',
}

const basePlan: AgentPlan = {
  intent: 'market_question',
  entities: [],
  requiredSkills: [],
  responseMode: 'answer',
}

const baseContext: AgentExecutionContext = {
  userId: 'user-1',
  sessionId: 'session-1',
  stocks: [],
  aiConfig: mockAiConfig,
  maxContextTokens: 128000,
}

test('executor rejects skill calls outside allowed scopes', async () => {
  const results = await executeAgentPlan({
    ...basePlan,
    requiredSkills: [{
      name: 'web.fetch',
      args: { url: 'https://finance.yahoo.com' },
      reason: '需要外部页面',
    }],
  }, {
    ...baseContext,
    allowedScopes: ['stock.read'],
  })

  assert.equal(results.length, 1)
  assert.equal(results[0]?.ok, false)
  assert.match(results[0]?.error ?? '', /权限不足/)
  assert.match(results[0]?.error ?? '', /network\.fetch/)
})
