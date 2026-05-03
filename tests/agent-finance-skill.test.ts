import test from 'node:test'
import assert from 'node:assert/strict'
import { financeCalculateSkill } from '@/lib/agent/skills/finance'
import type { AgentExecutionContext } from '@/lib/agent/types'
import type { AiConfig, Stock } from '@/types'

const aiConfig: AiConfig = {
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

function createContext(stocks: Stock[]): AgentExecutionContext {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    stocks,
    aiConfig,
    maxContextTokens: 128000,
  }
}

test('finance.calculate estimates dividend cash from current holding and latest local dividend', async () => {
  const stock: Stock = {
    id: 'stock-icbc',
    code: '601398',
    name: '工商银行',
    market: 'A',
    trades: [
      {
        id: 'buy-1',
        stockId: 'stock-icbc',
        type: 'BUY',
        date: '2025-01-01',
        price: 5,
        quantity: 1000,
        commission: 5,
        tax: 0,
        totalAmount: 5000,
        netAmount: 5005,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'dividend-1',
        stockId: 'stock-icbc',
        type: 'DIVIDEND',
        date: '2025-07-10',
        price: 0.3064,
        quantity: 1000,
        commission: 0,
        tax: 0,
        totalAmount: 306.4,
        netAmount: 306.4,
        createdAt: '2025-07-10T00:00:00.000Z',
        updatedAt: '2025-07-10T00:00:00.000Z',
      },
      {
        id: 'buy-2',
        stockId: 'stock-icbc',
        type: 'BUY',
        date: '2025-12-01',
        price: 6,
        quantity: 1000,
        commission: 5,
        tax: 0,
        totalAmount: 6000,
        netAmount: 6005,
        createdAt: '2025-12-01T00:00:00.000Z',
        updatedAt: '2025-12-01T00:00:00.000Z',
      },
    ],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
  }

  const result = await financeCalculateSkill.execute({ type: 'dividend.estimate', stockId: stock.id }, createContext([stock]))
  const data = result.data as { estimatedAmount: number; quantity: number; cashPerShare: number; formula: string }

  assert.equal(result.ok, true)
  assert.equal(data.quantity, 2000)
  assert.equal(data.cashPerShare, 0.3064)
  assert.equal(data.estimatedAmount, 612.8)
  assert.match(data.formula, /2000 × 0\.3064 = 612\.8/)
})

test('finance.calculate asks web search to fill missing dividend amount', async () => {
  const stock: Stock = {
    id: 'stock-icbc',
    code: '601398',
    name: '工商银行',
    market: 'A',
    trades: [
      {
        id: 'buy-1',
        stockId: 'stock-icbc',
        type: 'BUY',
        date: '2025-01-01',
        price: 5,
        quantity: 1000,
        commission: 5,
        tax: 0,
        totalAmount: 5000,
        netAmount: 5005,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }

  const result = await financeCalculateSkill.execute({ type: 'dividend.estimate', stockId: stock.id }, createContext([stock]))

  assert.equal(result.ok, false)
  assert.equal(result.needsFollowUp, true)
  assert.equal(result.suggestedSkills?.[0]?.name, 'web.search')
  assert.match(String(result.suggestedSkills?.[0]?.args.query), /工商银行 601398/)
})
