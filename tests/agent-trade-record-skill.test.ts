import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_APP_CONFIG } from '@/config/defaults'
import { getPortfolioByUserId, savePortfolioByUserId } from '@/lib/sqlite/db'
import { tradeCommitRecordSkill, tradePrepareRecordSkill } from '@/lib/agent/skills/tradeRecord'
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

process.env.FINANCE_SQLITE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stocktracker-trade-record-')), 'finance.sqlite')

function stock(): Stock {
  return {
    id: 'stock-1',
    code: '601838',
    name: '成都银行',
    market: 'A',
    trades: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  }
}

function createCtx(stocks: Stock[], userId: string): AgentExecutionContext {
  return {
    userId,
    sessionId: 'session-1',
    stocks,
    aiConfig,
    maxContextTokens: 128000,
  }
}

function mockTradeExtraction(
  extraction: Record<string, unknown>,
  extraFetch?: (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1], originalFetch: typeof fetch) => ReturnType<typeof fetch>,
) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(extraction) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return extraFetch ? extraFetch(input, init, originalFetch) : originalFetch(input, init)
  }
  return () => {
    globalThis.fetch = originalFetch
  }
}

test('trade.prepareRecord extracts a pending buy draft without writing data', async () => {
  const userId = 'local:test-prepare'
  const stocks = [stock()]
  savePortfolioByUserId(userId, { stocks, config: DEFAULT_APP_CONFIG })

  const restore = mockTradeExtraction({
    isTradeRecord: true,
    type: 'BUY',
    date: '2026-05-16',
    securityQuery: '成都银行',
    quantity: 1000,
    price: 10,
    assumptions: [],
    missing: [],
    confidence: 0.95,
  })
  try {
    const result = await tradePrepareRecordSkill.execute({
      text: '今日买入成都银行 1000 股，成本价是 10 块。',
    }, createCtx(stocks, userId))

    assert.equal(result.ok, true)
    const data = result.data as any
    assert.equal(data.status, 'pending_confirmation')
    assert.equal(data.draft.type, 'BUY')
    assert.equal(data.draft.code, '601838')
    assert.equal(data.draft.quantity, 1000)
    assert.equal(data.draft.price, 10)
    assert.equal(getPortfolioByUserId(userId).stocks[0]?.trades.length, 0)
  } finally {
    restore()
  }
})

test('trade.commitRecord writes a confirmed draft to sqlite portfolio payload', async () => {
  const userId = 'local:test-commit'
  const stocks = [stock()]
  savePortfolioByUserId(userId, { stocks, config: DEFAULT_APP_CONFIG })

  const restore = mockTradeExtraction({
    isTradeRecord: true,
    type: 'BUY',
    date: '2026-05-16',
    securityQuery: '成都银行',
    quantity: 1000,
    price: 10,
    assumptions: [],
    missing: [],
    confidence: 0.95,
  })
  try {
    const prepared = await tradePrepareRecordSkill.execute({
      text: '今日买入成都银行 1000 股，成本价是 10 块。',
    }, createCtx(stocks, userId))
    const draft = (prepared.data as any).draft
    const committed = await tradeCommitRecordSkill.execute({ draft }, createCtx(stocks, userId))

    assert.equal(committed.ok, true)
    const saved = getPortfolioByUserId(userId)
    assert.equal(saved.stocks[0]?.trades.length, 1)
    assert.equal(saved.stocks[0]?.trades[0]?.type, 'BUY')
    assert.equal(saved.stocks[0]?.trades[0]?.quantity, 1000)
    assert.equal(saved.stocks[0]?.trades[0]?.price, 10)
  } finally {
    restore()
  }
})

test('trade.commitRecord creates stock when confirmed draft is not in portfolio', async () => {
  const userId = 'local:test-commit-new-stock'
  savePortfolioByUserId(userId, { stocks: [], config: DEFAULT_APP_CONFIG })

  const committed = await tradeCommitRecordSkill.execute({
    draft: {
      type: 'BUY',
      date: '2026-05-13',
      code: '600660',
      name: '福耀玻璃',
      market: 'A',
      price: 57.44,
      quantity: 1800,
      commission: 18.62,
      tax: 1.03,
      totalAmount: 103392,
      netAmount: 103411.65,
      sourceText: '今日买入福耀玻璃 1,800 股,A股,成交价格 57.44',
      assumptions: [],
    },
  }, createCtx([], userId))

  assert.equal(committed.ok, true)
  const saved = getPortfolioByUserId(userId)
  assert.equal(saved.stocks.length, 1)
  assert.equal(saved.stocks[0]?.code, '600660')
  assert.equal(saved.stocks[0]?.name, '福耀玻璃')
  assert.equal(saved.stocks[0]?.trades.length, 1)
  assert.equal(saved.stocks[0]?.trades[0]?.quantity, 1800)
})

test('trade.prepareRecord uses market hint to create an external A-share holding draft', async () => {
  const userId = 'local:test-prepare-new-stock'
  savePortfolioByUserId(userId, { stocks: [], config: DEFAULT_APP_CONFIG })

  const restore = mockTradeExtraction({
    isTradeRecord: true,
    type: 'BUY',
    date: '2026-05-16',
    securityQuery: '福耀玻璃',
    market: 'A',
    quantity: 1800,
    price: 57.44,
    assumptions: [],
    missing: [],
    confidence: 0.95,
  }, async (input, init, originalFetch) => {
    const url = String(input)
    if (url.includes('smartbox.gtimg.cn')) {
      return new Response('v_hint=\"sh~600660~福耀玻璃~FUYAOBOLI~GP-A^hk~3606~福耀玻璃~FUYAOBOLI~GP-HK\";', {
        status: 200,
        headers: { 'content-type': 'text/plain;charset=gbk' },
      })
    }
    return originalFetch(input, init)
  })

  try {
    const result = await tradePrepareRecordSkill.execute({
      text: '今日买入福耀玻璃 1,800 股,A股,成交价格 57.44',
    }, createCtx([], userId))

    assert.equal(result.ok, true)
    const data = result.data as any
    assert.equal(data.status, 'pending_confirmation')
    assert.equal(data.draft.code, '600660')
    assert.equal(data.draft.market, 'A')
    assert.equal(data.draft.willCreateStock, true)
    assert.match(data.draft.assumptions.join('；'), /先创建持仓/)
  } finally {
    restore()
  }
})

test('trade.prepareRecord handles price-before-security ETF sell text', async () => {
  const userId = 'local:test-price-before-security'
  const stocks: Stock[] = [{
    id: 'stock-etf-1',
    code: '510300',
    name: '沪深300ETF华泰柏瑞',
    market: 'A',
    trades: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  }]
  savePortfolioByUserId(userId, { stocks, config: DEFAULT_APP_CONFIG })

  const restore = mockTradeExtraction({
    isTradeRecord: true,
    type: 'SELL',
    date: '2026-05-16',
    securityQuery: '沪深300',
    quantity: 6200,
    price: 4.888,
    assumptions: [],
    missing: [],
    confidence: 0.94,
  })
  try {
    const result = await tradePrepareRecordSkill.execute({
      text: '4.888 沪深300 卖出6200股',
    }, createCtx(stocks, userId))

    assert.equal(result.ok, true)
    const data = result.data as any
    assert.equal(data.status, 'pending_confirmation')
    assert.equal(data.draft.type, 'SELL')
    assert.equal(data.draft.code, '510300')
    assert.equal(data.draft.price, 4.888)
    assert.equal(data.draft.quantity, 6200)
  } finally {
    restore()
  }
})

test('trade.prepareRecord lets the model reject non-recording text', async () => {
  const userId = 'local:test-non-record'
  const stocks = [stock()]
  savePortfolioByUserId(userId, { stocks, config: DEFAULT_APP_CONFIG })

  const restore = mockTradeExtraction({
    isTradeRecord: false,
    isCancellation: false,
    missing: ['交易录入意图'],
    confidence: 0.9,
  })
  try {
    const result = await tradePrepareRecordSkill.execute({
      text: '你觉得成都银行现在适合买入吗？',
    }, createCtx(stocks, userId))

    assert.equal(result.ok, true)
    const data = result.data as any
    assert.equal(data.status, 'needs_more_info')
    assert.deepEqual(data.missing, ['交易录入意图'])
  } finally {
    restore()
  }
})
