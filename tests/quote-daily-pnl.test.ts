import assert from 'node:assert/strict'
import test from 'node:test'
import { getDailyQuotePnl, getMarketDate, isMarketTradingDay } from '@/lib/quoteDailyPnl'
import type { StockQuote } from '@/types/stockApi'

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    symbol: '601838',
    name: '成都银行',
    price: 10,
    change: 0.5,
    changePercent: 5.26,
    timestamp: '2026-05-04T10:30:00+08:00',
    currency: 'CNY',
    source: 'test',
    ...overrides,
  }
}

test('getDailyQuotePnl ignores weekend quotes for A shares', () => {
  const sundayBeijing = new Date('2026-05-03T10:00:00+08:00')
  const result = getDailyQuotePnl(100, quote({ timestamp: '2026-05-02T15:00:00+08:00' }), 'A', sundayBeijing)

  assert.equal(result.state, 'market-closed')
  assert.equal(result.amount, 0)
  assert.equal(result.rate, 0)
})

test('getDailyQuotePnl ignores stale previous trading day quotes', () => {
  const mondayBeijing = new Date('2026-05-04T10:00:00+08:00')
  const result = getDailyQuotePnl(100, quote({ timestamp: '2026-04-30T15:00:00+08:00' }), 'A', mondayBeijing)

  assert.equal(result.state, 'stale-quote')
  assert.equal(result.amount, 0)
  assert.equal(result.rate, 0)
})

test('getDailyQuotePnl uses same-day market quotes', () => {
  const mondayBeijing = new Date('2026-05-04T10:00:00+08:00')
  const result = getDailyQuotePnl(100, quote({ timestamp: '2026-05-04T09:45:00+08:00' }), 'A', mondayBeijing)

  assert.equal(result.state, 'active')
  assert.equal(result.amount, 50)
  assert.equal(result.previousValue, 950)
  assert.equal(Number(result.rate?.toFixed(2)), 5.26)
})

test('US market is closed on Sunday Beijing time', () => {
  const sundayBeijing = new Date('2026-05-03T10:00:00+08:00')

  assert.equal(isMarketTradingDay('US', sundayBeijing), false)
  assert.equal(getMarketDate(sundayBeijing, 'US'), '2026-05-02')
})

test('date-only quote timestamps keep the market trading date', () => {
  const mondayNewYork = new Date('2026-05-04T10:00:00-04:00')
  const result = getDailyQuotePnl(
    100,
    quote({
      symbol: 'AAPL',
      timestamp: '2026-05-01',
      currency: 'USD',
    }),
    'US',
    mondayNewYork,
  )

  assert.equal(result.state, 'stale-quote')
  assert.equal(result.amount, 0)
})
