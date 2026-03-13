// 股价数据源接口定义 - 支持多种API提供商
import type { Market } from '@/types'

// 统一的股价响应格式
export interface StockQuote {
  symbol: string          // 股票代码
  name: string            // 股票名称
  price: number           // 当前价格
  change: number          // 涨跌额
  changePercent: number   // 涨跌幅(%)
  volume?: number         // 成交量
  timestamp: string       // 时间戳
  currency: string        // 货币单位
  source: string          // 数据源标识
}

// 数据源提供商枚举
export type DataSourceProvider = 'tencent' | 'yahoo-finance' | 'alpha-vantage' | 'stooq' | 'manual'

// 数据源配置
export interface DataSourceConfig {
  provider: DataSourceProvider
  apiKey?: string
  baseUrl?: string
  rateLimit?: number      // 每分钟请求限制
  cacheTtl?: number       // 缓存时间(秒)
}

// 数据源接口抽象
export interface StockDataSource {
  provider: DataSourceProvider
  config: DataSourceConfig
  getQuote(symbol: string, market: Market): Promise<StockQuote | null>
  getBatchQuotes(symbols: string[], market: Market): Promise<StockQuote[]>
  healthCheck(): Promise<boolean>
  requiresApiKey(): boolean
}

// API响应缓存项
export interface QuoteCacheItem {
  quote: StockQuote
  timestamp: number
  expiresAt: number
}

// 全局股价服务配置
export interface StockServiceConfig {
  defaultProvider: DataSourceProvider
  sources: Partial<Record<DataSourceProvider, DataSourceConfig>>
  cacheEnabled: boolean
  cacheTtl: number
  fallbackChain: DataSourceProvider[]
}
