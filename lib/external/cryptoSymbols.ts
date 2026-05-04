const KNOWN_QUOTE_ASSETS = ['USDT', 'USDC', 'USD', 'BUSD'] as const

export type NormalizedCryptoSymbol = {
  baseAsset: string
  binanceSymbol: string
  coinbaseProductId: string
  displayName: string
}

export function normalizeCryptoSymbol(input: string): NormalizedCryptoSymbol | null {
  const raw = input.trim().toUpperCase()
  if (!raw) return null

  const separated = raw.split(/[-_/\s]+/).filter(Boolean)
  const baseAsset = separated.length >= 2
    ? separated[0]
    : stripKnownQuoteAsset(raw.replace(/[-_/\s]/g, ''))

  if (!baseAsset || !/^[A-Z0-9]{1,20}$/.test(baseAsset)) return null

  return {
    baseAsset,
    binanceSymbol: `${baseAsset}USDT`,
    coinbaseProductId: `${baseAsset}-USD`,
    displayName: `${baseAsset}/USDT`,
  }
}

function stripKnownQuoteAsset(value: string) {
  for (const quote of KNOWN_QUOTE_ASSETS) {
    if (value.length > quote.length && value.endsWith(quote)) {
      return value.slice(0, -quote.length)
    }
  }
  return value
}
