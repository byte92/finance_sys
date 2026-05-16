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

test('agent context tells answer model not to expose internal skill identifiers', () => {
  const plan: AgentPlan = {
    intent: 'portfolio_summary',
    entities: [{ type: 'portfolio', raw: '当前持仓', confidence: 1 }],
    requiredSkills: [{ name: 'portfolio.getSummary', args: {}, reason: '读取组合摘要' }],
    responseMode: 'answer',
  }
  const skillResults: AgentSkillResult[] = [{
    skillName: 'portfolio.getSummary',
    ok: true,
    data: {
      stockCount: 2,
      activeHoldingCount: 2,
      totalPnl: 100,
      holdings: [
        { code: '601398', name: '工商银行', market: 'A', currentHolding: 1000 },
      ],
    },
  }]

  const result = composeAgentContext({
    aiConfig: mockAiConfig,
    history: [],
    userMessage: '我的持仓里还有银行吗',
    plan,
    skillResults,
  })

  const system = result.messages[0]?.content ?? ''
  const context = result.messages[1]?.content ?? ''

  assert.match(system, /严禁在面向用户的最终回复中原样提及/)
  assert.match(system, /根据你的当前持仓数据/)
  assert.match(context, /最终回复不得出现这些内部标识/)
})

test('agent context instructs trade review answers to address judgment questions first', () => {
  const plan: AgentPlan = {
    intent: 'trade_review',
    entities: [{ type: 'stock', raw: '福耀玻璃', stockId: 'stock-1', code: '600660', name: '福耀玻璃', market: 'A', confidence: 1 }],
    requiredSkills: [{ name: 'stock.getHolding', args: { stockId: 'stock-1' }, reason: '读取持仓' }],
    responseMode: 'answer',
  }
  const skillResults: AgentSkillResult[] = [{
    skillName: 'stock.getHolding',
    ok: true,
    data: {
      stock: { id: 'stock-1', code: '600660', name: '福耀玻璃', market: 'A' },
      summary: {
        currentHolding: 1800,
        avgCostPrice: 57.45,
        marketPrice: 56,
        unrealizedPnl: -2603.37,
        totalPnl: -2603.37,
        pnlIncludesMarketPrice: true,
      },
    },
  }]

  const result = composeAgentContext({
    aiConfig: mockAiConfig,
    history: [],
    userMessage: '福耀玻璃是不是我操作不对呀',
    plan,
    skillResults,
  })

  const system = result.messages[0]?.content ?? ''
  const answerDraft = JSON.stringify(result.answerDraft)

  assert.match(system, /开头必须先用一句话直接回应问题/)
  assert.match(system, /不要只罗列持仓、行情或技术指标/)
  assert.match(system, /不得把当前亏损或当前技术指标直接归因成当时操作错误/)
  assert.match(answerDraft, /先直接回应用户的判断诉求/)
})
