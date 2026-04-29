import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSkillByName } from '@/lib/agent/skills/registry'
import { loadBuiltinSkillManifests, loadConfiguredSkillManifests } from '@/lib/agent/skills/loader'

test('agent skill loader reads builtin markdown manifests', () => {
  const manifests = loadBuiltinSkillManifests()
  const names = manifests.map((manifest) => manifest.name).sort()

  assert.deepEqual(names, [
    'market.getAnalysisContext',
    'market.resolveCandidate',
    'portfolio.getAnalysisContext',
    'portfolio.getSummary',
    'portfolio.getTopPositions',
    'stock.getAnalysisContext',
    'stock.getExternalQuote',
    'stock.getHolding',
    'stock.getQuote',
    'stock.getRecentTrades',
    'stock.getTechnicalSnapshot',
    'stock.match',
  ].sort())

  const holding = manifests.find((manifest) => manifest.name === 'stock.getHolding')
  assert.ok(holding)
  assert.equal(holding.inputs.stockId, 'string')
  assert.deepEqual(holding.scopes, ['stock.read'])
  assert.ok(holding.documentation.includes('使用场景'))
})

test('agent skill registry binds markdown metadata to internal executors', () => {
  const skill = getSkillByName('stock.getHolding')

  assert.ok(skill)
  assert.equal(skill.version, 1)
  assert.equal(skill.inputSchema.stockId, 'string')
  assert.deepEqual(skill.requiredScopes, ['stock.read'])
  assert.ok(skill.sourcePath?.endsWith('skills/builtin/stock-get-holding/SKILL.md'))
  assert.equal(typeof skill.execute, 'function')
})

test('agent skill registry exposes fixed analysis task skills', () => {
  const portfolioSkill = getSkillByName('portfolio.getAnalysisContext')
  const stockSkill = getSkillByName('stock.getAnalysisContext')

  assert.ok(portfolioSkill)
  assert.deepEqual(portfolioSkill.requiredScopes, ['portfolio.read', 'quote.read'])
  assert.equal(portfolioSkill.prompt, 'lib/agent/prompts/analysis.ts#PORTFOLIO_ANALYSIS_PROMPT')
  assert.ok(portfolioSkill.sourcePath?.endsWith('skills/builtin/portfolio-get-analysis-context/SKILL.md'))

  assert.ok(stockSkill)
  assert.deepEqual(stockSkill.requiredScopes, ['stock.read', 'trade.read', 'quote.read'])
  assert.equal(stockSkill.prompt, 'lib/agent/prompts/analysis.ts#STOCK_ANALYSIS_PROMPT')
  assert.ok(stockSkill.sourcePath?.endsWith('skills/builtin/stock-get-analysis-context/SKILL.md'))

  const marketSkill = getSkillByName('market.getAnalysisContext')
  assert.ok(marketSkill)
  assert.deepEqual(marketSkill.requiredScopes, ['market.read', 'quote.read'])
  assert.equal(marketSkill.prompt, 'lib/agent/prompts/analysis.ts#MARKET_ANALYSIS_PROMPT')
  assert.ok(marketSkill.sourcePath?.endsWith('skills/builtin/market-get-analysis-context/SKILL.md'))
})

test('agent skill loader reads external skill manifest roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stocktracker-skills-'))
  const skillDir = path.join(root, 'custom-stock-holding')
  fs.mkdirSync(skillDir)
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: stock.getHolding',
    'description: 自定义持仓读取说明。',
    'version: 2',
    'scopes:',
    '  - stock.read',
    'inputs:',
    '  stockId: string',
    'dependencies:',
    '  - lib/finance.ts',
    'script: lib/agent/skills/stock.ts#stockGetHoldingSkill',
    'prompt: skills/custom/stock-holding.md',
    '---',
    '',
    '# 使用场景',
    '',
    '外部 Skill manifest 可以覆盖内置 Skill 的描述和提示词绑定。',
  ].join('\n'))

  const manifests = loadConfiguredSkillManifests([root])
  assert.equal(manifests.length, 1)
  assert.equal(manifests[0].name, 'stock.getHolding')
  assert.equal(manifests[0].description, '自定义持仓读取说明。')
  assert.equal(manifests[0].version, 2)
  assert.equal(manifests[0].prompt, 'skills/custom/stock-holding.md')
})
