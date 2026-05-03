import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveClarificationSelection, type AgentClarificationState } from '@/lib/agent/clarification'
import type { AiConfig } from '@/types'

const mockAiConfig: AiConfig = {
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:8080/v1',
  model: 'test-model',
  apiKey: 'test-key',
  temperature: 0,
  maxContextTokens: 128000,
  newsEnabled: false,
  analysisLanguage: 'zh-CN',
}

const pending: AgentClarificationState = {
  type: 'clarify',
  originalUserMessage: '帮我看看银行',
  question: '你想分析的是成都银行还是平安银行？',
  candidates: [
    { symbol: '601838', code: '601838', name: '成都银行', market: 'A', stockId: 'stock-1', inPortfolio: true },
    { symbol: '000001', code: '000001', name: '平安银行', market: 'A', stockId: 'stock-2', inPortfolio: true },
  ],
}

test('clarification resolver uses LLM selection when a reply points to one candidate', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              status: 'selected',
              code: '601838',
              market: 'A',
              confidence: 0.93,
              reason: '用户说的是成都银行',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const result = await resolveClarificationSelection({
      userMessage: '成都银行',
      pending,
      aiConfig: mockAiConfig,
    })

    assert.equal(result.status, 'selected')
    assert.equal(result.status === 'selected' ? result.candidate.code : '', '601838')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('clarification resolver asks in-chat when LLM cannot select a unique candidate', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              status: 'unclear',
              confidence: 0.4,
              clarifyQuestion: '你想看成都银行还是平安银行？',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const result = await resolveClarificationSelection({
      userMessage: 'A股那个',
      pending,
      aiConfig: mockAiConfig,
    })

    assert.equal(result.status, 'ask')
    assert.match(result.status === 'ask' ? result.question : '', /成都银行/)
    assert.match(result.status === 'ask' ? result.question : '', /平安银行/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('clarification resolver lets a new question continue the normal dialogue', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              status: 'new_question',
              confidence: 0.88,
              reason: '用户换成了组合问题',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const result = await resolveClarificationSelection({
      userMessage: '先不看这个，帮我看组合风险',
      pending,
      aiConfig: mockAiConfig,
    })

    assert.equal(result.status, 'new_question')
  } finally {
    globalThis.fetch = originalFetch
  }
})
