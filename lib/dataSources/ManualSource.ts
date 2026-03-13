// 手动输入 Fallback 数据源
import type { StockDataSource, StockQuote, DataSourceConfig } from '@/types/stockApi'
import type { Market } from '@/types'

export class ManualDataSource implements StockDataSource {
  provider = 'manual' as const
  config: DataSourceConfig

  constructor(config: DataSourceConfig) { this.config = config }
  requiresApiKey() { return false }
  async healthCheck() { return true }
  async getQuote(_symbol: string, _market: Market): Promise<StockQuote | null> { return null }
  async getBatchQuotes(_symbols: string[], _market: Market): Promise<StockQuote[]> { return [] }
}
