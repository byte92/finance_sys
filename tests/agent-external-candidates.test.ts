import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveExternalCandidates } from '@/lib/agent/entity/externalCandidates'

test('external candidate resolver reads Tencent smartbox stock names', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('v_hint="sz~000568~\\u6cf8\\u5dde\\u8001\\u7a96~lzlj~GP-A"')

  try {
    const candidates = await resolveExternalCandidates('泸州老窖')

    assert.deepEqual(candidates, [{
      code: '000568',
      name: '泸州老窖',
      market: 'A',
      confidence: 0.86,
      source: 'tencent.smartbox',
    }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external candidate resolver cleans natural-language stock questions', async () => {
  const originalFetch = globalThis.fetch
  const queries: string[] = []
  globalThis.fetch = async (input) => {
    queries.push(String(input))
    if (String(input).includes(encodeURIComponent('高德红外'))) {
      return new Response('v_hint="sz~002414~\\u9ad8\\u5fb7\\u7ea2\\u5916~gdhw~GP-A"')
    }
    return new Response('v_hint="N";')
  }

  try {
    const candidates = await resolveExternalCandidates('高德红外最近表现怎么样')

    assert.ok(queries.some((item) => item.includes(encodeURIComponent('高德红外'))))
    assert.deepEqual(candidates[0], {
      code: '002414',
      name: '高德红外',
      market: 'A',
      confidence: 0.86,
      source: 'tencent.smartbox',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external candidate resolver handles broad ETF names through smartbox', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes(encodeURIComponent('科创50'))) {
      return new Response('v_hint="sh~588000~\\u79d1\\u521b50ETF\\u534e\\u590f~kc50etfhx~ETF^sh~588080~\\u79d1\\u521b50ETF\\u6613\\u65b9\\u8fbe~kc50etfyfd~ETF"')
    }
    return new Response('v_hint="N";')
  }

  try {
    const candidates = await resolveExternalCandidates('a股的科创50 你觉得还有上涨空间吗 我想买etf')

    assert.deepEqual(candidates.map((candidate) => candidate.code), ['588000', '588080'])
    assert.deepEqual(candidates.map((candidate) => candidate.source), ['tencent.smartbox', 'tencent.smartbox'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('external candidate resolver falls back to code inference without name aliases', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('v_hint="N";')

  try {
    const candidates = await resolveExternalCandidates('588000 还有上涨空间吗')

    assert.deepEqual(candidates, [{
      code: '588000',
      name: '588000',
      market: 'A',
      confidence: 0.72,
      source: 'code.inference',
    }])
  } finally {
    globalThis.fetch = originalFetch
  }
})
