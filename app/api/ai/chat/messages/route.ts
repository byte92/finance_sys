import { NextRequest, NextResponse } from 'next/server'
import { safeReadJsonBody } from '@/lib/api/request'
import { clearAiChatMessages, listAiChatMessages } from '@/lib/sqlite/db'

type DeleteBody = {
  userId?: string
  sessionId?: string
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const sessionId = request.nextUrl.searchParams.get('sessionId')
  if (!userId || !sessionId) {
    return NextResponse.json({ error: 'Missing userId or sessionId' }, { status: 400 })
  }

  return NextResponse.json({ messages: listAiChatMessages(userId, sessionId) })
}

export async function DELETE(request: Request) {
  try {
    const payload = await safeReadJsonBody<DeleteBody>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.userId || !body.sessionId) {
      return NextResponse.json({ error: '缺少用户 ID 或会话 ID' }, { status: 400 })
    }

    clearAiChatMessages(body.userId, body.sessionId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '清空 AI 对话失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
