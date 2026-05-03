import type { Market, Stock } from '@/types'

export type StockMatch = {
  stock: Stock
  confidence: number
  reason: string
}

const MARKET_LABELS: Record<Market, string> = {
  A: 'A 股',
  HK: '港股',
  US: '美股',
  FUND: '基金',
  CRYPTO: '加密资产',
}

function normalize(input: string) {
  return input
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?;；:：()[\]{}"'“”‘’]/g, '')
}

export function detectStockCode(input: string) {
  const pattern = /\b[A-Z]{1,6}\b|\b\d{5,6}\b/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input))) {
    const value = match[0]
    const nextChar = input[match.index + value.length]
    if (/^[A-Z]{1,6}$/.test(value) && nextChar === '股') continue
    return value.toUpperCase()
  }
  return null
}

export function matchStocks(query: string, stocks: Stock[], limit = 5): StockMatch[] {
  const normalizedQuery = normalize(query)
  const code = detectStockCode(query)
  if (!normalizedQuery && !code) return []

  const matches = stocks
    .map((stock) => {
      const normalizedName = normalize(stock.name)
      const normalizedCode = normalize(stock.code)
      let confidence = 0
      let reason = ''

      if (code && stock.code.toUpperCase() === code) {
        confidence = 1
        reason = '代码精确匹配'
      } else if (normalizedQuery === normalizedName || normalizedQuery === normalizedCode) {
        confidence = 0.98
        reason = '名称或代码精确匹配'
      } else if (normalizedName && normalizedQuery.includes(normalizedName)) {
        confidence = 0.92
        reason = '用户问题包含完整持仓名称'
      } else if (normalizedCode && normalizedQuery.includes(normalizedCode)) {
        confidence = 0.9
        reason = '用户问题包含持仓代码'
      } else if (normalizedName && normalizedName.includes(normalizedQuery) && normalizedQuery.length >= 2) {
        confidence = 0.72
        reason = '持仓名称模糊匹配'
      }

      return confidence > 0 ? { stock, confidence, reason } : null
    })
    .filter((item): item is StockMatch => item !== null)
    .sort((a, b) => b.confidence - a.confidence)

  return matches.slice(0, limit)
}

export function formatStockCandidate(stock: Stock) {
  return `${stock.name}（${stock.code}，${MARKET_LABELS[stock.market]}）`
}
