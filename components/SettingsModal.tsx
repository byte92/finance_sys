'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { X, Upload, Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useStockStore } from '@/store/useStockStore'
import { MARKET_LABELS } from '@/config/defaults'
import type { ExportData, Market } from '@/types'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const MARKETS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']
type FeeField = 'commissionRate' | 'minCommission' | 'stampDutyRate' | 'transferFeeRate' | 'settlementFeeRate'

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { config, updateConfig, exportData, importData, clearAll } = useStockStore()
  const [defaultMarket, setDefaultMarket] = useState<Market>(config.defaultMarket)
  const [feeConfigs, setFeeConfigs] = useState(config.feeConfigs)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setDefaultMarket(config.defaultMarket)
    setFeeConfigs(config.feeConfigs)
    setError('')
  }, [open, config])

  if (!open) return null

  const updateFeeField = (market: Market, field: FeeField, value: string) => {
    const numericValue = Number(value)
    setFeeConfigs((current) => ({
      ...current,
      [market]: {
        ...current[market],
        [field]: Number.isFinite(numericValue) ? numericValue : 0,
      },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await updateConfig({
        defaultMarket,
        feeConfigs,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存配置失败')
    } finally {
      setSaving(false)
    }
  }

  const handleExport = () => {
    const data = exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    link.href = url
    link.download = `stock-tracker-backup-${stamp}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text) as Partial<ExportData>
      if (!Array.isArray(data.stocks) || !data.config) {
        throw new Error('备份文件格式不正确')
      }
      importData(data as ExportData)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败，请检查文件内容')
    } finally {
      event.target.value = ''
    }
  }

  const handleClearAll = () => {
    if (!window.confirm('确定清空所有持仓、交易和配置吗？该操作不可恢复。')) {
      return
    }
    clearAll()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-4xl rounded-xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">设置与数据管理</h2>
            <p className="text-xs text-muted-foreground mt-0.5">调整默认市场、手续费规则，并管理本地备份</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-secondary transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <section className="space-y-3">
            <div>
              <div className="text-sm font-medium text-foreground">基础设置</div>
              <div className="text-xs text-muted-foreground mt-1">默认市场会用于新增股票时的初始选择</div>
            </div>

            <div className="space-y-1.5 max-w-48">
              <Label htmlFor="default-market">默认市场</Label>
              <select
                id="default-market"
                value={defaultMarket}
                onChange={(e) => setDefaultMarket(e.target.value as Market)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {MARKETS.map((market) => (
                  <option key={market} value={market}>
                    {MARKET_LABELS[market]}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <div className="text-sm font-medium text-foreground">手续费配置</div>
              <div className="text-xs text-muted-foreground mt-1">
                自动计算会优先按市场与代码套用规则。
                例如普通 A 股卖出会收印花税，ETF 默认免印花税；费率字段使用小数形式，例如万一填写 `0.0001`
              </div>
            </div>

            <div className="space-y-4">
              {MARKETS.map((market) => {
                const fee = feeConfigs[market]
                return (
                  <div key={market} className="rounded-lg border border-border p-4 space-y-3">
                    <div className="text-sm font-medium text-foreground">{MARKET_LABELS[market]}</div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="space-y-1.5">
                        <Label>佣金率</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          min="0"
                          value={fee.commissionRate}
                          onChange={(e) => updateFeeField(market, 'commissionRate', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>最低佣金</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={fee.minCommission}
                          onChange={(e) => updateFeeField(market, 'minCommission', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>印花税率</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          min="0"
                          value={fee.stampDutyRate}
                          onChange={(e) => updateFeeField(market, 'stampDutyRate', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>过户费率</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          min="0"
                          value={fee.transferFeeRate}
                          onChange={(e) => updateFeeField(market, 'transferFeeRate', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>结算费率</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          min="0"
                          value={fee.settlementFeeRate ?? 0}
                          onChange={(e) => updateFeeField(market, 'settlementFeeRate', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <div className="text-sm font-medium text-foreground">数据管理</div>
              <div className="text-xs text-muted-foreground mt-1">支持本地 JSON 备份、导入恢复和一键清空</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleExport}>
                <Download className="h-4 w-4 mr-1" />
                导出备份
              </Button>
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" />
                导入备份
              </Button>
              <Button type="button" variant="outline" className="text-destructive" onClick={handleClearAll}>
                <Trash2 className="h-4 w-4 mr-1" />
                清空数据
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
          </section>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-5">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存设置'}
          </Button>
        </div>
      </div>
    </div>
  )
}
