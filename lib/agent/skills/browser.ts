import type { AgentSkill } from '@/lib/agent/types'

export type WebBrowseInput = {
  url: string
  extractPrompt?: string
}

export type WebBrowseResult = {
  url: string
  finalUrl: string
  title: string
  status?: number
  content: string
  summary?: string
  capturedAt: string
}

type PlaywrightBrowser = import('playwright').Browser
type PlaywrightBrowserContext = import('playwright').BrowserContext

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1']
const REQUEST_TIMEOUT_MS = 20_000
const MAX_CONTENT_SIZE = 12_000

function isPrivateHostname(hostname: string) {
  return BLOCKED_HOSTS.some((host) => hostname === host || hostname.startsWith(host))
    || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/.test(hostname)
    || /^169\.254\./.test(hostname)
}

function validatePublicUrl(raw: string): URL {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`不支持的协议：${url.protocol}`)
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error(`禁止访问内网地址：${url.hostname}`)
  }
  return url
}

function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function describeBrowserError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  if (normalized.includes("executable doesn't exist") || normalized.includes('playwright install')) {
    return 'Playwright 浏览器未安装，请先运行 `pnpm exec playwright install chromium` 后重试。'
  }
  if (normalized.includes('timeout')) {
    return '浏览器访问页面超时，可能是页面加载过慢、需要验证或网络不可达。'
  }
  return message || '浏览器访问失败'
}

export const webBrowseSkill: AgentSkill<WebBrowseInput, WebBrowseResult> = {
  name: 'web.browse',
  description: '使用独立 Playwright 浏览器打开用户给定的公开网页，并抽取页面标题和正文。',
  inputSchema: { url: 'string', extractPrompt: 'string?' },
  requiredScopes: ['network.fetch'],
  async execute(args) {
    const rawUrl = String(args.url ?? '').trim()
    if (!rawUrl) return { skillName: 'web.browse', ok: false, error: '缺少 URL' }

    let browser: PlaywrightBrowser | null = null
    let context: PlaywrightBrowserContext | null = null

    try {
      const url = validatePublicUrl(rawUrl)
      const { chromium } = await import('playwright')

      browser = await chromium.launch({ headless: true })
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1365, height: 900 },
        locale: 'zh-CN',
      })

      const page = await context.newPage()
      const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS })
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})

      const extracted = await page.evaluate(() => {
        const selectorsToRemove = [
          'script',
          'style',
          'noscript',
          'svg',
          'canvas',
          'iframe',
          'nav',
          'footer',
          'aside',
          '[class*="advert"]',
          '[class*="banner"]',
          '[class*="comment"]',
        ]
        for (const selector of selectorsToRemove) {
          for (const node of Array.from(document.querySelectorAll(selector))) {
            node.remove()
          }
        }

        const title = document.querySelector('h1')?.textContent?.trim()
          || document.querySelector<HTMLMetaElement>('meta[property="og:title"], meta[name="title"]')?.content?.trim()
          || document.title.trim()
        const description = document.querySelector<HTMLMetaElement>('meta[name="description"], meta[property="og:description"]')?.content?.trim() ?? ''
        const root = document.querySelector('article, main, [role="main"], .article, .content, .main') ?? document.body
        const blocks = Array.from(root.querySelectorAll('h1, h2, h3, p, li, blockquote'))
          .map((node) => node.textContent?.trim() ?? '')
          .filter((text) => text.length >= 12)
        const bodyText = blocks.length ? blocks.join('\n') : (root.textContent ?? '')

        return {
          title,
          description,
          content: [description, bodyText].filter(Boolean).join('\n'),
        }
      })
      const finalUrl = page.url()
      await page.close().catch(() => {})

      const content = normalizeWhitespace(extracted.content).slice(0, MAX_CONTENT_SIZE)
      const title = normalizeWhitespace(extracted.title)
      const result: WebBrowseResult = {
        url: rawUrl,
        finalUrl,
        title,
        status: response?.status(),
        content,
        capturedAt: new Date().toISOString(),
      }

      if (args.extractPrompt && content) {
        result.summary = `按照以下要求从浏览器页面正文中提取信息：${args.extractPrompt}\n\n页面标题：${title}\n页面正文：${content.slice(0, 5000)}`
      }

      return { skillName: 'web.browse', ok: true, data: result }
    } catch (error) {
      return { skillName: 'web.browse', ok: false, error: describeBrowserError(error) }
    } finally {
      await context?.close().catch(() => {})
      await browser?.close().catch(() => {})
    }
  },
}
