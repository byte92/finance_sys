// React Hook for 股价获取
import { useState, useEffect, useCallback } from 'react'
import type { StockQuote } from '@/types/stockApi'
import type { Market } from '@/types'

interface Options {
  autoRefresh?: boolean
  refreshInterval?: number
}

export function useStockQuote(symbol: string, market: Market, options: Options = {}) {
  const { autoRefresh = false, refreshInterval = 60000 } = options

  const [quote, setQuote] = useState<StockQuote | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchQuote = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/stock/quote?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}`,
        { cache: 'no-store' }
      )
      const data = await res.json()
      const result = (data?.quote ?? null) as StockQuote | null
      setQuote(result)
      if (!result) setError(data?.error ?? '暂无行情数据')
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取失败')
    } finally {
      setLoading(false)
    }
  }, [symbol, market])

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
        `/api/stock/quote?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}&forceRefresh=1`,
        { cache: 'no-store' }
      )
      const data = await res.json()
      const result = (data?.quote ?? null) as StockQuote | null
      setQuote(result)
      if (!result) setError(data?.error ?? '暂无行情数据')
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取失败')
    } finally {
      setLoading(false)
    }
  }, [symbol, market])

  return { quote, loading, error, refresh: fetchQuote, forceRefresh }
}
