import { supabase } from '@/lib/supabase/client'

/**
 * Migrate data from device_id based user to Supabase Auth user.
 * This function should be called from the browser console after logging in with the new account.
 *
 * Usage:
 * 1. Get your device_id from localStorage:
 *    const deviceId = localStorage.getItem('finance-sys-device-id')
 * 2. Call this function:
 *    await migrateToDeviceIdUser(deviceId)
 */
export async function migrateToDeviceIdUser(deviceId: string) {
  console.log('Starting migration from device_id:', deviceId)

  try {
    // 1. Get current auth user
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    if (sessionError) {
      throw new Error(`Failed to get session: ${sessionError.message}`)
    }

    if (!session) {
      throw new Error('Please log in first before running migration')
    }

    const newUser = session.user
    console.log('Logged in as:', newUser.email)

    // 2. Get old user (device_id)
    const { data: oldUser, error: oldUserError } = await supabase
      .from('users')
      .select('id')
      .eq('device_id', deviceId)
      .single()

    if (oldUserError) {
      throw new Error(`Failed to get old user: ${oldUserError.message}`)
    }

    if (!oldUser) {
      throw new Error(`No old user found with device_id: ${deviceId}`)
    }

    console.log('Found old user:', oldUser.id)

    // 3. Check if new user already has data
    const { data: existingStocks, error: checkError } = await supabase
      .from('stocks')
      .select('id')
      .eq('user_id', newUser.id)
      .limit(1)

    if (checkError) {
      throw new Error(`Failed to check existing data: ${checkError.message}`)
    }

    if (existingStocks && existingStocks.length > 0) {
      const confirm = window.confirm(
        'New account already has data. This will overwrite existing data. Continue?'
      )
      if (!confirm) {
        console.log('Migration cancelled by user')
        return
      }

      // Delete existing data for new user
      console.log('Deleting existing data for new user...')
      await supabase.from('stocks').delete().eq('user_id', newUser.id)
      await supabase.from('app_config').delete().eq('user_id', newUser.id)
    }

    // 4. Migrate stocks (update user_id)
    console.log('Migrating stocks...')
    const { data: stocks, error: stocksError } = await supabase
      .from('stocks')
      .select('id')
      .eq('user_id', oldUser.id)

    if (stocksError) {
      throw new Error(`Failed to get stocks: ${stocksError.message}`)
    }

    if (stocks && stocks.length > 0) {
      const stockIds = stocks.map((s) => s.id)

      // Batch update stocks
      const { error: updateError } = await supabase
        .from('stocks')
        .update({
          user_id: newUser.id,
        })
        .in('id', stockIds)

      if (updateError) {
        throw new Error(`Failed to update stocks: ${updateError.message}`)
      }

      console.log(`Migrated ${stockIds.length} stocks`)
    }

    // 5. Migrate app_config
    console.log('Migrating config...')
    const { data: config, error: configError } = await supabase
      .from('app_config')
      .select('*')
      .eq('user_id', oldUser.id)
      .single()

    if (configError && configError.code !== 'PGRST116') {
      // PGRST116 is "not found", which is ok
      throw new Error(`Failed to get config: ${configError.message}`)
    }

    if (config) {
      const { error: configUpdateError } = await supabase
        .from('app_config')
        .upsert({
          user_id: newUser.id,
          config: config.config,
          updated_at: new Date().toISOString(),
        })

      if (configUpdateError) {
        throw new Error(`Failed to upsert config: ${configUpdateError.message}`)
      }

      console.log('Migrated config')
    }

    // 6. Delete old user data (optional, keep for backup)
    console.log('Deleting old user...')
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', oldUser.id)

    if (deleteError) {
      console.warn('Failed to delete old user (data already migrated):', deleteError.message)
    } else {
      console.log('Deleted old user data')
    }

    console.log('✅ Migration completed successfully!')
    console.log('Please refresh the page to see your data.')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  }
}

/**
 * Utility to get device_id from localStorage
 */
export function getDeviceId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  return localStorage.getItem('finance-sys-device-id')
}

/**
 * Export migration function to window for console access
 */
if (typeof window !== 'undefined') {
  (window as any).migrateToDeviceIdUser = migrateToDeviceIdUser
  (window as any).getDeviceId = getDeviceId
}
