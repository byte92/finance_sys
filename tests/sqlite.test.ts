import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPortfolioStore } from '@/lib/sqlite/db'
import { DEFAULT_APP_CONFIG } from '@/config/defaults'

function createTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-sqlite-test-'))
  return path.join(dir, 'finance.sqlite')
}

test('sqlite store returns default payload for missing user', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    const payload = store.getPortfolioByUserId('missing-user')
    assert.deepEqual(payload, { stocks: [], config: DEFAULT_APP_CONFIG })
  } finally {
    store.close()
  }
})

test('sqlite store persists and reloads portfolio payload', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    const payload = {
      stocks: [
        {
          id: 'stock-1',
          code: '510300',
          name: '沪深300ETF华泰柏瑞',
          market: 'A' as const,
          trades: [],
          note: 'test',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      config: DEFAULT_APP_CONFIG,
    }

    store.savePortfolioByUserId('local:test-user', payload)
    const loaded = store.getPortfolioByUserId('local:test-user')

    assert.deepEqual(loaded, payload)
  } finally {
    store.close()
  }
})

test('sqlite store falls back to default config when payload is invalid json', () => {
  const store = createPortfolioStore(createTempDbPath())
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    store.rawInsert('broken-user', '{not-valid-json')
    const loaded = store.getPortfolioByUserId('broken-user')
    assert.deepEqual(loaded, { stocks: [], config: DEFAULT_APP_CONFIG })
  } finally {
    console.error = originalConsoleError
    store.close()
  }
})
