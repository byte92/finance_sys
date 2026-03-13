import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

// Database types
export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          device_id: string
          created_at: string
          last_sync_at: string | null
        }
        Insert: {
          id?: string
          device_id: string
          created_at?: string
          last_sync_at?: string | null
        }
        Update: {
          id?: string
          device_id?: string
          created_at?: string
          last_sync_at?: string | null
        }
      }
      stocks: {
        Row: {
          id: string
          user_id: string
          code: string
          name: string
          market: 'A' | 'HK' | 'US' | 'FUND' | 'CRYPTO'
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          code: string
          name: string
          market: 'A' | 'HK' | 'US' | 'FUND' | 'CRYPTO'
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          code?: string
          name?: string
          market?: 'A' | 'HK' | 'US' | 'FUND' | 'CRYPTO'
          note?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      trades: {
        Row: {
          id: string
          stock_id: string
          type: 'BUY' | 'SELL' | 'DIVIDEND'
          date: string
          price: number
          quantity: number
          commission: number
          tax: number
          total_amount: number
          net_amount: number
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          stock_id: string
          type: 'BUY' | 'SELL' | 'DIVIDEND'
          date: string
          price: number
          quantity: number
          commission: number
          tax: number
          total_amount: number
          net_amount: number
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          stock_id?: string
          type?: 'BUY' | 'SELL' | 'DIVIDEND'
          date?: string
          price?: number
          quantity?: number
          commission?: number
          tax?: number
          total_amount?: number
          net_amount?: number
          note?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      app_config: {
        Row: {
          user_id: string
          config: Record<string, unknown>
          updated_at: string
        }
        Insert: {
          user_id: string
          config: Record<string, unknown>
          updated_at?: string
        }
        Update: {
          user_id?: string
          config?: Record<string, unknown>
          updated_at?: string
        }
      }
    }
  }
}
