import test from 'node:test'
import assert from 'node:assert/strict'
import { planAgentResponse } from '@/lib/agent/planner'
import type { AiConfig, Stock } from '@/types'

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

function stock(id: string, code: string, name: string): Stock {
  return {
    id,
    code,
    name,
    market: 'A',
    trades: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const stocks = [
  stock('stock-1', '601838', '成都银行'),
  stock('stock-2', '510300', '沪深300ETF'),
  stock('stock-3', '000001', '平安银行'),
]

test('agent planner uses stock skills for a single-stock question', async () => {
  const plan = await planAgentResponse({
    userMessage: '成都银行现在走势健康吗',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.entities[0]?.stockId, 'stock-1')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getHolding',
    'stock.getRecentTrades',
    'stock.getQuote',
    'stock.getTechnicalSnapshot',
  ])
})

test('agent planner uses portfolio skills for portfolio risk questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '我现在组合最大的风险是什么',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'portfolio_risk')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'portfolio.getSummary',
    'portfolio.getTopPositions',
  ])
})

test('agent planner refuses clearly out-of-scope questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '帮我看看今天成都天气怎么样',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'out_of_scope')
  assert.equal(plan.responseMode, 'refuse')
  assert.equal(plan.requiredSkills.length, 0)
})
