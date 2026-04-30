import test from 'node:test'
import assert from 'node:assert/strict'
import {
  add, sub, mul, div,
  roundMoney, roundTo,
  gt, gte, lt, lte, eq,
  calcAmount, calcPerShareCost, calcChangePercent, calcPnl, calcPnlPercent, calcCommission,
} from '@/lib/money'

// ---- 基本运算 ----

test('add 精确加法，消除 JS 浮点误差', () => {
  assert.equal(add(0.1, 0.2), 0.3)
  assert.equal(add(1.005, 0.005), 1.01)
  assert.equal(add(100, 0.01), 100.01)
})

test('sub 精确减法', () => {
  assert.equal(sub(0.3, 0.1), 0.2)
  assert.equal(sub(1, 0.99), 0.01)
  assert.equal(sub(100, 0.01), 99.99)
})

test('mul 精确乘法', () => {
  assert.equal(mul(1.005, 100), 100.5)
  assert.equal(mul(0.0003, 10000), 3)
  assert.equal(mul(10.5, 3), 31.5)
})

test('div 精确除法', () => {
  assert.equal(div(36.5, 3), 12.166667) // 6dp 内部精度
  assert.equal(div(1, 3), 0.333333)
  assert.equal(div(100, 4), 25)
})

// ---- 舍入 ----

test('roundMoney 舍入到 2 位小数', () => {
  assert.equal(roundMoney(1.005), 1.01)
  assert.equal(roundMoney(1.004), 1.0)
  assert.equal(roundMoney(0.015), 0.02)
  assert.equal(roundMoney(0.014), 0.01)
})

test('roundMoney 处理精度临界值', () => {
  // 这些是 JS 原生 Math.round 会算错的值
  assert.equal(roundMoney(1.005), 1.01)  // 1.005 * 100 = 100.5 → big.js roundHalfUp → 1.01 ✓
  assert.equal(roundMoney(2.675), 2.68)
  assert.equal(roundMoney(1.335), 1.34)
})

test('roundTo 自定义精度', () => {
  assert.equal(roundTo(12.166667, 4), 12.1667)
  assert.equal(roundTo(12.1666, 4), 12.1666)
  assert.equal(roundTo(12.1666, 0), 12)
})

// ---- 比较 ----

test('比较函数处理边界', () => {
  assert.equal(gt(0.1 + 0.2, 0.3), true)   // JS 原生 0.1+0.2 = 0.300...04 > 0.3
  assert.equal(gte(add(0.1, 0.2), 0.3), true)
  assert.equal(lt(add(0.1, 0.2), 0.3), false)
  assert.equal(eq(add(0.1, 0.2), 0.3), true)
  assert.equal(eq(0, 0), true)
  assert.equal(eq(0, 0.001), false)
})

// ---- 常用组合 ----

test('calcAmount 价格 × 数量', () => {
  assert.equal(calcAmount(10.5, 3), 31.5)
  assert.equal(calcAmount(0.01, 10000), 100)
  assert.equal(calcAmount(12.345, 200), 2469)
})

test('calcPerShareCost 每股摊薄成本', () => {
  assert.equal(calcPerShareCost(36.5, 3), 12.166667)
  assert.equal(calcPerShareCost(1005, 100), 10.05)
  assert.equal(calcPerShareCost(0, 100), 0)
})

test('calcChangePercent 涨跌幅', () => {
  assert.equal(calcChangePercent(15, 10), 50)
  assert.equal(calcChangePercent(5, 10), -50)
  assert.equal(calcChangePercent(10, 0), 0)    // 除零保护
  assert.equal(calcChangePercent(10.5, 10), 5)
})

test('calcPnl 盈亏', () => {
  assert.equal(calcPnl(2242.75, 1507.5), 735.25)
  assert.equal(calcPnl(100, 200), -100)
  assert.equal(calcPnl(100, 100), 0)
})

test('calcPnlPercent 盈亏率', () => {
  // 735.25 / 1507.5 = 0.487728... → div 保留 6dp → 0.487728 → ×100 = 48.7728
  assert.equal(calcPnlPercent(735.25, 1507.5), 48.7728)
  assert.equal(calcPnlPercent(0, 100), 0)
  assert.equal(calcPnlPercent(100, 0), 0)    // 除零保护
})

test('calcCommission 佣金取最大值', () => {
  assert.equal(calcCommission(10000, 0.0003, 5), 5)    // 3 < 5 → 5
  assert.equal(calcCommission(100000, 0.0003, 5), 30)  // 30 > 5 → 30
  assert.equal(calcCommission(5000, 0.0003, 0), 1.5)
})

// ---- 综合场景 ----

test('多次运算不累积浮点误差', () => {
  // 模拟 FIFO 累加：100 笔每股 12.166667 的交易
  let total = 0
  for (let i = 0; i < 100; i++) {
    total = add(total, 12.166667)
  }
  assert.equal(total, 1216.6667)
  // JS 原生累加对比
  let jsTotal = 0
  for (let i = 0; i < 100; i++) jsTotal += 12.166667
  assert.notEqual(jsTotal, 1216.6667) // JS 会有微小浮点误差
})
