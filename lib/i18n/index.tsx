'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ASSET_UNIT_MESSAGES,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  MARKET_CODE_PLACEHOLDER_MESSAGES,
  MARKET_LABEL_MESSAGES,
  enMessages,
  type Locale,
} from '@/lib/i18n/messages'
import type { Market } from '@/types'

type TranslationParams = Record<string, string | number | undefined | null>

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, params?: TranslationParams) => string
  formatDateTime: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string
  formatTime: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string
  numberLocale: string
  getMarketLabel: (market: Market) => string
  getAssetUnit: (market: Market) => string
  getMarketCodePlaceholder: (market: Market) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function interpolate(template: string, params?: TranslationParams) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key]
    return value === undefined || value === null ? match : String(value)
  })
}

function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null
  if (value === 'zh-CN' || value.toLowerCase().startsWith('zh')) return 'zh-CN'
  if (value === 'en-US' || value.toLowerCase().startsWith('en')) return 'en-US'
  return null
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    const storedLocale = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY))
    setLocaleState(storedLocale ?? DEFAULT_LOCALE)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale)
    localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale)
  }, [])

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: string, params?: TranslationParams) => {
      const template = locale === 'en-US' ? (enMessages[key] ?? key) : key
      return interpolate(template, params)
    }
    const formatDateTime = (value: string | Date, options?: Intl.DateTimeFormatOptions) => (
      new Intl.DateTimeFormat(locale, options ?? {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    )
    const formatTime = (value: string | Date, options?: Intl.DateTimeFormatOptions) => (
      new Intl.DateTimeFormat(locale, options ?? {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(value))
    )

    return {
      locale,
      setLocale,
      t,
      formatDateTime,
      formatTime,
      numberLocale: locale,
      getMarketLabel: (market) => MARKET_LABEL_MESSAGES[market]?.[locale] ?? market,
      getAssetUnit: (market) => ASSET_UNIT_MESSAGES[market]?.[locale] ?? '',
      getMarketCodePlaceholder: (market) => MARKET_CODE_PLACEHOLDER_MESSAGES[market]?.[locale] ?? '',
    }
  }, [locale, setLocale])

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider')
  }
  return value
}
