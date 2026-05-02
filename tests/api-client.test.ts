import assert from 'node:assert/strict'
import test from 'node:test'
import { ClientApiError, describeClientRequestError, readJsonResponse } from '@/lib/api/client'

test('readJsonResponse keeps JSON API error messages', async () => {
  const response = new Response(JSON.stringify({ error: '缺少用户 ID' }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  })

  await assert.rejects(
    readJsonResponse(response, {
      fallbackMessage: '读取失败',
      unavailableMessage: '服务暂时不可用，请稍后重试。',
    }),
    (error) => {
      assert.ok(error instanceof ClientApiError)
      assert.equal(error.status, 400)
      assert.equal(error.message, '缺少用户 ID')
      return true
    },
  )
})

test('readJsonResponse hides HTML error pages from users', async () => {
  const originalError = console.error
  console.error = () => {}

  try {
    const response = new Response('<!DOCTYPE html><html><body>Next error</body></html>', {
      status: 500,
      headers: { 'content-type': 'text/html' },
    })

    await assert.rejects(
      readJsonResponse(response, {
        fallbackMessage: '个股 AI 分析失败',
        unavailableMessage: '服务暂时不可用，请稍后重试或点击强制刷新。',
      }),
      (error) => {
        assert.ok(error instanceof ClientApiError)
        assert.equal(error.status, 500)
        assert.equal(error.message, '服务暂时不可用，请稍后重试或点击强制刷新。')
        return true
      },
    )
  } finally {
    console.error = originalError
  }
})

test('readJsonResponse hides low-level JSON error messages', async () => {
  const response = new Response(
    JSON.stringify({ error: 'Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON' }),
    {
      status: 500,
      headers: { 'content-type': 'application/json' },
    },
  )

  await assert.rejects(
    readJsonResponse(response, {
      fallbackMessage: '个股 AI 分析失败',
      unavailableMessage: '服务暂时不可用，请稍后重试或点击强制刷新。',
    }),
    (error) => {
      assert.ok(error instanceof ClientApiError)
      assert.equal(error.status, 500)
      assert.equal(error.message, '服务暂时不可用，请稍后重试或点击强制刷新。')
      return true
    },
  )
})

test('describeClientRequestError converts fetch failures to friendly copy', () => {
  assert.equal(
    describeClientRequestError(new TypeError('Failed to fetch'), '加载失败'),
    '服务暂时不可用，请检查网络后重试。',
  )
  assert.equal(
    describeClientRequestError(
      new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'),
      '加载失败',
      '服务暂时不可用，请稍后重试。',
    ),
    '服务暂时不可用，请稍后重试。',
  )
})
