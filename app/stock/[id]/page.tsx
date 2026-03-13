'use client'

import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'
import { useStockStore } from '@/store/useStockStore'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

const StockDetail = dynamic(() => import('@/components/StockDetail'), { ssr: false })

export default function StockDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { stocks, sync } = useStockStore()
  const stockId = params.id as string

  const [isLoading, setIsLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const stock = stocks.find((s) => s.id === stockId)

  // 当 stock 不存在时，尝试从服务端重新加载数据
  useEffect(() => {
    if (!stock && !isLoading && !notFound) {
      setIsLoading(true)
      sync().then(() => {
        setIsLoading(false)
        // 重新检查是否找到
        const found = useStockStore.getState().stocks.find((s) => s.id === stockId)
        if (!found) {
          setNotFound(true)
        }
      }).catch(() => {
        setIsLoading(false)
        setNotFound(true)
      })
    }
  }, [stockId, stock, isLoading, notFound])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">正在加载股票数据...</p>
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">未找到该股票 (ID: {stockId.slice(0, 8)}...)</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => { setNotFound(false); setIsLoading(false); }}>
              重试
            </Button>
            <Button onClick={() => router.push('/')}>返回首页</Button>
          </div>
        </div>
      </div>
    )
  }

  if (!stock) {
    return null
  }

  const handleBack = () => {
    router.push('/')
  }

  return <StockDetail stock={stock} onBack={handleBack} />
}
