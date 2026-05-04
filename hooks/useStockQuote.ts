// React Hook for 股价获取
import { useState, useEffect, useCallback } from 'react'
import { nextApiUrls } from '@/lib/api/endpoints'
import { useI18n } from '@/lib/i18n'
import type { StockQuote } from '@/types/stockApi'
import type { Market } from '@/types'

interface Options {
  autoRefresh?: boolean
  refreshInterval?: number
}

export function useStockQuote(symbol: string, market: Market, options: Options = {}) {
  const { autoRefresh = false, refreshInterval = 60000 } = options
  const { t } = useI18n()

  const [quote, setQuote] = useState<StockQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchQuote = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        nextApiUrls.stock.quote(symbol, market),
        { cache: 'no-store' }
      )
      const data = await res.json()
      const result = (data?.quote ?? null) as StockQuote | null
      setQuote(result)
      if (!result) setError(t(data?.error ?? '暂无行情数据'))
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t('获取失败'))
    } finally {
      setLoading(false)
    }
  }, [symbol, market, t])

  useEffect(() => { fetchQuote() }, [fetchQuote])

  useEffect(() => {
    if (!autoRefresh || !symbol) return
    const id = setInterval(fetchQuote, refreshInterval)
    return () => clearInterval(id)
  }, [autoRefresh, refreshInterval, symbol, fetchQuote])

  const forceRefresh = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        nextApiUrls.stock.quote(symbol, market, { forceRefresh: true }),
        { cache: 'no-store' }
      )
      const data = await res.json()
      const result = (data?.quote ?? null) as StockQuote | null
      setQuote(result)
      if (!result) setError(t(data?.error ?? '暂无行情数据'))
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t('获取失败'))
    } finally {
      setLoading(false)
    }
  }, [symbol, market, t])

  return { quote, loading, error, refresh: fetchQuote, forceRefresh }
}
