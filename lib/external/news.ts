import type { Market, NewsItem } from '@/types'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'

function decodeXmlTag(item: string, tag: string) {
  const value = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? ''
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function fetchStockNews(symbol: string, stockName: string, market: Market, limit = 5): Promise<NewsItem[]> {
  const queryParts = [stockName, symbol]
  if (market === 'A' || market === 'FUND') queryParts.push('A股')
  if (market === 'HK') queryParts.push('港股')
  if (market === 'US') queryParts.push('美股')
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(queryParts.join(' '))}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`

  try {
    const res = await loggedFetch(url, { signal: AbortSignal.timeout(7000), cache: 'no-store' }, {
      operation: 'news.google.rssSearch',
      provider: 'google-news',
      resource: queryParts.join(' '),
      metadata: { symbol, market, limit },
    })
    if (!res.ok) return []
    const xml = await res.text()
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))
      .map((match) => match[1])
      .map((item) => ({
        title: decodeXmlTag(item, 'title'),
        source: decodeXmlTag(item, 'source') || 'Google News',
        publishedAt: decodeXmlTag(item, 'pubDate'),
        summary: stripHtml(decodeXmlTag(item, 'description')).slice(0, 220),
        url: decodeXmlTag(item, 'link'),
      }))
      .filter((item) => item.title && item.url)

    const deduped = new Map<string, NewsItem>()
    for (const item of items) {
      if (!deduped.has(item.title)) deduped.set(item.title, item)
    }
    return Array.from(deduped.values()).slice(0, limit)
  } catch (error) {
    logger.warn('news.google.rssSearch.failed', { error, symbol, market })
    return []
  }
}
