import type { AppConfig, ExportData, Stock } from '@/types'

/**
 * Data structure for migration API.
 */
export interface MigrationData {
  deviceId: string
  stocks: Stock[]
  config: AppConfig
}

/**
 * Server-side migration function.
 * This should be called from an API route with data fetched from the client.
 */
export async function migrateToSupabase(data: MigrationData): Promise<{
  success: boolean
  message: string
  migratedStocks: number
  migratedTrades: number
}> {
  const { supabase } = await import('./supabase/server')

  try {
    const { deviceId, stocks, config } = data

    // Check if device already has a user record
    const { data: existingUser, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('device_id', deviceId)
      .single()

    if (userError && userError.code !== 'PGRST116') {
      throw new Error(`Failed to check user: ${userError.message}`)
    }

    let userId: string

    if (existingUser) {
      userId = existingUser.id
      // Update last_sync_at
      await supabase
        .from('users')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', userId)
    } else {
      // Create new user
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          device_id: deviceId,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (insertError) {
        throw new Error(`Failed to create user: ${insertError.message}`)
      }

      userId = newUser.id
    }

    // Migrate config
    const { error: configError } = await supabase
      .from('app_config')
      .upsert({
        user_id: userId,
        config: config as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      })

    if (configError) {
      throw new Error(`Failed to migrate config: ${configError.message}`)
    }

    // Migrate stocks
    let migratedStocks = 0
    let migratedTrades = 0

    for (const stock of stocks) {
      // Check if stock already exists
      const { data: existingStock } = await supabase
        .from('stocks')
        .select('id')
        .eq('user_id', userId)
        .eq('code', stock.code)
        .eq('market', stock.market)
        .single()

      let stockId: string

      if (existingStock) {
        stockId = existingStock.id
      } else {
        // Insert stock
        const { data: newStock, error: stockError } = await supabase
          .from('stocks')
          .insert({
            user_id: userId,
            code: stock.code,
            name: stock.name,
            market: stock.market,
            note: stock.note || null,
            created_at: stock.createdAt,
            updated_at: stock.updatedAt,
          })
          .select('id')
          .single()

        if (stockError) {
          throw new Error(`Failed to insert stock ${stock.code}: ${stockError.message}`)
        }

        stockId = newStock.id
        migratedStocks++
      }

      // Migrate trades for this stock
      for (const trade of stock.trades) {
        const { error: tradeError } = await supabase
          .from('trades')
          .insert({
            stock_id: stockId,
            type: trade.type,
            date: trade.date,
            price: trade.price,
            quantity: trade.quantity,
            commission: trade.commission,
            tax: trade.tax,
            total_amount: trade.totalAmount,
            net_amount: trade.netAmount,
            note: trade.note || null,
            created_at: trade.createdAt,
            updated_at: trade.updatedAt,
          })

        if (tradeError) {
          throw new Error(`Failed to insert trade for ${stock.code}: ${tradeError.message}`)
        }

        migratedTrades++
      }
    }

    return {
      success: true,
      message: 'Migration completed successfully',
      migratedStocks,
      migratedTrades,
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      migratedStocks: 0,
      migratedTrades: 0,
    }
  }
}

/**
 * Get data from localStorage (client-side only).
 */
export function getLocalStorageData(): ExportData | null {
  if (typeof window === 'undefined') {
    return null
  }

  const stored = localStorage.getItem('stock-tracker-storage')
  if (!stored) {
    return null
  }

  try {
    const parsed = JSON.parse(stored)
    return {
      meta: {
        version: parsed.config?.version || '1.0.0',
        exportedAt: new Date().toISOString(),
        appName: 'StockTracker',
      },
      config: parsed.config,
      stocks: parsed.stocks || [],
    }
  } catch (error) {
    console.error('Failed to parse localStorage data:', error)
    return null
  }
}

/**
 * Check if migration has been done for a device.
 */
export async function checkMigrationStatus(deviceId: string): Promise<boolean> {
  try {
    const { supabase } = await import('./supabase/server')

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('device_id', deviceId)
      .single()

    return !!user
  } catch {
    return false
  }
}
