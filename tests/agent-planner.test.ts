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

test('agent planner fallback does not hard-code web search for stock announcement questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '成都银行最近有什么公告？',
    stocks,
    aiConfig: mockAiConfig,
  })

  const webSearch = plan.requiredSkills.find((item) => item.name === 'web.search')

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.entities[0]?.stockId, 'stock-1')
  assert.equal(webSearch, undefined)
})

test('agent planner keeps model extracted web search context', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'stock_analysis',
              entities: [{ type: 'stock', raw: '成都银行', code: '601838', name: '成都银行', market: 'A', confidence: 0.95 }],
              requiredSkills: [{
                name: 'web.search',
                args: {
                  query: '成都银行 601838 最新公告',
                  sourceHints: ['cninfo.com.cn', 'sse.com.cn'],
                  limit: 5,
                },
                reason: '用户询问公告，需要公开来源',
              }],
              responseMode: 'answer',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const plan = await planAgentResponse({
      userMessage: '成都银行最近有什么公告？',
      stocks,
      aiConfig: mockAiConfig,
    })
    const webSearch = plan.requiredSkills.find((item) => item.name === 'web.search')

    assert.equal(plan.intent, 'stock_analysis')
    assert.equal(plan.entities[0]?.stockId, 'stock-1')
    assert.equal(webSearch?.args.query, '成都银行 601838 最新公告')
    assert.deepEqual(webSearch?.args.sourceHints, ['cninfo.com.cn', 'sse.com.cn'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner fallback does not hard-code web search for stock news questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '成都银行今天发生了什么，有利空吗？',
    stocks,
    aiConfig: mockAiConfig,
  })

  const webSearch = plan.requiredSkills.find((item) => item.name === 'web.search')

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(webSearch, undefined)
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

test('agent planner keeps recent stock focus for follow-up metric questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '你看一下我平均收益是多少？',
    stocks,
    history: [{
      id: 'message-1',
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      content: '成都银行分析',
      contextSnapshot: {
        agent: {
          entities: [{
            type: 'stock',
            stockId: 'stock-1',
            code: '601838',
            name: '成都银行',
            market: 'A',
          }],
        },
      },
      tokenEstimate: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
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

test('agent planner adds web search for A-share market event and policy questions', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'market_question',
              entities: [{ type: 'market', raw: 'A股大盘', market: 'A', confidence: 0.9 }],
              requiredSkills: [
                { name: 'market.getAnalysisContext', args: { market: 'A' }, reason: '读取大盘上下文' },
                {
                  name: 'web.search',
                  args: {
                    query: 'A股大盘 今天 政策新闻 盘面大事件',
                    sourceHints: ['证监会', '央行', '证券时报'],
                    limit: 5,
                  },
                  reason: '用户询问今日公开事件，需要检索公开来源',
                },
              ],
              responseMode: 'answer',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const plan = await planAgentResponse({
      userMessage: 'A股大盘今天有什么政策新闻和盘面大事件？',
      stocks,
      aiConfig: mockAiConfig,
    })

    assert.equal(plan.intent, 'market_question')
    assert.equal(plan.responseMode, 'answer')
    assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
      'market.getAnalysisContext',
      'web.search',
    ])
    assert.equal(plan.requiredSkills[1]?.args.query, 'A股大盘 今天 政策新闻 盘面大事件')
    assert.deepEqual(plan.requiredSkills[1]?.args.sourceHints, ['证监会', '央行', '证券时报'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner fetches external ETF data for broad 科创50 ETF questions', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes(encodeURIComponent('科创50'))) {
      return new Response('v_hint="sh~588000~\\u79d1\\u521b50ETF\\u534e\\u590f~kc50etfhx~ETF^sh~588080~\\u79d1\\u521b50ETF\\u6613\\u65b9\\u8fbe~kc50etfyfd~ETF"')
    }
    return new Response('v_hint="N";')
  }

  let plan
  try {
    plan = await planAgentResponse({
      userMessage: 'a股的科创50 你觉得还有上涨空间吗 我想买etf',
      stocks,
      aiConfig: mockAiConfig,
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  const externalQuotes = plan.requiredSkills.filter((item) => item.name === 'stock.getExternalQuote')
  const technicalSnapshots = plan.requiredSkills.filter((item) => item.name === 'stock.getTechnicalSnapshot')

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(externalQuotes.map((item) => item.args.symbol), ['588000', '588080'])
  assert.deepEqual(technicalSnapshots.map((item) => item.args.symbol), ['588000', '588080'])
})

test('agent planner fetches external quote for explicit non-holding A-share ETF code', async () => {
  const plan = await planAgentResponse({
    userMessage: '588000 还有上涨空间吗',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getExternalQuote',
    'stock.getTechnicalSnapshot',
  ])
  assert.equal(plan.requiredSkills[0]?.args.symbol, '588000')
  assert.equal(plan.requiredSkills[0]?.args.market, 'A')
})

test('agent planner infers US market for explicit non-holding US ticker', async () => {
  const plan = await planAgentResponse({
    userMessage: 'PDD 最近怎么样',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getExternalQuote',
    'stock.getTechnicalSnapshot',
  ])
  assert.equal(plan.requiredSkills[0]?.args.symbol, 'PDD')
  assert.equal(plan.requiredSkills[0]?.args.market, 'US')
})

test('agent planner uses market intent before code-shape fallback', async () => {
  const plan = await planAgentResponse({
    userMessage: '美股 00700 看一下',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.requiredSkills[0]?.args.symbol, '00700')
  assert.equal(plan.requiredSkills[0]?.args.market, 'US')
})

test('agent planner resolves non-holding A-share names before LLM fallback', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes(encodeURIComponent('五粮液'))) {
      return new Response('v_hint="sz~000858~\\u4e94\\u7cae\\u6db2~wly~GP-A"')
    }
    return new Response('v_hint="N";')
  }

  let plan
  try {
    plan = await planAgentResponse({
      userMessage: '五粮液现在表现如何',
      stocks,
      aiConfig: mockAiConfig,
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(plan.entities.map((item) => item.code), ['000858'])
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getExternalQuote',
    'stock.getTechnicalSnapshot',
  ])
  assert.equal(plan.requiredSkills[0]?.args.symbol, '000858')
  assert.equal(plan.requiredSkills[0]?.args.market, 'A')
})

test('agent planner resolves smartbox candidates before LLM fallback', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes(encodeURIComponent('高德红外'))) {
      return new Response('v_hint="sz~002414~\\u9ad8\\u5fb7\\u7ea2\\u5916~gdhw~GP-A"')
    }
    return new Response('v_hint="N";')
  }

  try {
    const plan = await planAgentResponse({
      userMessage: '高德红外最近表现怎么样',
      stocks,
      aiConfig: mockAiConfig,
    })

    assert.equal(plan.intent, 'stock_analysis')
    assert.equal(plan.responseMode, 'answer')
    assert.deepEqual(plan.entities.map((item) => item.code), ['002414'])
    assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
      'stock.getExternalQuote',
      'stock.getTechnicalSnapshot',
    ])
    assert.equal(plan.requiredSkills[0]?.args.symbol, '002414')
    assert.equal(plan.requiredSkills[0]?.args.market, 'A')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner keeps recent external ETF candidates for follow-up references', async () => {
  const plan = await planAgentResponse({
    userMessage: '这两只都分析一下',
    stocks,
    history: [{
      id: 'message-1',
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      content: 'A股里可以看 588000.SH（华夏科创50ETF）和 588080.SH（易方达科创50ETF），这两个 ETF 代码都可以继续拉数据。',
      tokenEstimate: 20,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    aiConfig: mockAiConfig,
  })

  const externalQuotes = plan.requiredSkills.filter((item) => item.name === 'stock.getExternalQuote')

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(externalQuotes.map((item) => item.args.symbol), ['588000', '588080'])
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
