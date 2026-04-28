import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPortfolioStore } from '@/lib/sqlite/db'
import { DEFAULT_APP_CONFIG } from '@/config/defaults'
import type { AiAnalysisResult } from '@/types'

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

function createAnalysisResult(summary: string, generatedAt: string): AiAnalysisResult {
  return {
    generatedAt,
    cached: false,
    analysisStrength: 'high',
    summary,
    stance: '中性偏观察',
    facts: [],
    inferences: [],
    actionPlan: [],
    invalidationSignals: [],
    timeHorizons: [],
    probabilityAssessment: [],
    technicalSignals: [],
    newsDrivers: [],
    keyLevels: [],
    actionableObservations: [],
    risks: [],
    confidence: 'medium',
    disclaimer: '仅供参考',
    evidence: [],
  }
}

test('sqlite ai history filters latest stock analysis by stock id', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    store.saveAiAnalysis({
      id: 'record-1',
      userId: 'local:test-user',
      type: 'stock',
      stockId: 'stock-1',
      stockCode: '601838',
      stockName: '成都银行',
      market: 'A',
      confidence: 'medium',
      tags: ['个股分析', '601838'],
      generatedAt: '2026-04-20T08:00:00.000Z',
      result: createAnalysisResult('成都银行旧分析', '2026-04-20T08:00:00.000Z'),
    })
    store.saveAiAnalysis({
      id: 'record-2',
      userId: 'local:test-user',
      type: 'stock',
      stockId: 'stock-2',
      stockCode: '510300',
      stockName: '沪深300ETF',
      market: 'A',
      confidence: 'medium',
      tags: ['个股分析', '510300'],
      generatedAt: '2026-04-21T08:00:00.000Z',
      result: createAnalysisResult('ETF 分析', '2026-04-21T08:00:00.000Z'),
    })
    store.saveAiAnalysis({
      id: 'record-3',
      userId: 'local:test-user',
      type: 'stock',
      stockId: 'stock-1',
      stockCode: '601838',
      stockName: '成都银行',
      market: 'A',
      confidence: 'high',
      tags: ['个股分析', '601838'],
      generatedAt: '2026-04-22T08:00:00.000Z',
      result: createAnalysisResult('成都银行最新分析', '2026-04-22T08:00:00.000Z'),
    })

    const records = store.listAiAnalysisByUserId('local:test-user', { type: 'stock', stockId: 'stock-1', limit: 1 })

    assert.equal(records.length, 1)
    assert.equal(records[0]?.id, 'record-3')
    assert.equal(records[0]?.result.summary, '成都银行最新分析')
  } finally {
    store.close()
  }
})
