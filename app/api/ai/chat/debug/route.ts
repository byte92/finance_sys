import { NextRequest, NextResponse } from 'next/server'
import { getAiAgentRun, getAiChatMessage, getAiChatSession, listAiAgentRuns, listAiChatMessages } from '@/lib/sqlite/db'
import type { AiAgentRun, AiChatMessage } from '@/types'

function findRelatedRuns(target: AiChatMessage | null, messages: AiChatMessage[], runs: AiAgentRun[]) {
  if (!target) return []

  const exact = runs.filter((run) => run.messageId === target.id)
  if (exact.length) return exact

  if (target.role === 'assistant') {
    const targetIndex = messages.findIndex((message) => message.id === target.id)
    const previousUser = [...messages.slice(0, targetIndex)].reverse().find((message) => message.role === 'user')
    if (previousUser) return runs.filter((run) => run.messageId === previousUser.id)
  }

  return []
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const id = request.nextUrl.searchParams.get('id')?.trim()

  if (!userId || !id) {
    return NextResponse.json({ error: 'Missing userId or id' }, { status: 400 })
  }

  const session = getAiChatSession(userId, id)
  if (session) {
    const messages = listAiChatMessages(userId, session.id)
    const runs = listAiAgentRuns(userId, session.id)
    return NextResponse.json({
      matchType: 'session',
      session,
      messages,
      runs,
      selectedMessage: null,
      selectedRun: null,
      relatedRuns: runs,
    })
  }

  const message = getAiChatMessage(userId, id)
  if (message) {
    const messageSession = getAiChatSession(userId, message.sessionId)
    const messages = listAiChatMessages(userId, message.sessionId)
    const runs = listAiAgentRuns(userId, message.sessionId)
    return NextResponse.json({
      matchType: 'message',
      session: messageSession,
      messages,
      runs,
      selectedMessage: message,
      selectedRun: null,
      relatedRuns: findRelatedRuns(message, messages, runs),
    })
  }

  const run = getAiAgentRun(userId, id)
  if (run) {
    const runSession = getAiChatSession(userId, run.sessionId)
    const messages = listAiChatMessages(userId, run.sessionId)
    const runs = listAiAgentRuns(userId, run.sessionId)
    const selectedMessage = run.messageId ? messages.find((message) => message.id === run.messageId) ?? null : null
    return NextResponse.json({
      matchType: 'run',
      session: runSession,
      messages,
      runs,
      selectedMessage,
      selectedRun: run,
      relatedRuns: [run],
    })
  }

  return NextResponse.json({ error: '未找到对应的对话、消息或调用链路' }, { status: 404 })
}
