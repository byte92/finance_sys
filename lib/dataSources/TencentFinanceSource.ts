// 腾讯财经数据源 - 国内A股/港股免费实时行情（无需API Key，支持浏览器端直连）
// 接口文档: http://qt.gtimg.cn/q=sz000001

import type { StockDataSource, StockQuote, DataSourceConfig } from '@/types/stockApi'
import type { Market } from '@/types'

const API_BASE = 'https://qt.gtimg.cn'

type TencentValuation = {
  peTtm?: number
  epsTtm?: number
  pb?: number
  marketCap?: number
  valuationSource?: string
}

// 将腾讯API返回的GBK编码数据解码为UTF-8
async function decodeGBK(res: Response): Promise<string> {
  const buffer = await res.arrayBuffer()
  try {
    // 服务端使用 iconv-lite 解码
    const iconv = await import('iconv-lite')
    return iconv.decode(Buffer.from(buffer), 'GBK')
  } catch {
    // 如果 iconv-lite 不可用（如浏览器端），尝试用 TextDecoder
    try {
      // Safari/Edge 支持 GBK，其他浏览器可能不支持
      const decoder = new TextDecoder('GBK')
      return decoder.decode(buffer)
    } catch {
      // 最后回退到 UTF-8（会有乱码，但至少不会崩溃）
      return new TextDecoder('utf-8').decode(buffer)
    }
  }
}

// 将股票代码转换为腾讯格式
// A股: sz000001(深交所) sh600519(上交所) sh510300(ETF-上交所)
// 港股: hk00700
function toTencentCode(code: string, market: Market): string {
  if (market === 'HK') {
    // 补齐5位
    return `hk${code.padStart(5, '0')}`
  }
  if (market === 'A' || market === 'FUND') {
    const c = code.trim()
    // 上交所：6开头 / 5开头(ETF)
    if (c.startsWith('6') || c.startsWith('5')) return `sh${c}`
    // 深交所：0/1/2/3开头
    return `sz${c}`
  }
  if (market === 'US') {
    return `us${code.trim().toUpperCase()}`
  }
  return code
}

/**
 * 腾讯财经行情数据源，负责获取 A 股、港股、基金等报价和估值字段，并处理 GBK 文本响应解析。
 */
export class TencentFinanceSource implements StockDataSource {
  provider = 'tencent' as const
  config: DataSourceConfig

  constructor(config: DataSourceConfig) {
    this.config = config
  }

  requiresApiKey() { return false }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/q=sh000001`, { mode: 'cors' })
      return res.ok
    } catch {
      return false
    }
  }

  async getQuote(symbol: string, market: Market): Promise<StockQuote | null> {
    if (market !== 'A' && market !== 'HK' && market !== 'FUND' && market !== 'US') return null

    try {
      const code = toTencentCode(symbol, market)
      // 使用 jsonp-like 的文本接口（浏览器可直接请求）
      const url = `${API_BASE}/q=${code}&r=${Date.now()}`
      const res = await fetch(url, {
        headers: { Referer: 'https://finance.qq.com' },
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      })
      if (!res.ok) return null

      const text = await decodeGBK(res)
      return parseTencentResponse(text, symbol, market)
    } catch (e) {
      console.warn('[TencentFinance] 请求失败:', e)
      return null
    }
  }

  async getBatchQuotes(symbols: string[], market: Market): Promise<StockQuote[]> {
    if (market !== 'A' && market !== 'HK' && market !== 'FUND' && market !== 'US') return []
    try {
      const codes = symbols.map((s) => toTencentCode(s, market)).join(',')
      const url = `${API_BASE}/q=${codes}&r=${Date.now()}`
      const res = await fetch(url, {
        headers: { Referer: 'https://finance.qq.com' },
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      })
      if (!res.ok) return []
      const text = await decodeGBK(res)
      const lines = text.split('\n').filter(Boolean)
      const quotes: StockQuote[] = []
      lines.forEach((line, i) => {
        const q = parseTencentResponse(line, symbols[i] ?? '', market)
        if (q) quotes.push(q)
      })
      return quotes
    } catch {
      return []
    }
  }
}

// 解析腾讯财经返回格式
// v_sz000001="1~平安银行~000001~11.40~11.38~11.41~..."
function parseTencentResponse(text: string, symbol: string, market: Market): StockQuote | null {
  try {
    const match = text.match(/="([^"]+)"/)
    if (!match) return null
    const parts = match[1].split('~')

    if (parts.length < 50) return null

    // 检查是否返回了有效数据（第一个字段应该不是空）
    if (parts[0] === '' || parts[0] === '-') {
      console.warn('[TencentFinance] 股票不存在或已退市:', symbol)
      return null
    }

    const name = parts[1] || symbol // 如果名称为空，使用代码
    const price = parseFloat(parts[3])
    const prevClose = parseFloat(parts[4])
    const open = parseFloat(parts[5])

    // 检查价格是否有效
    if (isNaN(price) || price <= 0) {
      console.warn('[TencentFinance] 价格无效:', symbol, price)
      return null
    }

    const change = price - prevClose
    const changePercent = prevClose ? (change / prevClose) * 100 : 0
    const volume = parseInt(parts[6]) || 0
    const date = parts[30]
    const time = parts[31] || '000000'
    const valuation = parseTencentValuation(parts, price, market)

    const dateStr = date && date.length === 8
      ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+08:00`
      : new Date().toISOString()

    return {
      symbol,
      name,
      price,
      change,
      changePercent,
      volume,
      ...(valuation.peTtm !== undefined ? { peTtm: valuation.peTtm } : {}),
      ...(valuation.epsTtm !== undefined ? { epsTtm: valuation.epsTtm } : {}),
      ...(valuation.pb !== undefined ? { pb: valuation.pb } : {}),
      ...(valuation.marketCap !== undefined ? { marketCap: valuation.marketCap } : {}),
      ...(valuation.valuationSource !== undefined ? { valuationSource: valuation.valuationSource } : {}),
      timestamp: dateStr,
      currency: market === 'HK' ? 'HKD' : market === 'US' ? 'USD' : 'CNY',
      source: 'tencent',
    }
  } catch (e) {
    console.error('[TencentFinance] 解析失败:', e)
    return null
  }
}

function parseTencentValuation(parts: string[], price: number, market: Market): TencentValuation {
  if (market === 'FUND' || market === 'US') {
    return {}
  }

  if (market === 'HK') {
    const peTtm = parsePositiveNumber(parts[57]) ?? parsePositiveNumber(parts[39]) ?? parsePositiveNumber(parts[71])
    const pb = parsePositiveNumber(parts[58])
    const marketCap = parsePositiveNumber(parts[44]) ? Number(parts[44]) * 1e8 : undefined

    return {
      ...(peTtm !== undefined ? { peTtm } : {}),
      ...(peTtm !== undefined ? { epsTtm: roundNumber(price / peTtm, 4) } : {}),
      ...(pb !== undefined ? { pb } : {}),
      ...(marketCap !== undefined ? { marketCap } : {}),
      valuationSource: 'tencent',
    }
  }

  const peTtm = parsePositiveNumber(parts[53]) ?? parsePositiveNumber(parts[52]) ?? parsePositiveNumber(parts[39])
  const pb = parsePositiveNumber(parts[46])
  const marketCap = parsePositiveNumber(parts[44]) ? Number(parts[44]) * 1e8 : undefined

  return {
    ...(peTtm !== undefined ? { peTtm } : {}),
    ...(peTtm !== undefined ? { epsTtm: roundNumber(price / peTtm, 4) } : {}),
    ...(pb !== undefined ? { pb } : {}),
    ...(marketCap !== undefined ? { marketCap } : {}),
    valuationSource: 'tencent',
  }
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function roundNumber(value: number, decimals: number) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
