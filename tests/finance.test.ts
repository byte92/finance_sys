import test from 'node:test'
import assert from 'node:assert/strict'
import { autoCalcFees, calcBuyNetAmount, calcSellNetAmount, calcStockSummary } from '@/lib/finance'
import { DEFAULT_FEE_CONFIGS } from '@/config/defaults'
import type { FeeConfig, Stock } from '@/types'

function createStock(trades: Stock['trades']): Stock {
  return {
    id: 'stock-1',
    code: '000001',
    name: '平安银行',
    market: 'A',
    trades,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('港股买入自动手续费包含印花税和结算费', () => {
  const fees = autoCalcFees('BUY', 100, 100, 'HK', '00700')

  assert.equal(fees.commission, 50)
  assert.equal(fees.tax, 13.2)
  assert.equal(fees.netAmount, 10063.2)
})

test('A股普通股票买入自动手续费包含佣金和双向过户费', () => {
  const fees = calcBuyNetAmount(10, 1000, DEFAULT_FEE_CONFIGS.A, 'A', '600519')

  assert.equal(fees.commission, 5)
  assert.equal(fees.tax, 0.1)
  assert.equal(Number(fees.netAmount.toFixed(2)), 10005.1)
})

test('A股普通股票卖出自动手续费包含印花税和过户费', () => {
  const fees = calcSellNetAmount(10, 1000, DEFAULT_FEE_CONFIGS.A, '600519')

  assert.equal(fees.commission, 5)
  assert.equal(fees.tax, 5.1)
  assert.equal(Number(fees.netAmount.toFixed(2)), 9989.9)
})

test('A股 ETF 自动手续费只收佣金，不收印花税和过户费', () => {
  const fees = autoCalcFees('SELL', 5, 10000, 'A', '510300')

  assert.equal(fees.commission, 5)
  assert.equal(fees.tax, 0)
  assert.equal(fees.netAmount, 49995)
})

test('自动手续费会读取用户配置的佣金率，而不是写死默认值', () => {
  const customAConfig: FeeConfig = {
    ...DEFAULT_FEE_CONFIGS.A,
    commissionRate: 0.0002,
    minCommission: 0,
  }
  const fees = autoCalcFees('BUY', 10, 1000, 'A', '600519', customAConfig)

  assert.equal(fees.commission, 2)
  assert.equal(fees.tax, 0.1)
  assert.equal(fees.netAmount, 10002.1)
})

test('FIFO 计算已实现盈亏和剩余持仓成本', () => {
  const stock = createStock([
    {
      id: 't1',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2026-01-01',
      price: 10,
      quantity: 100,
      commission: 5,
      tax: 0,
      totalAmount: 1000,
      netAmount: 1005,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't2',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2026-01-02',
      price: 12,
      quantity: 100,
      commission: 5,
      tax: 0,
      totalAmount: 1200,
      netAmount: 1205,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 't3',
      stockId: 'stock-1',
      type: 'SELL',
      date: '2026-01-03',
      price: 15,
      quantity: 150,
      commission: 5,
      tax: 2.25,
      totalAmount: 2250,
      netAmount: 2242.75,
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    },
  ])

  const summary = calcStockSummary(stock)

  assert.equal(summary.currentHolding, 50)
  assert.equal(Number(summary.avgCostPrice.toFixed(2)), 12.05)
  assert.equal(Number(summary.realizedPnl.toFixed(2)), 635.25)
  assert.equal(Number(summary.totalCommission.toFixed(2)), 17.25)
  assert.equal(summary.tradePnlDetails[0]?.remainingQuantity, 0)
  assert.equal(summary.tradePnlDetails[0]?.holdingAfterTrade, 100)
  assert.equal(summary.tradePnlDetails[1]?.remainingQuantity, 50)
  assert.equal(summary.tradePnlDetails[1]?.holdingAfterTrade, 200)
  assert.equal(summary.tradePnlDetails[2]?.holdingAfterTrade, 50)
})

test('分红会计入已实现盈亏，但不会重复摊薄剩余持仓成本', () => {
  const stock = createStock([
    {
      id: 't1',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2026-01-01',
      price: 10,
      quantity: 100,
      commission: 5,
      tax: 0,
      totalAmount: 1000,
      netAmount: 1005,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't2',
      stockId: 'stock-1',
      type: 'DIVIDEND',
      date: '2026-01-10',
      price: 1,
      quantity: 100,
      commission: 0,
      tax: 20,
      totalAmount: 100,
      netAmount: 80,
      createdAt: '2026-01-10T00:00:00.000Z',
      updatedAt: '2026-01-10T00:00:00.000Z',
    },
  ])

  const summary = calcStockSummary(stock)

  assert.equal(summary.totalDividend, 80)
  assert.equal(summary.realizedPnl, 80)
  assert.equal(summary.currentHolding, 100)
  assert.equal(Number(summary.avgCostPrice.toFixed(2)), 10.05)
})
