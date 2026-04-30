import test from 'node:test'
import assert from 'node:assert/strict'
import { AI_CHAT_TITLE_MAX_LENGTH, buildChatTitle, normalizeChatTitle } from '@/lib/ai/chat'

test('buildChatTitle limits generated chat title length', () => {
  const title = buildChatTitle('这是一个非常长的 AI 对话问题标题，用来验证自动生成标题不会太长')

  assert.equal(title.length, AI_CHAT_TITLE_MAX_LENGTH)
  assert.ok(title.endsWith('…'))
})

test('normalizeChatTitle limits manual chat title length', () => {
  const title = normalizeChatTitle('  这是一个非常长的手动输入对话名称，用来验证失焦保存时会自动截断  ')

  assert.equal(title.length, AI_CHAT_TITLE_MAX_LENGTH)
  assert.equal(normalizeChatTitle('   '), '新对话')
})
