import type { AgentSkill } from '@/lib/agent/types'
import { applySkillManifest, loadBuiltinSkillManifests } from '@/lib/agent/skills/loader'
import { portfolioGetSummarySkill, portfolioGetTopPositionsSkill } from '@/lib/agent/skills/portfolio'
import {
  stockGetExternalQuoteSkill,
  stockGetHoldingSkill,
  stockGetQuoteSkill,
  stockGetRecentTradesSkill,
  stockGetTechnicalSnapshotSkill,
  stockMatchSkill,
} from '@/lib/agent/skills/stock'

const BUILTIN_SKILLS: AgentSkill[] = [
  portfolioGetSummarySkill,
  portfolioGetTopPositionsSkill,
  stockMatchSkill,
  stockGetHoldingSkill,
  stockGetRecentTradesSkill,
  stockGetQuoteSkill,
  stockGetExternalQuoteSkill,
  stockGetTechnicalSnapshotSkill,
]

const MANIFESTS = loadBuiltinSkillManifests()
const MANIFEST_BY_NAME = new Map(MANIFESTS.map((manifest) => [manifest.name, manifest]))
const REGISTERED_SKILLS = BUILTIN_SKILLS.map((skill) => applySkillManifest(skill, MANIFEST_BY_NAME.get(skill.name) ?? null))

export function getBuiltinSkills() {
  return REGISTERED_SKILLS
}

export function getSkillByName(name: string) {
  return REGISTERED_SKILLS.find((skill) => skill.name === name) ?? null
}
