import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentAnswerDraft } from '@/lib/agent/answer/builder'
import type { AgentPlan, AgentSkillResult } from '@/lib/agent/types'

const tradeReviewPlan: AgentPlan = {
  intent: 'trade_review',
  entities: [{
    type: 'stock',
    raw: '成都银行最后一笔卖出合理吗',
    stockId: 'stock-1',
    code: '601838',
    name: '成都银行',
    market: 'A',
    confidence: 0.9,
  }],
  requiredSkills: [],
  responseMode: 'answer',
}

test('answer builder creates quality warnings for trade review context', () => {
  const skillResults: AgentSkillResult[] = [
    {
      skillName: 'stock.getHolding',
      ok: true,
      data: {
        stock: { id: 'stock-1', code: '601838', name: '成都银行', market: 'A' },
        summary: {
          currentHolding: 11600,
          avgCostPrice: 16.58,
          marketPrice: 18.97,
          marketValue: 220052,
          realizedPnl: 2492.7807,
          unrealizedPnl: 27724.12,
          totalPnl: 30216.9007,
          totalCommission: 108.14,
          totalDividend: 0,
          tradeCount: 7,
          pnlIncludesMarketPrice: true,
        },
      },
    },
    {
      skillName: 'stock.getRecentTrades',
      ok: true,
      data: {
        stockId: 'stock-1',
        trades: [
          { type: 'BUY', date: '2026-01-10', price: 16.1, quantity: 5500, commission: 5, tax: 0, netAmount: 88555 },
          { type: 'SELL', date: '2026-04-24', price: 18.33, quantity: 5500, commission: 10, tax: 0, netAmount: 100805 },
        ],
      },
    },
    {
      skillName: 'stock.getTechnicalSnapshot',
      ok: true,
      data: {
        stockId: 'stock-1',
        indicators: {
          trendBias: 'bullish',
          rsi14: 79.4,
          supportLevel: 18.2,
          resistanceLevel: 19.1,
        },
      },
    },
  ]

  const draft = buildAgentAnswerDraft(tradeReviewPlan, skillResults)

  assert.equal(draft.answerType, 'trade_review')
  assert.equal(draft.confidence, 'medium')
  assert.ok(draft.facts.some((item) => item.label === '最近交易' && String(item.value).includes('SELL')))
  assert.ok(draft.calculations.some((item) => item.label === '已实现收益' && item.source === 'stock.getHolding'))
  assert.ok(draft.qualityWarnings.some((item) => item.label === '单笔收益缺口'))
  assert.ok(draft.qualityWarnings.some((item) => item.label === '时间口径提醒'))
  assert.ok(draft.recommendations.some((item) => item.label === '回答方式'))
})

test('answer builder records failed skills as missing data', () => {
  const draft = buildAgentAnswerDraft(tradeReviewPlan, [
    { skillName: 'stock.getQuote', ok: false, error: '行情源不可用' },
  ])

  assert.equal(draft.confidence, 'medium')
  assert.deepEqual(draft.missingData.map((item) => item.label), ['stock.getQuote'])
})
