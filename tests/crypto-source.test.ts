import test from 'node:test'
import assert from 'node:assert/strict'
import { CryptoSource } from '@/lib/dataSources/CryptoSource'
import { fetchKline } from '@/lib/external/kline'
import { normalizeCryptoSymbol } from '@/lib/external/cryptoSymbols'

const originalFetch = globalThis.fetch

test('normalizeCryptoSymbol accepts base symbols and common quote pairs', () => {
  assert.deepEqual(normalizeCryptoSymbol('BTC'), {
    baseAsset: 'BTC',
    binanceSymbol: 'BTCUSDT',
    coinbaseProductId: 'BTC-USD',
    displayName: 'BTC/USDT',
  })
  assert.equal(normalizeCryptoSymbol('ETH-USDC')?.baseAsset, 'ETH')
  assert.equal(normalizeCryptoSymbol('sol/usdt')?.binanceSymbol, 'SOLUSDT')
  assert.equal(normalizeCryptoSymbol('BTCUSD')?.coinbaseProductId, 'BTC-USD')
  assert.equal(normalizeCryptoSymbol('比特币'), null)
})

test('CryptoSource reads Binance 24h ticker quote', async () => {
  const source = new CryptoSource({ provider: 'crypto' })
  globalThis.fetch = async (input) => {
    const url = String(input)
    assert.match(url, /\/api\/v3\/ticker\/24hr\?symbol=BTCUSDT/)
    return new Response(JSON.stringify({
      symbol: 'BTCUSDT',
      lastPrice: '65000.12',
      priceChange: '500.10',
      priceChangePercent: '0.775',
      volume: '1234.56',
      closeTime: 1767225600000,
    }))
  }

  try {
    const quote = await source.getQuote('BTC', 'CRYPTO')

    assert.ok(quote)
    assert.equal(quote.symbol, 'BTC')
    assert.equal(quote.name, 'BTC/USDT')
    assert.equal(quote.price, 65000.12)
    assert.equal(quote.change, 500.1)
    assert.equal(quote.changePercent, 0.775)
    assert.equal(quote.volume, 1234.56)
    assert.equal(quote.currency, 'USDT')
    assert.equal(quote.source, 'binance')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CryptoSource falls back to Coinbase stats when Binance has no pair', async () => {
  const source = new CryptoSource({ provider: 'crypto' })
  const requestedUrls: string[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requestedUrls.push(url)
    if (url.includes('/products/BTC-USD/stats')) {
      return new Response(JSON.stringify({
        open: '64000',
        last: '65000',
        volume: '98.7',
      }))
    }
    return new Response(JSON.stringify({ code: -1121, msg: 'Invalid symbol.' }), { status: 400 })
  }

  try {
    const quote = await source.getQuote('BTC', 'CRYPTO')

    assert.ok(quote)
    assert.equal(quote.price, 65000)
    assert.equal(quote.change, 1000)
    assert.equal(quote.changePercent, 1.5625)
    assert.equal(quote.source, 'coinbase-usd')
    assert.ok(requestedUrls.some((url) => url.includes('/api/v3/ticker/24hr')))
    assert.ok(requestedUrls.some((url) => url.includes('/products/BTC-USD/stats')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchKline reads crypto candles from Binance', async () => {
  const now = Date.now()
  globalThis.fetch = async (input) => {
    const url = String(input)
    assert.match(url, /\/api\/v3\/klines/)
    assert.match(url, /symbol=BTCUSDT/)
    return new Response(JSON.stringify([
      [now - 2 * 86400 * 1000, '60000', '61000', '59000', '60500', '10'],
      [now - 86400 * 1000, '60500', '66000', '60400', '65000', '12'],
    ]))
  }

  try {
    const result = await fetchKline('BTC', 'CRYPTO', { interval: '1d', range: '1mo' })

    assert.equal(result.source, 'binance')
    assert.equal(result.candles.length, 2)
    assert.equal(result.candles[0]?.open, 60000)
    assert.equal(result.candles[1]?.close, 65000)
    assert.equal(result.candles[1]?.volume, 12)
  } finally {
    globalThis.fetch = originalFetch
  }
})
