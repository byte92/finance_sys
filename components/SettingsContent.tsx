'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Upload, Download, Trash2, Sparkles, SlidersHorizontal, Settings2, FilePenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import { useCurrency } from '@/hooks/useCurrency'
import { MARKET_LABELS } from '@/config/defaults'
import type { AiAnalysisLanguage, AiAnalysisStrength, AiPromptTemplates, AiProvider, ExportData, Market } from '@/types'

const MARKETS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']
type FeeField = 'commissionRate' | 'minCommission' | 'stampDutyRate' | 'transferFeeRate' | 'settlementFeeRate'
type PromptField = keyof AiPromptTemplates
type SectionId = 'basic' | 'ai' | 'preferences' | 'prompts'

const PROMPT_FIELD_META: Array<{ key: PromptField; label: string; hint: string }> = [
  { key: 'baseSystem', label: '基础系统提示词', hint: '定义 AI 的角色、边界、客观性要求与输出纪律。' },
  { key: 'portfolioAnalysis', label: '组合分析提示词', hint: '控制组合分析如何聚焦仓位结构、风险暴露和组合建议。' },
  { key: 'stockAnalysis', label: '个股分析提示词', hint: '控制个股分析如何结合成本、技术指标和新闻输出判断。' },
  { key: 'marketAnalysis', label: '大盘分析提示词', hint: '控制 A 股、港股、美股整体节奏和风险偏好分析。' },
  { key: 'highStrength', label: '高强度策略提示词', hint: '更直接给出明确倾向和操作取向。' },
  { key: 'mediumStrength', label: '中等强度策略提示词', hint: '给出方向和观察点，但不过度激进。' },
  { key: 'weakStrength', label: '弱强度策略提示词', hint: '偏事实整理和参考信息，降低动作指令感。' },
]

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
  const [draftDisplayCurrency, setDraftDisplayCurrency] = useState(displayCurrency)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [testingModel, setTestingModel] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    basic: true,
    ai: true,
    preferences: false,
    prompts: false,
  })

  useEffect(() => {
    setDefaultMarket(config.defaultMarket)
    setFeeConfigs(config.feeConfigs)
    setAiConfig(config.aiConfig)
    setDraftDisplayCurrency(displayCurrency)
    setError('')
    setSuccessMessage('')
    setTestMessage('')
  }, [config, displayCurrency])

  const isDirty = useMemo(() => {
    const currentConfigSnapshot = JSON.stringify({
      defaultMarket,
      feeConfigs,
      aiConfig,
    })
    const savedConfigSnapshot = JSON.stringify({
      defaultMarket: config.defaultMarket,
      feeConfigs: config.feeConfigs,
      aiConfig: config.aiConfig,
    })

    return currentConfigSnapshot !== savedConfigSnapshot || draftDisplayCurrency !== displayCurrency
  }, [aiConfig, config.aiConfig, config.defaultMarket, config.feeConfigs, defaultMarket, displayCurrency, draftDisplayCurrency, feeConfigs])

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

  const updatePromptField = (field: PromptField, value: string) => {
    setAiConfig((current) => ({
      ...current,
      promptTemplates: {
        ...current.promptTemplates,
        [field]: value,
      },
    }))
  }

  const handleSave = async () => {
    if (!isDirty) return
    setSaving(true)
    setError('')
    try {
      await updateConfig({
        defaultMarket,
        feeConfigs,
        aiConfig,
      })
      if (draftDisplayCurrency !== displayCurrency) {
        setDisplayCurrency(draftDisplayCurrency)
      }
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

  const toggleSection = (section: SectionId) => {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }

  const renderSection = ({
    id,
    icon,
    title,
    description,
    content,
  }: {
    id: SectionId
    icon: ReactNode
    title: string
    description: string
    content: ReactNode
  }) => (
    <Card className="border-border">
      <button
        type="button"
        onClick={() => toggleSection(id)}
        className="flex w-full items-start gap-3 rounded-lg p-5 text-left transition-colors hover:bg-muted/30"
      >
        <div className="mt-0.5 text-primary">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="pt-0.5 text-muted-foreground">
          {openSections[id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>
      {openSections[id] && (
        <CardContent className="border-t border-border pt-5">
          {content}
        </CardContent>
      )}
    </Card>
  )

  return (
    <div className="space-y-6">
      {renderSection({
        id: 'basic',
        icon: <Settings2 className="h-4 w-4" />,
        title: '基础设置',
        description: '管理默认市场和各市场手续费规则。',
        content: (
          <div className="space-y-6">
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

            <div>
              <div className="text-sm font-medium text-foreground">手续费配置</div>
              <div className="mt-1 text-xs text-muted-foreground">
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
          </div>
        ),
      })}

      {renderSection({
        id: 'ai',
        icon: <Sparkles className="h-4 w-4" />,
        title: 'AI 设置',
        description: '管理 provider、模型、密钥和默认分析强度。',
        content: (
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
              <Label htmlFor="ai-strength">默认分析强度</Label>
              <Select
                id="ai-strength"
                value={aiConfig.defaultStrength}
                onChange={(e) => setAiConfig((current) => ({ ...current, defaultStrength: e.target.value as AiAnalysisStrength }))}
              >
                <option value="high">高强度</option>
                <option value="medium">中等强度</option>
                <option value="weak">弱强度</option>
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
        ),
      })}

      {renderSection({
        id: 'preferences',
        icon: <SlidersHorizontal className="h-4 w-4" />,
        title: '偏好设置',
        description: '管理显示货币等页面展示偏好。',
        content: (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5 max-w-48">
              <Label htmlFor="display-currency">显示货币</Label>
              <Select
                id="display-currency"
                value={draftDisplayCurrency}
                onChange={(e) => setDraftDisplayCurrency(e.target.value as 'CNY' | 'HKD' | 'USD' | 'USDT')}
              >
                <option value="CNY">CNY</option>
                <option value="HKD">HKD</option>
                <option value="USD">USD</option>
                <option value="USDT">USDT</option>
              </Select>
              <div className="text-xs text-muted-foreground">
                主题模式已迁回侧边栏底部，方便随时切换。
              </div>
            </div>
          </div>
        ),
      })}

      {renderSection({
        id: 'prompts',
        icon: <FilePenLine className="h-4 w-4" />,
        title: '提示词设置',
        description: '按模块编辑基础提示词、分析类型提示词和强度策略提示词。',
        content: (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              最终调用时会按“基础提示词 + 分析类型提示词 + 分析强度提示词”拼装。这里改动后，后续 AI 分析会直接使用你的版本。
            </div>

            <div className="space-y-4">
              {PROMPT_FIELD_META.map((item) => (
                <div key={item.key} className="space-y-1.5">
                  <Label htmlFor={`prompt-${item.key}`}>{item.label}</Label>
                  <div className="text-[11px] text-muted-foreground">{item.hint}</div>
                  <Textarea
                    id={`prompt-${item.key}`}
                    value={aiConfig.promptTemplates[item.key]}
                    onChange={(e) => updatePromptField(item.key, e.target.value)}
                    rows={item.key === 'baseSystem' ? 6 : 5}
                    className="min-h-[120px] font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        ),
      })}

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
          <Button type="button" onClick={handleSave} disabled={saving || !isDirty}>
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
