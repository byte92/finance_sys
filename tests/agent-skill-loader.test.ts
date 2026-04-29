import test from 'node:test'
import assert from 'node:assert/strict'
import { getSkillByName } from '@/lib/agent/skills/registry'
import { loadBuiltinSkillManifests } from '@/lib/agent/skills/loader'

test('agent skill loader reads builtin markdown manifests', () => {
  const manifests = loadBuiltinSkillManifests()
  const names = manifests.map((manifest) => manifest.name).sort()

  assert.deepEqual(names, [
    'portfolio.getSummary',
    'portfolio.getTopPositions',
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
