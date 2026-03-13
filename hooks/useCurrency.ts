'use client'

import { useState, useEffect } from 'react'
import { exchangeRateService, type Currency, CURRENCY_SYMBOLS, MARKET_CURRENCY } from '@/lib/ExchangeRateService'

const DISPLAY_CURRENCY_KEY = 'stock-tracker-display-currency'

export function useCurrency() {
  const [displayCurrency, setDisplayCurrencyState] = useState<Currency>('CNY')
  const [rates, setRates] = useState<Record<string, number>>({ CNY: 1, HKD: 0.92, USD: 7.2, USDT: 7.2 })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(DISPLAY_CURRENCY_KEY) as Currency | null
    if (saved && ['CNY', 'HKD', 'USD', 'USDT'].includes(saved)) {
      setDisplayCurrencyState(saved)
    }
  }, [])

  // 获取汇率
  useEffect(() => {
    async function fetchRates() {
      setLoading(true)
      try {
        const result = await exchangeRateService.getRates()
        setRates({ ...result } as Record<string, number>)
      } catch (error) {
        console.error('Failed to fetch exchange rates:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchRates()
  }, [])

  // 转换金额到显示货币
  const convertAmount = async (amount: number, fromMarket: string) => {
    const fromCurrency = MARKET_CURRENCY[fromMarket] || 'CNY'
    if (fromCurrency === displayCurrency) {
      return amount
    }
    return await exchangeRateService.convert(amount, fromCurrency as Currency, displayCurrency)
  }

  const setDisplayCurrency = (currency: Currency) => {
    setDisplayCurrencyState(currency)
    localStorage.setItem(DISPLAY_CURRENCY_KEY, currency)
  }

  // 同步转换（使用缓存汇率）
  const convertAmountSync = (amount: number, fromMarket: string) => {
    const fromCurrency = MARKET_CURRENCY[fromMarket] || 'CNY'
    if (fromCurrency === displayCurrency) {
      return amount
    }
    const fromRate = rates[fromCurrency] || 1
    const toRate = rates[displayCurrency] || 1
    return (amount * fromRate) / toRate
  }

  // 格式化金额（带货币符号）
  const formatWithCurrency = (amount: number, currency?: Currency) => {
    const curr = currency || displayCurrency
    const symbol = CURRENCY_SYMBOLS[curr]
    return `${symbol}${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  return {
    displayCurrency,
    setDisplayCurrency,
    rates,
    loading,
    convertAmount,
    convertAmountSync,
    formatWithCurrency
  }
}
