import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAiChatSuggestions } from '@/lib/ai/chatSuggestions'
import type { Stock } from '@/types'

function createStock(overrides: Partial<Stock> = {}): Stock {
  return {
    id: overrides.id ?? 'stock-1',
    code: overrides.code ?? '601838',
    name: overrides.name ?? '成都银行',
    market: overrides.market ?? 'A',
    trades: overrides.trades ?? [
      {
        id: 'trade-1',
        stockId: overrides.id ?? 'stock-1',
        type: 'BUY',
        date: '2026-04-01',
        price: 18,
        quantity: 1000,
        commission: 5,
        tax: 0,
        totalAmount: 18000,
        netAmount: 18005,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
      },
    ],
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  }
}

test('ai chat suggestions prioritize current stock page context', () => {
  const suggestions = buildAiChatSuggestions({
    stocks: [createStock()],
    pathname: '/stock/stock-1',
  })

  assert.equal(suggestions[0], '成都银行 现在的走势健康吗？我应该继续持有还是调整？')
  assert.ok(suggestions.some((item) => item.includes('成都银行 当前最大的风险')))
})

test('ai chat suggestions fallback to portfolio context', () => {
  const suggestions = buildAiChatSuggestions({
    stocks: [createStock(), createStock({ id: 'stock-2', code: '00700', name: '腾讯控股', market: 'HK' })],
    pathname: '/portfolio',
  })

  assert.ok(suggestions.includes('当前组合最大的风险是什么？优先处理哪一个问题？'))
  assert.ok(suggestions.some((item) => item.includes('第一大持仓')))
})

test('ai chat suggestions handle empty portfolio', () => {
  const suggestions = buildAiChatSuggestions({
    stocks: [],
    pathname: '/portfolio',
  })

  assert.deepEqual(suggestions, ['我还没有录入持仓，你能告诉我应该先记录哪些交易信息吗？'])
})
