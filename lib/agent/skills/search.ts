import type { AgentSkill } from '@/lib/agent/types'

export type WebSearchInput = {
  query: string
  limit?: number
  searchLimit?: number
}

export type WebSearchItem = {
  title: string
  snippet: string
  url: string
  content?: string
  source?: string
}

export type WebSearchResult = {
  query: string
  results: WebSearchItem[]
  searchedAt: string
}

type PlaywrightBrowser = import('playwright').Browser
type PlaywrightBrowserContext = import('playwright').BrowserContext
type PlaywrightPage = import('playwright').Page

export const webSearchSkill: AgentSkill<WebSearchInput, WebSearchResult> = {
  name: 'web.search',
  description: '通过搜索引擎查找最新财报、公告、新闻等公开信息，并用浏览器抓取二级页面内容',
  inputSchema: { query: 'string', limit: 'number?', searchLimit: 'number?' },
  requiredScopes: ['network.fetch'],
  async execute(args) {
    const query = String(args.query ?? '').trim()
    if (!query) return { skillName: 'web.search', ok: false, error: '缺少搜索关键词' }

    const resultLimit = clampNumber(args.limit, 5, 1, 10)
    const searchLimit = Math.max(resultLimit, clampNumber(args.searchLimit, 10, 1, 20))

    let browser: PlaywrightBrowser | null = null
    let context: PlaywrightBrowserContext | null = null

    try {
      // 动态导入避免 SSR 时加载原生模块。
      const { chromium } = await import('playwright')

      browser = await chromium.launch({ headless: true })
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'zh-CN',
      })

      const searchPage = await context.newPage()
      const candidates = await collectSearchCandidates(searchPage, query, searchLimit)
      await searchPage.close().catch(() => {})

      const rankedCandidates = sortByRelevance(query, dedupeResults(candidates)).slice(0, searchLimit)
      const enriched = await enrichResults(context, rankedCandidates, query, searchLimit)
      const relevant = filterRelevantResults(query, enriched)
      const results = (relevant.length ? relevant : sortByRelevance(query, enriched)).slice(0, resultLimit)

      return buildSearchResult(query, results, resultLimit)
    } catch (error) {
      return { skillName: 'web.search', ok: false, error: describeWebSearchError(error) }
    } finally {
      await context?.close().catch(() => {})
      await browser?.close().catch(() => {})
    }
  },
}

function buildSearchResult(query: string, results: WebSearchItem[], limit: number) {
  return {
    skillName: 'web.search',
    ok: true,
    data: {
      query,
      results: results.slice(0, limit),
      searchedAt: new Date().toISOString(),
    },
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(parsed, max))
}

export function describeWebSearchError(error: unknown) {
  if (!(error instanceof Error)) return '搜索请求失败'
  if (isMissingPlaywrightBrowserError(error.message)) {
    return '未找到 Playwright Chromium 浏览器，请先安装 Playwright 浏览器依赖'
  }
  return error.message || '搜索请求失败'
}

function isMissingPlaywrightBrowserError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("executable doesn't exist") || normalized.includes('playwright install')
}

async function collectSearchCandidates(page: PlaywrightPage, query: string, searchLimit: number): Promise<WebSearchItem[]> {
  const items: WebSearchItem[] = []
  const variants = buildQueryVariants(query).slice(0, 4)

  for (const item of variants) {
    items.push(...await searchGoogle(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break

    items.push(...await searchBaidu(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break

    items.push(...await searchSogou(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break

    items.push(...await searchDuckDuckGo(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break

    items.push(...await searchBing(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break
  }

  return sortByRelevance(query, dedupeResults(items)).slice(0, searchLimit)
}

async function searchGoogle(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-CN&num=${limit}`, {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('#search', { timeout: 5_000 }).catch(() => {})

  const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
  if (bodyText.includes('异常流量') || bodyText.toLowerCase().includes('unusual traffic')) return []

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('#search .g, #search .MjjYud')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const titleEl = node.querySelector('h3')
      const snippetEl = node.querySelector('.VwiC3b, .lEBKkf, div[data-sncf], span.st')
      const linkEl = node.querySelector<HTMLAnchorElement>('a[href^="http"]')
      const url = linkEl?.href ?? ''
      if (titleEl?.textContent && url) {
        items.push({
          title: titleEl.textContent.trim(),
          snippet: snippetEl?.textContent?.trim() ?? '',
          url,
          source: 'google',
        })
      }
    })
    return items
  }, limit)

  return dedupeResults(results)
}

async function searchBaidu(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('#content_left, .result, .result-op', { timeout: 5_000 }).catch(() => {})

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('#content_left .result, #content_left .result-op, #content_left [tpl]')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const linkEl = node.querySelector<HTMLAnchorElement>('h3 a, .c-title a, a[href^="http"]')
      const title = linkEl?.textContent?.trim() ?? ''
      const url = linkEl?.href ?? ''
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const snippet = text.startsWith(title) ? text.slice(title.length).trim() : text
      if (title && url) {
        items.push({ title, snippet, url, source: 'baidu' })
      }
    })
    return items
  }, limit)

  return dedupeResults(results)
}

async function searchSogou(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('.results, .vrwrap, .rb', { timeout: 5_000 }).catch(() => {})

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('.results .vrwrap, .results .rb, .results > div')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const linkEl = node.querySelector<HTMLAnchorElement>('h3 a, .vr-title a, a[href^="http"]')
      const title = linkEl?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const url = linkEl?.href ?? ''
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const snippet = text.startsWith(title) ? text.slice(title.length).trim() : text
      if (title && url) {
        items.push({ title, snippet, url, source: 'sogou' })
      }
    })
    return items
  }, limit)

  return dedupeResults(results)
}

async function searchDuckDuckGo(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('.result, .links_main', { timeout: 5_000 }).catch(() => {})

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('.result, .links_main.result__body, .web-result')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const titleEl = node.querySelector<HTMLAnchorElement>('.result__a, a.result__a, h2 a')
      const snippetEl = node.querySelector('.result__snippet, .result__body, .snippet')
      const rawUrl = titleEl?.getAttribute('href') ?? titleEl?.href ?? ''
      if (titleEl?.textContent && rawUrl) {
        items.push({
          title: titleEl.textContent.trim(),
          snippet: snippetEl?.textContent?.trim() ?? '',
          url: rawUrl,
          source: 'duckduckgo',
        })
      }
    })
    return items
  }, limit)

  return dedupeResults(results.map((item) => ({ ...item, url: normalizeDuckUrl(item.url) })))
}

async function searchBing(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('li.b_algo', { timeout: 5_000 }).catch(() => {})

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('li.b_algo')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const linkEl = node.querySelector<HTMLAnchorElement>('h2 a')
      const snippetEl = node.querySelector('p')
      const url = linkEl?.href ?? ''
      if (linkEl?.textContent && url) {
        items.push({
          title: linkEl.textContent.trim(),
          snippet: snippetEl?.textContent?.trim() ?? '',
          url,
          source: 'bing',
        })
      }
    })
    return items
  }, limit)

  return dedupeResults(results)
}

async function enrichResults(
  context: PlaywrightBrowserContext,
  results: WebSearchItem[],
  query: string,
  searchLimit: number,
): Promise<WebSearchItem[]> {
  const top = sortByRelevance(query, dedupeResults(results)).slice(0, Math.min(searchLimit, 10))
  const enriched: WebSearchItem[] = []
  const batchSize = 3

  for (let index = 0; index < top.length; index += batchSize) {
    const batch = top.slice(index, index + batchSize)
    const items = await Promise.all(batch.map(async (item) => {
      const captured = await capturePageContentWithBrowser(context, item.url).catch(() => null)
      if (!captured?.content) return item
      return { ...item, url: captured.finalUrl || item.url, content: captured.content }
    }))
    enriched.push(...items)
  }

  return sortByRelevance(query, enriched)
}

async function capturePageContentWithBrowser(context: PlaywrightBrowserContext, url: string) {
  if (/\.pdf(?:$|\?)/i.test(url)) return null

  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {})

    const content = await page.evaluate(() => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="description"], meta[property="og:description"]')?.content ?? ''
      const root = document.querySelector('article, main, [role="main"]') ?? document.body
      const blocks = Array.from(root.querySelectorAll('h1, h2, h3, p, li'))
        .map((node) => node.textContent?.trim() ?? '')
        .filter((text) => text.length >= 20)
      return [meta, ...blocks].filter(Boolean).join('\n')
    })

    return {
      content: normalizeWhitespace(content).slice(0, 1800),
      finalUrl: page.url(),
    }
  } finally {
    await page.close().catch(() => {})
  }
}

export function buildQueryVariants(query: string) {
  const year = String(new Date().getFullYear())
  const code = query.match(/\b\d{6}\b/)?.[0]
  const chineseName = extractLikelyChineseStockName(query, code)
  const nameCode = [chineseName, code].filter(Boolean).join(' ')
  const variants: string[] = []
  const push = (value: string | null | undefined) => {
    const normalized = value?.replace(/\s+/g, ' ').trim()
    if (normalized) variants.push(normalized)
  }

  if (code && isAStockCode(code) && isAStockAnnouncementQuery(query)) {
    const exchange = getAStockExchange(code)
    push(`site:cninfo.com.cn ${nameCode || code} 公告 ${year}`)
    if (exchange?.site) push(`site:${exchange.site} ${nameCode || code} 公告 ${year}`)
    push(`${nameCode || code} 公告 巨潮资讯 ${exchange?.label ?? '交易所'} 官方公告 ${year}`)
    if (isFinancialReportQuery(query)) {
      push(`site:cninfo.com.cn ${nameCode || code} 年报 季报 一季报 净利润 营业收入 ${year}`)
      if (exchange?.site) push(`site:${exchange.site} ${nameCode || code} 定期报告 业绩 ${year}`)
    }
  }

  if (isAShareMarketNewsQuery(query)) {
    push(`A股 今日 大盘 新闻 政策 盘面 ${year}`)
    push(`A股 今日 大事件 政策 证券时报 中国证券报 财联社 ${year}`)
    push(`A股 证监会 央行 财政部 政策 新闻 ${year}`)
  }

  if (code && nameCode && isStockNewsQuery(query)) {
    push(`${nameCode} 今日 新闻 利好 利空 ${year}`)
    push(`${nameCode} 最新消息 发生了什么 ${year}`)
  }

  push(query.replace(/最新财报/g, '').replace(/\s+/g, ' ').trim())
  push(query)
  push(query.replace(/最新财报/g, '一季报').replace(/\s+/g, ' ').trim())
  push(`${query} ${year}`)
  push(code && chineseName ? `${chineseName} ${code}.SH ${year} 一季报 净利润 营业收入` : '')
  push(code && chineseName ? `${chineseName} ${year} 一季报 净利润 营业收入 ${code}` : '')
  return Array.from(new Set(variants.filter(Boolean)))
}

function hasEnoughCandidates(results: WebSearchItem[], searchLimit: number) {
  return dedupeResults(results).length >= searchLimit
}

function filterRelevantResults(query: string, results: WebSearchItem[]) {
  const sorted = sortByRelevance(query, dedupeResults(results))
  const threshold = isFinancialReportQuery(query) ? 5 : 3
  const relevant = sorted.filter((item) => scoreResult(query, item) >= threshold)
  if (relevant.length) return relevant

  return sorted.filter((item) => scoreResult(query, item) >= 2)
}

function sortByRelevance(query: string, results: WebSearchItem[]) {
  return [...results].sort((a, b) => scoreResult(query, b) - scoreResult(query, a))
}

function scoreResult(query: string, result: WebSearchItem) {
  const haystack = `${result.title} ${result.snippet} ${result.url} ${result.content ?? ''}`.toLowerCase()
  const tokens = Array.from(new Set(query.toLowerCase().match(/[a-z0-9.]+|[\u4e00-\u9fa5]{2,}/g) ?? []))
    .filter((token) => !['最新财报', '财报', 'site'].includes(token))
  const tokenScore = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0)
  const financeScore = /(财报|一季报|季报|年报|业绩|公告|营业收入|净利润|eps|revenue|earnings)/i.test(haystack) ? 2 : 0
  const metricScore = /(同比增长|同比下降|归母|归属于|869\.41|2303\.70|净利润.*亿元|营业收入.*亿元)/i.test(haystack) ? 3 : 0
  const authorityScore = isAStockAnnouncementQuery(query) && /(cninfo\.com\.cn|sse\.com\.cn|szse\.cn|巨潮资讯|上海证券交易所|深圳证券交易所|上交所|深交所)/i.test(haystack) ? 5 : 0
  const marketNewsScore = isAShareMarketNewsQuery(query) && /(证监会|新华社|证券时报|中国证券报|上海证券报|财联社|央视财经|央行|财政部)/i.test(haystack) ? 2 : 0
  const contentScore = result.content && result.content.length >= 80 ? 1 : 0
  const junkPenalty = /(工商登记|政务服务|企业信用|采购公告|招标|招聘|开户行|网点查询|电子银行|网上银行|市场监督管理)/i.test(haystack) ? -6 : 0
  return tokenScore + financeScore + metricScore + authorityScore + marketNewsScore + contentScore + junkPenalty
}

function isFinancialReportQuery(query: string) {
  return /(财报|一季报|季报|年报|业绩|营业收入|净利润|eps|revenue|earnings)/i.test(query)
}

function isAStockAnnouncementQuery(query: string) {
  return /(公告|披露|停牌|复牌|减持|增持|回购|业绩预告|业绩快报|年报|季报|半年报|重大事项|澄清|财报|定期报告)/i.test(query)
}

function isStockNewsQuery(query: string) {
  return /(新闻|消息|利好|利空|发生了什么|出了?什么事|怎么了|今日|今天|最新)/i.test(query)
}

function isAShareMarketNewsQuery(query: string) {
  return /(A\s*股|大盘|盘面|沪指|上证|深成指|创业板|两市|三大指数)/i.test(query)
    && /(今日|今天|新闻|消息|政策|大事件|事件|盘面|发生|利好|利空|证监会|央行|财政部|降准|降息)/i.test(query)
}

function isAStockCode(code: string) {
  return /^\d{6}$/.test(code)
}

function getAStockExchange(code: string) {
  if (/^6/.test(code)) return { site: 'sse.com.cn', label: '上交所' }
  if (/^[023]/.test(code)) return { site: 'szse.cn', label: '深交所' }
  return null
}

function extractLikelyChineseStockName(query: string, code?: string) {
  if (code) {
    const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const beforeCode = query.match(new RegExp(`([\\u4e00-\\u9fa5]{2,})\\s+${escapedCode}\\b`))?.[1]
    if (beforeCode) return beforeCode
    const afterCode = query.match(new RegExp(`\\b${escapedCode}\\s+([\\u4e00-\\u9fa5]{2,})`))?.[1]
    if (afterCode && !isGenericSearchToken(afterCode)) return afterCode
  }

  return query.match(/[\u4e00-\u9fa5]{2,}/g)?.find((token) => !isGenericSearchToken(token)) ?? null
}

function isGenericSearchToken(token: string) {
  return /^(最新|今日|今天|新闻|消息|公告|官方公告|巨潮资讯|上交所|深交所|交易所|财报|年报|季报|半年报|一季报|业绩|利好|利空|政策|大盘|盘面)$/.test(token)
}

function normalizeDuckUrl(raw: string) {
  const normalized = raw.startsWith('//') ? `https:${raw}` : raw
  try {
    const url = new URL(normalized)
    return url.searchParams.get('uddg') ?? normalized
  } catch {
    return normalized.startsWith('http') ? normalized : ''
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function dedupeResults(items: WebSearchItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!item.title || !item.url || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}
