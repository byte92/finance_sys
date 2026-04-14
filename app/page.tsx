'use client'

'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

const Dashboard = dynamic(() => import('@/components/Dashboard'), { ssr: false })

export default function Home() {
  const router = useRouter()
  const { user, loading, authEnabled } = useAuth()

  useEffect(() => {
    if (!authEnabled) return
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [loading, user, router, authEnabled])

  if (authEnabled && !user) {
    return null
  }

  return <Dashboard />
}
