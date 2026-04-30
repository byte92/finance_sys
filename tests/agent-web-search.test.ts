import test from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultPlaywrightBrowsersPath, getPlaywrightBrowsersPath } from '@/lib/agent/skills/search'

const slashPath = {
  join: (...parts: string[]) => parts.join('/'),
}

function osStub(platform: NodeJS.Platform, home: string) {
  return {
    homedir: () => home,
    platform: () => platform,
  }
}

test('Playwright browser cache defaults to the operating system cache directory', () => {
  assert.equal(
    getDefaultPlaywrightBrowsersPath(osStub('darwin', '/Users/me'), slashPath, {}),
    '/Users/me/Library/Caches/ms-playwright',
  )
  assert.equal(
    getDefaultPlaywrightBrowsersPath(osStub('linux', '/home/me'), slashPath, {}),
    '/home/me/.cache/ms-playwright',
  )
  assert.equal(
    getDefaultPlaywrightBrowsersPath(osStub('win32', 'C:/Users/me'), slashPath, {}),
    'C:/Users/me/AppData/Local/ms-playwright',
  )
})

test('Playwright browser cache respects explicit environment overrides', () => {
  assert.equal(
    getDefaultPlaywrightBrowsersPath(osStub('linux', '/home/me'), slashPath, { XDG_CACHE_HOME: '/var/cache/me' }),
    '/var/cache/me/ms-playwright',
  )
  assert.equal(
    getDefaultPlaywrightBrowsersPath(osStub('win32', 'C:/Users/me'), slashPath, { LOCALAPPDATA: 'D:/Cache' }),
    'D:/Cache/ms-playwright',
  )
  assert.equal(
    getPlaywrightBrowsersPath(osStub('linux', '/home/me'), slashPath, { PLAYWRIGHT_BROWSERS_PATH: '/custom/pw' }),
    '/custom/pw',
  )
})
