import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQueryVariants, describeWebSearchError } from '@/lib/agent/skills/search'

test('Playwright browser install errors use a local-friendly message', () => {
  assert.equal(
    describeWebSearchError(new Error("Executable doesn't exist at /ms-playwright/chromium/headless_shell")),
    '未找到 Playwright Chromium 浏览器，请先安装 Playwright 浏览器依赖',
  )
  assert.equal(
    describeWebSearchError(new Error('Please run npx playwright install')),
    '未找到 Playwright Chromium 浏览器，请先安装 Playwright 浏览器依赖',
  )
})

test('web search errors preserve actionable failure messages', () => {
  assert.equal(describeWebSearchError(new Error('Navigation timeout exceeded')), 'Navigation timeout exceeded')
  assert.equal(describeWebSearchError('unknown failure'), '搜索请求失败')
})

test('web search builds authoritative variants for Shanghai A-share announcements', () => {
  const variants = buildQueryVariants('成都银行 601838 最新公告 2026 巨潮资讯 上交所 官方公告')

  assert.match(variants[0], /site:cninfo\.com\.cn/)
  assert.match(variants[1], /site:sse\.com\.cn/)
  assert.ok(variants.some((item) => /巨潮资讯/.test(item) && /上交所/.test(item)))
})

test('web search builds authoritative variants for Shenzhen A-share announcements', () => {
  const variants = buildQueryVariants('平安银行 000001 最新公告 2026 巨潮资讯 深交所 官方公告')

  assert.match(variants[0], /site:cninfo\.com\.cn/)
  assert.match(variants[1], /site:szse\.cn/)
  assert.ok(variants.some((item) => /巨潮资讯/.test(item) && /深交所/.test(item)))
})

test('web search keeps generic free-search variants available', () => {
  const variants = buildQueryVariants('Next.js App Router streaming')

  assert.equal(variants[0], 'Next.js App Router streaming')
  assert.ok(!variants.some((item) => /cninfo|sse|szse|巨潮资讯/.test(item)))
})
