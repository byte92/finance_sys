'use client'

import { useCallback, useEffect, useState } from 'react'

const AI_DEBUG_MODE_STORAGE_KEY = 'stock-tracker-ai-debug-enabled'
const AI_DEBUG_MODE_CHANGE_EVENT = 'stock-tracker-ai-debug-mode-change'

function readUrlDebugFlag() {
  const params = new URLSearchParams(window.location.search)
  const value = params.get('debug')
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  return null
}

function readStoredDebugFlag() {
  return localStorage.getItem(AI_DEBUG_MODE_STORAGE_KEY) === 'true'
}

function writeDebugFlag(enabled: boolean) {
  localStorage.setItem(AI_DEBUG_MODE_STORAGE_KEY, String(enabled))
  window.dispatchEvent(new CustomEvent(AI_DEBUG_MODE_CHANGE_EVENT, { detail: { enabled } }))
}

export function useAiDebugMode() {
  const [debugEnabled, setDebugEnabledState] = useState(false)

  useEffect(() => {
    const urlFlag = readUrlDebugFlag()
    const next = urlFlag ?? readStoredDebugFlag()
    setDebugEnabledState(next)
    if (urlFlag !== null) {
      localStorage.setItem(AI_DEBUG_MODE_STORAGE_KEY, String(urlFlag))
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === AI_DEBUG_MODE_STORAGE_KEY) {
        setDebugEnabledState(event.newValue === 'true')
      }
    }
    const handleChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled?: boolean }>
      if (typeof customEvent.detail?.enabled === 'boolean') {
        setDebugEnabledState(customEvent.detail.enabled)
      }
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(AI_DEBUG_MODE_CHANGE_EVENT, handleChange)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(AI_DEBUG_MODE_CHANGE_EVENT, handleChange)
    }
  }, [])

  const setDebugEnabled = useCallback((enabled: boolean) => {
    setDebugEnabledState(enabled)
    writeDebugFlag(enabled)
  }, [])

  return { debugEnabled, setDebugEnabled }
}
