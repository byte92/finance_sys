'use client'

'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

const Dashboard = dynamic(() => import('@/components/Dashboard'), { ssr: false })

export default function Home() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const isSupabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  useEffect(() => {
    if (!isSupabaseConfigured) return
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [loading, user, router, isSupabaseConfigured])

  if (isSupabaseConfigured && !user) {
    return null
  }

  return <Dashboard />
}
