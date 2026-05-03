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

test('web search uses model supplied source hints without financial query rewriting', () => {
  const variants = buildQueryVariants({
    query: '成都银行 601838 最新公告',
    sourceHints: ['cninfo.com.cn', 'sse.com.cn'],
  })

  assert.equal(variants[0], '成都银行 601838 最新公告 cninfo.com.cn sse.com.cn')
  assert.equal(variants[1], '成都银行 601838 最新公告')
  assert.ok(!variants.some((item) => /site:/.test(item)))
})

test('web search keeps model supplied alternate queries', () => {
  const variants = buildQueryVariants({
    query: '平安银行 000001 最新公告',
    queries: ['平安银行 定期报告 000001', '000001 official announcement'],
  })

  assert.deepEqual(variants, [
    '平安银行 000001 最新公告',
    '平安银行 定期报告 000001',
    '000001 official announcement',
  ])
})

test('web search keeps generic free-search variants available', () => {
  const variants = buildQueryVariants('Next.js App Router streaming')

  assert.equal(variants[0], 'Next.js App Router streaming')
  assert.ok(!variants.some((item) => /cninfo|sse|szse|巨潮资讯/.test(item)))
})
