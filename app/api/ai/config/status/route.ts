import { NextResponse } from 'next/server'
import { getAiEnvStatus } from '@/lib/ai/config'
import { withApiLogging } from '@/lib/observability/api'

async function handleGET() {
  return NextResponse.json({ env: getAiEnvStatus() })
}

export const GET = withApiLogging('/api/ai/config/status', handleGET)
