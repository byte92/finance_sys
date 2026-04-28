import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { safeReadJsonBody } from '@/lib/api/request'
import { clearAiChatByUserId, deleteAiChatSession, listAiChatSessions, saveAiChatSession } from '@/lib/sqlite/db'

type CreateBody = {
  userId?: string
  title?: string
}

type DeleteBody = {
  userId?: string
  sessionId?: string
  all?: boolean
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  return NextResponse.json({ sessions: listAiChatSessions(userId) })
}

export async function POST(request: Request) {
  try {
    const payload = await safeReadJsonBody<CreateBody>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.userId) {
      return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
    }

    const id = randomUUID()
    saveAiChatSession({
      id,
      userId: body.userId,
      title: body.title?.trim() || '新对话',
      scope: 'portfolio',
    })

    return NextResponse.json({ session: listAiChatSessions(body.userId).find((session) => session.id === id) })
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建 AI 对话失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = await safeReadJsonBody<DeleteBody>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.userId) {
      return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
    }

    if (body.all) {
      clearAiChatByUserId(body.userId)
      return NextResponse.json({ ok: true })
    }

    if (!body.sessionId) {
      return NextResponse.json({ error: '缺少会话 ID' }, { status: 400 })
    }

    const deleted = deleteAiChatSession(body.userId, body.sessionId)
    if (!deleted) {
      return NextResponse.json({ error: '未找到对应的 AI 对话' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除 AI 对话失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
