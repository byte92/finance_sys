'use client'

import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'
import { useStockStore } from '@/store/useStockStore'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

const StockDetail = dynamic(() => import('@/components/StockDetail'), { ssr: false })

export default function StockDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { stocks, init } = useStockStore()
  const stockId = params.id as string

  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const stock = stocks.find((s) => s.id === stockId)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      setNotFound(false)
      try {
        await init()
        if (cancelled) return
        const found = useStockStore.getState().stocks.find((s) => s.id === stockId)
        setNotFound(!found)
      } catch {
        if (!cancelled) {
          setNotFound(true)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [init, stockId])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">正在加载资产数据...</p>
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">未找到该资产 (ID: {stockId.slice(0, 8)}...)</p>
          <div className="flex gap-2 justify-center">
            <Button
              variant="outline"
              onClick={async () => {
                setIsLoading(true)
                setNotFound(false)
                try {
                  await init()
                  const found = useStockStore.getState().stocks.find((s) => s.id === stockId)
                  setNotFound(!found)
                } catch {
                  setNotFound(true)
                } finally {
                  setIsLoading(false)
                }
              }}
            >
              重试
            </Button>
            <Button onClick={() => router.push('/portfolio')}>返回持仓</Button>
          </div>
        </div>
      </div>
    )
  }

  if (!stock) {
    return null
  }

  return <StockDetail stock={stock} onBack={() => router.push('/portfolio')} />
}
