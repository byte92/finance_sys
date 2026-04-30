import { NextResponse } from 'next/server'
import { getAiEnvStatus } from '@/lib/ai/config'

export async function GET() {
  return NextResponse.json({ env: getAiEnvStatus() })
}
