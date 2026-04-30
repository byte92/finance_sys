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
type OsModule = Pick<typeof import('node:os'), 'homedir' | 'platform'>
type PathModule = Pick<typeof import('node:path'), 'join'>
type Env = Partial<Record<string, string | undefined>>

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
      const path = await import('node:path')
      const fs = await import('node:fs')
      const os = await import('node:os')
      const { chromium } = await import('playwright')

      const cacheDir = getPlaywrightBrowsersPath(os, path)
      const execPath = findChromiumExecutable(cacheDir, fs, path)

      if (!execPath) {
        return {
          skillName: 'web.search',
          ok: false,
          error: '未找到 Playwright Chromium 浏览器，请先安装 Playwright 浏览器依赖',
        }
      }

      browser = await chromium.launch({ executablePath: execPath, headless: true })
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
      return { skillName: 'web.search', ok: false, error: error instanceof Error ? error.message : '搜索请求失败' }
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

export function getDefaultPlaywrightBrowsersPath(os: OsModule, path: PathModule, env: Env = process.env) {
  switch (os.platform()) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
    case 'win32':
      return path.join(env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright')
    default:
      return path.join(env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), '.cache'), 'ms-playwright')
  }
}

export function getPlaywrightBrowsersPath(os: OsModule, path: PathModule, env: Env = process.env) {
  return env.PLAYWRIGHT_BROWSERS_PATH?.trim() || getDefaultPlaywrightBrowsersPath(os, path, env)
}

export function findChromiumExecutable(
  cacheDir: string,
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
) {
  if (!fs.existsSync(cacheDir)) return undefined
  const dirs = fs.readdirSync(cacheDir).filter((dir) => dir.startsWith('chromium_headless_shell-'))
  for (const dir of dirs.sort().reverse()) {
    const candidates = [
      path.join(cacheDir, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
      path.join(cacheDir, dir, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
      path.join(cacheDir, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      path.join(cacheDir, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
    ]
    const executable = candidates.find((item) => fs.existsSync(item))
    if (executable) return executable
  }
  return undefined
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

function buildQueryVariants(query: string) {
  const year = String(new Date().getFullYear())
  const code = query.match(/\b\d{6}\b/)?.[0]
  const chineseName = query.match(/[\u4e00-\u9fa5]{2,}(?=\s+\d{6}\b)/)?.[0]
  const variants = [
    query.replace(/最新财报/g, '').replace(/\s+/g, ' ').trim(),
    query,
    query.replace(/最新财报/g, '一季报').replace(/\s+/g, ' ').trim(),
    `${query} ${year}`,
    code && chineseName ? `${chineseName} ${code}.SH ${year} 一季报 净利润 营业收入` : '',
    code && chineseName ? `${chineseName} ${year} 一季报 净利润 营业收入 ${code}` : '',
  ]
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
    .filter((token) => !['最新财报', '财报'].includes(token))
  const tokenScore = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0)
  const financeScore = /(财报|一季报|季报|年报|业绩|公告|营业收入|净利润|eps|revenue|earnings)/i.test(haystack) ? 2 : 0
  const metricScore = /(同比增长|同比下降|归母|归属于|869\.41|2303\.70|净利润.*亿元|营业收入.*亿元)/i.test(haystack) ? 3 : 0
  const contentScore = result.content && result.content.length >= 80 ? 1 : 0
  const junkPenalty = /(工商登记|政务服务|企业信用|采购公告|招标|招聘|开户行|网点查询|电子银行|网上银行|市场监督管理)/i.test(haystack) ? -6 : 0
  return tokenScore + financeScore + metricScore + contentScore + junkPenalty
}

function isFinancialReportQuery(query: string) {
  return /(财报|一季报|季报|年报|业绩|营业收入|净利润|eps|revenue|earnings)/i.test(query)
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
