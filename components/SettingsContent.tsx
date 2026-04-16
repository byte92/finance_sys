'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Check, Loader2, MonitorCog, Upload, Download, Trash2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useStockStore } from '@/store/useStockStore'
import { useCurrency } from '@/hooks/useCurrency'
import { MARKET_LABELS } from '@/config/defaults'
import type { AiAnalysisLanguage, AiProvider, ExportData, Market } from '@/types'

const MARKETS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']
type FeeField = 'commissionRate' | 'minCommission' | 'stampDutyRate' | 'transferFeeRate' | 'settlementFeeRate'

export default function SettingsContent({
  onSaved,
  onCancel,
  compact = false,
}: {
  onSaved?: () => void
  onCancel?: () => void
  compact?: boolean
}) {
  const { config, updateConfig, exportData, importData, clearAll } = useStockStore()
  const { displayCurrency, setDisplayCurrency } = useCurrency()
  const [defaultMarket, setDefaultMarket] = useState<Market>(config.defaultMarket)
  const [feeConfigs, setFeeConfigs] = useState(config.feeConfigs)
  const [aiConfig, setAiConfig] = useState(config.aiConfig)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [testingModel, setTestingModel] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setDefaultMarket(config.defaultMarket)
    setFeeConfigs(config.feeConfigs)
    setAiConfig(config.aiConfig)
    setError('')
    setSuccessMessage('')
    setTestMessage('')
  }, [config])

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
        aiConfig,
      })
      setSuccessMessage('设置已成功保存到本地 SQLite')
      setTimeout(() => setSuccessMessage(''), 2500)
      onSaved?.()
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
    onSaved?.()
  }

  const handleTestModel = async () => {
    setTestingModel(true)
    setError('')
    setTestMessage('')
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiConfig }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? '模型连通测试失败')
      setTestMessage(`连接成功：${data?.result?.provider ?? aiConfig.provider} / ${data?.result?.model ?? aiConfig.model}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '模型连通测试失败')
    } finally {
      setTestingModel(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <div className="text-sm font-medium text-foreground">基础设置</div>
          <div className="text-xs text-muted-foreground mt-1">默认市场会用于新增股票时的初始选择</div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5 max-w-48">
            <Label htmlFor="default-market">默认市场</Label>
            <Select
              id="default-market"
              value={defaultMarket}
              onChange={(e) => setDefaultMarket(e.target.value as Market)}
            >
              {MARKETS.map((market) => (
                <option key={market} value={market}>
                {MARKET_LABELS[market]}
              </option>
            ))}
          </Select>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <MonitorCog className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-medium text-foreground">显示偏好</div>
            <div className="text-xs text-muted-foreground mt-1">显示货币在这里管理；主题模式已迁回侧边栏底部，方便随时切换。</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5 max-w-48">
            <Label htmlFor="display-currency">显示货币</Label>
            <Select
              id="display-currency"
              value={displayCurrency}
              onChange={(e) => e.target.value && setDisplayCurrency(e.target.value as 'CNY' | 'HKD' | 'USD' | 'USDT')}
            >
              <option value="CNY">CNY</option>
              <option value="HKD">HKD</option>
              <option value="USD">USD</option>
              <option value="USDT">USDT</option>
            </Select>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-medium text-foreground">AI 设置</div>
            <div className="text-xs text-muted-foreground mt-1">本地保存 provider、model 和 token，用于组合与个股 AI 分析</div>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-enabled">启用 AI</Label>
              <Select
                id="ai-enabled"
                value={aiConfig.enabled ? 'true' : 'false'}
                onChange={(e) => setAiConfig((current) => ({ ...current, enabled: e.target.value === 'true' }))}
              >
                <option value="true">启用</option>
                <option value="false">关闭</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select
                id="ai-provider"
                value={aiConfig.provider}
                onChange={(e) => setAiConfig((current) => ({ ...current, provider: e.target.value as AiProvider }))}
              >
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic-compatible">Anthropic Compatible</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-model">模型</Label>
              <div className="flex gap-2">
                <Input
                  id="ai-model"
                  placeholder="gpt-4.1-mini / claude / gemini ..."
                  value={aiConfig.model}
                  onChange={(e) => setAiConfig((current) => ({ ...current, model: e.target.value }))}
                />
                <Button type="button" variant="outline" onClick={handleTestModel} disabled={testingModel}>
                  {testingModel ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                placeholder="https://api.openai.com/v1"
                value={aiConfig.baseUrl}
                onChange={(e) => setAiConfig((current) => ({ ...current, baseUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
              <Label htmlFor="ai-key">API Key</Label>
              <Input
                id="ai-key"
                type="password"
                placeholder="sk-..."
                value={aiConfig.apiKey}
                onChange={(e) => setAiConfig((current) => ({ ...current, apiKey: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-temp">Temperature</Label>
              <Input
                id="ai-temp"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={aiConfig.temperature}
                onChange={(e) => setAiConfig((current) => ({ ...current, temperature: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-max-tokens">Max Tokens</Label>
              <Input
                id="ai-max-tokens"
                type="number"
                min="256"
                step="64"
                value={aiConfig.maxTokens}
                onChange={(e) => setAiConfig((current) => ({ ...current, maxTokens: Number(e.target.value) || 1200 }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-news-enabled">新闻增强</Label>
              <Select
                id="ai-news-enabled"
                value={aiConfig.newsEnabled ? 'true' : 'false'}
                onChange={(e) => setAiConfig((current) => ({ ...current, newsEnabled: e.target.value === 'true' }))}
              >
                <option value="true">开启</option>
                <option value="false">关闭</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-language">分析语言</Label>
              <Select
                id="ai-language"
                value={aiConfig.analysisLanguage}
                onChange={(e) => setAiConfig((current) => ({ ...current, analysisLanguage: e.target.value as AiAnalysisLanguage }))}
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </Select>
            </div>
          </div>

          <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
            API Key 当前按本地模式保存在你的 SQLite 配置中，仅本机使用。开源后请不要把含有真实密钥的备份文件提交到 Git。
          </div>

          {testMessage && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              {testMessage}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <div className="text-sm font-medium text-foreground">手续费配置</div>
          <div className="text-xs text-muted-foreground mt-1">
            自动计算会优先按市场与代码套用规则。例如普通 A 股卖出会收印花税，ETF 默认免印花税；费率字段使用小数形式，例如万一填写 `0.0001`
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

      <div className={`flex ${compact ? 'justify-end border-t border-border pt-5' : 'justify-end'} gap-2`}>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
        )}
        <div className="relative">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存设置'}
          </Button>
          {successMessage && (
            <div className="absolute right-0 top-full mt-2 w-max max-w-xs rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 shadow-lg">
              <Check className="mr-1 inline h-3.5 w-3.5" />
              {successMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
