import { NextRequest, NextResponse } from 'next/server'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { withApiLogging } from '@/lib/observability/api'
import { listAiAgentRuns } from '@/lib/sqlite/db'

async function handleGET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const sessionId = request.nextUrl.searchParams.get('sessionId')
  const limitRaw = request.nextUrl.searchParams.get('limit')
  const limit = limitRaw ? Number(limitRaw) : undefined

  if (!userId || !sessionId) {
    return NextResponse.json({ error: 'Missing userId or sessionId' }, { status: 400 })
  }

  return NextResponse.json({ runs: listAiAgentRuns(userId, sessionId, limit) })
}

export const GET = withApiLogging(NEXT_API_ROUTES.ai.chatRuns, handleGET)
