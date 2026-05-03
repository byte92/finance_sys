// 汇率服务 - 获取实时汇率
// 使用免费的汇率API (exchangerate-api.com)
import { mul, div, roundTo } from './money'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'

export type Currency = 'CNY' | 'HKD' | 'USD' | 'USDT'

export interface ExchangeRates {
  CNY: number  // 1 CNY = 1
  HKD: number  // 1 HKD = ? CNY
  USD: number  // 1 USD = ? CNY
  USDT: number // 1 USDT = ? CNY（通常近似USD）
}

// 市场对应货币
export const MARKET_CURRENCY: Record<string, Currency> = {
  'A': 'CNY',
  'HK': 'HKD',
  'US': 'USD',
  'FUND': 'CNY',
  'CRYPTO': 'USDT'
}

// 货币符号
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  'CNY': '¥',
  'HKD': 'HK$',
  'USD': '$',
  'USDT': '$'
}

// 缓存汇率，有效期1小时
let cachedRates: ExchangeRates | null = null
let cacheTime = 0
const CACHE_DURATION = 60 * 60 * 1000 // 1小时

/**
 * 汇率服务，负责获取并缓存外部汇率数据，提供组合资产跨币种折算能力。
 */
class ExchangeRateService {
  private apiUrl = 'https://api.exchangerate-api.com/v4/latest/USD'

  async getRates(): Promise<ExchangeRates & Record<string, number>> {
    const now = Date.now()

    // 检查缓存
    if (cachedRates && (now - cacheTime) < CACHE_DURATION) {
      return cachedRates as ExchangeRates & Record<string, number>
    }

    try {
      const response = await loggedFetch(this.apiUrl, {}, {
        operation: 'exchangeRate.fetchLatest',
        provider: 'exchangerate-api',
        resource: 'USD',
      })
      if (!response.ok) {
        throw new Error('Failed to fetch exchange rates')
      }

      const data = await response.json()
      const rates = data.rates

      // 统一使用“1 单位外币 = ? CNY”
      const result: ExchangeRates & Record<string, number> = {
        CNY: 1,
        HKD: rates.CNY && rates.HKD ? div(rates.CNY, rates.HKD) : 0.92,
        USD: rates.CNY ?? 7.2,
        USDT: rates.CNY ?? 7.2
      }

      cachedRates = result
      cacheTime = now

      return result
    } catch (error) {
      logger.warn('exchangeRate.fetchLatest.failed', { error })

      // 返回默认汇率（仅供参考）
      const defaultRates: ExchangeRates & Record<string, number> = {
        CNY: 1,
        HKD: 0.92,
        USD: 7.2,
        USDT: 7.2
      }
      cachedRates = defaultRates
      return defaultRates
    }
  }

  // 将金额从一种货币转换为另一种
  async convert(amount: number, fromCurrency: Currency, toCurrency: Currency): Promise<number> {
    if (fromCurrency === toCurrency) {
      return amount
    }

    const rates = await this.getRates()
    const fromRate = rates[fromCurrency]
    const toRate = rates[toCurrency]

    // 先转换为CNY，再转换为目标货币
    const cnyAmount = mul(amount, fromRate)
    return div(cnyAmount, toRate)
  }

  clearCache() {
    cachedRates = null
    cacheTime = 0
  }
}

export const exchangeRateService = new ExchangeRateService()
