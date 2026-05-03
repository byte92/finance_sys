'use client'

import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useStockStore } from '@/store/useStockStore'
import { getMarketCodeMinLength, MARKET_CODE_PLACEHOLDERS, MARKET_LABELS, SUPPORTED_MARKETS } from '@/config/defaults'
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

  // 当代码改变时，自动搜索资产名称
  useEffect(() => {
    const searchStock = async () => {
      const trimmedCode = code.trim()
      if (isEdit) {
        setIsValidated(Boolean(trimmedCode && name.trim()))
        return
      }
      if (!trimmedCode || trimmedCode.length < getMarketCodeMinLength(market)) {
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
          setError(data?.error ?? '未找到该资产，请检查代码或市场是否正确，也可以手动填写名称后保存')
        }
      } catch (e) {
        console.error('搜索资产失败:', e)
        setIsValidated(false)
        setError('搜索失败，可手动填写名称后保存')
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
      setError('请填写资产代码')
      return
    }
    if (!name.trim()) {
      setError('请填写资产名称')
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
      console.error(isEdit ? '更新资产失败:' : '添加资产失败:', error)
      setError(isEdit ? '保存失败，请重试' : '添加失败，请重试')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="text-base font-semibold">{isEdit ? '编辑资产' : '添加资产'}</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-secondary transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="market">市场</Label>
            <Select
              id="market"
              value={market}
              onChange={(e) => setMarket(e.target.value as Market)}
              className="h-10 bg-background"
            >
              {SUPPORTED_MARKETS.map((m) => (
                <option key={m} value={m}>{MARKET_LABELS[m]}</option>
              ))}
            </Select>
            {isEdit && (
              <p className="text-[11px] text-muted-foreground">编辑模式下暂不支持直接修改市场，如需变更建议新建后迁移交易。</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="code">代码</Label>
            <div className="relative">
              <Input
                id="code"
                placeholder={MARKET_CODE_PLACEHOLDERS[market]}
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
              placeholder="输入代码后自动搜索，也可手动填写"
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
            <Button type="submit" className="flex-1" disabled={!code.trim() || !name.trim() || isValidating}>
              {isEdit ? '保存' : '添加'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
