import { NextRequest, NextResponse } from 'next/server'
import { listAiAgentRuns } from '@/lib/sqlite/db'

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  const sessionId = request.nextUrl.searchParams.get('sessionId')
  const limitRaw = request.nextUrl.searchParams.get('limit')
  const limit = limitRaw ? Number(limitRaw) : undefined

  if (!userId || !sessionId) {
    return NextResponse.json({ error: 'Missing userId or sessionId' }, { status: 400 })
  }

  return NextResponse.json({ runs: listAiAgentRuns(userId, sessionId, limit) })
}
