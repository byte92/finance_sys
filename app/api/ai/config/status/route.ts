import { NextResponse } from 'next/server'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { getAiEnvStatus } from '@/lib/ai/config'
import { withApiLogging } from '@/lib/observability/api'

async function handleGET() {
  return NextResponse.json({ env: getAiEnvStatus() })
}

export const GET = withApiLogging(NEXT_API_ROUTES.ai.configStatus, handleGET)
