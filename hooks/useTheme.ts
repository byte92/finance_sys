'use client'

import { useState, useEffect } from 'react'

export type Theme = 'dark' | 'light'

const THEME_STORAGE_KEY = 'stock-tracker-theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const html = document.documentElement
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const initialTheme = stored || (prefersDark ? 'dark' : 'light')

    setTheme(initialTheme)
    setMounted(true)

    // 立即应用初始主题
    html.setAttribute('data-theme', initialTheme)
  }, [])

  useEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  return { theme, toggleTheme, mounted }
}
