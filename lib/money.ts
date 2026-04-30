import Big from 'big.js'

// 默认精度：金额运算保留 2 位小数（元/美元），每股成本保留 6 位保证中间精度
const MONEY_DP = 2
const COST_DP = 6

// 舍入模式：四舍五入（half-up），与财务惯例一致
Big.DP = COST_DP
Big.RM = Big.roundHalfUp

function B(val: string | number | Big): Big {
  if (val instanceof Big) return val
  return new Big(val)
}

// ---------- 基本运算 ----------

/** 加法 */
export function add(a: number, b: number): number {
  return B(a).plus(B(b)).toNumber()
}

/** 减法 */
export function sub(a: number, b: number): number {
  return B(a).minus(B(b)).toNumber()
}

/** 乘法 */
export function mul(a: number, b: number): number {
  return B(a).times(B(b)).toNumber()
}

/** 除法 */
export function div(a: number, b: number): number {
  return B(a).div(B(b)).toNumber()
}

// ---------- 舍入 ----------

/** 金额舍入（2 位小数，四舍五入） */
export function roundMoney(value: number): number {
  return B(value).round(MONEY_DP).toNumber()
}

/** 指定精度舍入 */
export function roundTo(value: number, dp: number): number {
  return B(value).round(dp).toNumber()
}

// ---------- 比较 ----------

export function gt(a: number, b: number): boolean {
  return B(a).gt(B(b))
}

export function gte(a: number, b: number): boolean {
  return B(a).gte(B(b))
}

export function lt(a: number, b: number): boolean {
  return B(a).lt(B(b))
}

export function lte(a: number, b: number): boolean {
  return B(a).lte(B(b))
}

export function eq(a: number, b: number): boolean {
  return B(a).eq(B(b))
}

// ---------- 常用组合 ----------

/** 价格 × 数量（含佣金等场景的基础运算） */
export function calcAmount(price: number, quantity: number): number {
  return mul(price, quantity)
}

/** 每股摊薄成本 = 总成本 / 数量 */
export function calcPerShareCost(netAmount: number, quantity: number): number {
  return div(netAmount, quantity)
}

/** 涨跌幅 % = (当前价 - 前收盘) / 前收盘 * 100 */
export function calcChangePercent(current: number, previous: number): number {
  if (eq(previous, 0)) return 0
  return mul(div(sub(current, previous), previous), 100)
}

/** 盈亏 = 卖出实收 - 成本基础 */
export function calcPnl(proceeds: number, costBasis: number): number {
  return sub(proceeds, costBasis)
}

/** 盈亏率% = 盈亏 / 成本基础 * 100 */
export function calcPnlPercent(pnl: number, costBasis: number): number {
  if (eq(costBasis, 0)) return 0
  return mul(div(pnl, costBasis), 100)
}

/** 佣金 = max(成交金额 × 佣金率, 最低佣金) */
export function calcCommission(totalAmount: number, rate: number, minCommission: number): number {
  const raw = mul(totalAmount, rate)
  return roundMoney(gt(raw, minCommission) ? raw : minCommission)
}
