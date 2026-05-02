import test from 'node:test'
import assert from 'node:assert/strict'
import { describeWebSearchError } from '@/lib/agent/skills/search'

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
