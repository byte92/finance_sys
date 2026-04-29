import type { AgentSkill } from '@/lib/agent/types'

export type WebSearchInput = {
  query: string
  limit?: number
}

export type WebSearchItem = {
  title: string
  snippet: string
  url: string
}

export type WebSearchResult = {
  query: string
  results: WebSearchItem[]
  searchedAt: string
}

export const webSearchSkill: AgentSkill<WebSearchInput, WebSearchResult> = {
  name: 'web.search',
  description: '通过 Google 搜索引擎查找最新财报、公告、新闻等公开信息',
  inputSchema: { query: 'string', limit: 'number?' },
  requiredScopes: ['network.fetch'],
  async execute(args) {
    const query = String(args.query ?? '').trim()
    if (!query) return { skillName: 'web.search', ok: false, error: '缺少搜索关键词' }

    const limit = Math.max(1, Math.min(Number(args.limit ?? 5), 10))

    let browser: import('playwright').Browser | null = null
    try {
      // 动态导入避免 SSR 时加载原生模块
      const path = await import('node:path')
      const fs = await import('node:fs')
      const os = await import('node:os')

      const { chromium } = await import('playwright')

      // 查找已安装的 headless shell 二进制文件（处理版本不匹配）
      const cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH
        || path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')

      const findExecutable = (): string | undefined => {
        if (!fs.existsSync(cacheDir)) return undefined
        const dirs = fs.readdirSync(cacheDir).filter((d) => d.startsWith('chromium_headless_shell-'))
        for (const dir of dirs.sort().reverse()) {
          const exe = path.join(cacheDir, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
          if (fs.existsSync(exe)) return exe
        }
        return undefined
      }

      const execPath = findExecutable()
      if (!execPath) {
        return { skillName: 'web.search', ok: false, error: '未找到 Playwright 浏览器，请运行: npx playwright install chromium' }
      }

      browser = await chromium.launch({ executablePath: execPath, headless: true })
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
      })
      const page = await context.newPage()

      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-CN&num=${limit}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      })

      // 等待搜索结果加载
      await page.waitForSelector('#search', { timeout: 10_000 }).catch(() => {
        // Google 可能返回其他页面结构，继续执行
      })

      const results = await page.evaluate(() => {
        const items: Array<{ title: string; snippet: string; url: string }> = []
        const nodes = document.querySelectorAll('#search .g, #search .MjjYud')
        Array.from(nodes).forEach((node) => {
          if (items.length >= 10) return
          const titleEl = node.querySelector('h3')
          const snippetEl = node.querySelector('.VwiC3b, .lEBKkf, div[data-sncf], span.st')
          const linkEl = node.querySelector('a[href^="http"]')
          if (titleEl && linkEl) {
            items.push({
              title: titleEl.textContent?.trim() ?? '',
              snippet: snippetEl?.textContent?.trim() ?? '',
              url: linkEl.getAttribute('href') ?? '',
            })
          }
        })
        return items
      })

      await context.close()

      return {
        skillName: 'web.search',
        ok: true,
        data: {
          query,
          results: results.slice(0, limit),
          searchedAt: new Date().toISOString(),
        },
      }
    } catch (error) {
      if (browser) await browser.close().catch(() => {})
      return {
        skillName: 'web.search',
        ok: false,
        error: error instanceof Error ? error.message : '搜索请求失败',
      }
    }
  },
}
