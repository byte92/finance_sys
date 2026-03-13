import { NextRequest, NextResponse } from 'next/server'
import { migrateToSupabase } from '@/lib/migrate-to-supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { deviceId, stocks, config } = body

    if (!deviceId || !stocks || !config) {
      return NextResponse.json(
        { error: 'Missing required fields: deviceId, stocks, config' },
        { status: 400 }
      )
    }

    const result = await migrateToSupabase({ deviceId, stocks, config })

    if (result.success) {
      return NextResponse.json(result)
    } else {
      return NextResponse.json(result, { status: 500 })
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        migratedStocks: 0,
        migratedTrades: 0,
      },
      { status: 500 }
    )
  }
}
