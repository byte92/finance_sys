'use client'

import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useStockStore } from '@/store/useStockStore'
import { MARKET_LABELS } from '@/config/defaults'
import type { Market } from '@/types'
import type { StockQuote } from '@/types/stockApi'

interface AddStockModalProps {
  onClose: () => void
  onAdded?: (stockId: string) => void
  editStock?: {
    id: string
    code: string
    name: string
    market: Market
    note?: string
  }
}

const MARKETS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']

export default function AddStockModal({ onClose, onAdded, editStock }: AddStockModalProps) {
  const { addStock, updateStock, config } = useStockStore()
  const isEdit = !!editStock
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [market, setMarket] = useState<Market>(config.defaultMarket)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [isValidated, setIsValidated] = useState(false)

  useEffect(() => {
    if (editStock) {
      setCode(editStock.code)
      setName(editStock.name)
      setMarket(editStock.market)
      setNote(editStock.note || '')
      setIsValidated(true)
      return
    }
    setMarket(config.defaultMarket)
  }, [config.defaultMarket, editStock])

  // 当代码改变时，自动搜索股票名称
  useEffect(() => {
    const searchStock = async () => {
      const trimmedCode = code.trim()
      if (isEdit) {
        setIsValidated(Boolean(trimmedCode && name.trim()))
        return
      }
      if (!trimmedCode || trimmedCode.length < 4) {
        setIsValidated(false)
        return
      }

      setIsValidating(true)
      setError('')

      try {
        const res = await fetch(
          `/api/stock/quote?symbol=${encodeURIComponent(trimmedCode)}&market=${encodeURIComponent(market)}`,
          { cache: 'no-store' }
        )
        const data = await res.json()
        const quote = (data?.quote ?? null) as StockQuote | null
        if (quote && quote.name) {
          setName(quote.name)
          setIsValidated(true)
          setError('')
        } else {
          setIsValidated(false)
          setError(data?.error ?? '未找到该股票，请检查代码或市场是否正确')
        }
      } catch (e) {
        console.error('搜索股票失败:', e)
        setIsValidated(false)
        setError('搜索失败，请检查网络连接')
      } finally {
        setIsValidating(false)
      }
    }

    const timer = setTimeout(searchStock, 500)
    return () => clearTimeout(timer)
  }, [code, market, isEdit, name])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      setError('请填写股票代码')
      return
    }
    if (!name.trim()) {
      setError('请填写股票名称')
      return
    }
    try {
      if (isEdit && editStock) {
        await updateStock(editStock.id, {
          code: trimmedCode.toUpperCase(),
          name: name.trim(),
          note: note.trim(),
        })
      } else {
        const stock = await addStock({ code: trimmedCode.toUpperCase(), name: name.trim(), market, note: note.trim() })
        onAdded?.(stock.id)
      }
      onClose()
    } catch (error) {
      console.error(isEdit ? '更新股票失败:' : '添加股票失败:', error)
      setError(isEdit ? '保存失败，请重试' : '添加失败，请重试')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="text-base font-semibold">{isEdit ? '编辑股票/资产' : '添加股票/资产'}</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-secondary transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="market">市场</Label>
            <select
              id="market"
              value={market}
              onChange={(e) => setMarket(e.target.value as Market)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {MARKETS.map((m) => (
                <option key={m} value={m}>{MARKET_LABELS[m]}</option>
              ))}
            </select>
            {isEdit && (
              <p className="text-[11px] text-muted-foreground">编辑模式下暂不支持直接修改市场，如需变更建议新建后迁移交易。</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="code">代码</Label>
            <div className="relative">
              <Input
                id="code"
                placeholder={market === 'A' ? '如：000001 或 510300' : market === 'HK' ? '如：00700' : '如：AAPL'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                className="pr-10"
              />
              {isValidating && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">名称 {isValidated && <span className="text-xs text-green-600 ml-2">✓ 已验证</span>}</Label>
            <Input
              id="name"
              placeholder="输入代码后自动搜索..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">备注（可选）</Label>
            <Input
              id="note"
              placeholder="记录这只资产的计划或说明"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">取消</Button>
            <Button type="submit" className="flex-1" disabled={!isValidated || isValidating}>
              {isEdit ? '保存' : '添加'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
