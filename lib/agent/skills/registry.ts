import type { AgentSkill } from '@/lib/agent/types'
import { applySkillManifest, loadBuiltinSkillManifests, loadConfiguredSkillManifests } from '@/lib/agent/skills/loader'
import { portfolioGetAnalysisContextSkill, stockGetAnalysisContextSkill } from '@/lib/agent/skills/analysis'
import { marketGetAnalysisContextSkill, marketResolveCandidateSkill } from '@/lib/agent/skills/market'
import { webFetchSkill } from '@/lib/agent/skills/web'
import { portfolioGetSummarySkill, portfolioGetTopPositionsSkill } from '@/lib/agent/skills/portfolio'
import {
  stockGetExternalQuoteSkill,
  stockGetHoldingSkill,
  stockGetQuoteSkill,
  stockGetRecentTradesSkill,
  stockGetTechnicalSnapshotSkill,
  stockGetFinancialsSkill,
  stockMatchSkill,
} from '@/lib/agent/skills/stock'

const BUILTIN_SKILLS: AgentSkill<any, any>[] = [
  marketResolveCandidateSkill,
  marketGetAnalysisContextSkill,
  webFetchSkill,
  portfolioGetAnalysisContextSkill,
  portfolioGetSummarySkill,
  portfolioGetTopPositionsSkill,
  stockGetAnalysisContextSkill,
  stockMatchSkill,
  stockGetHoldingSkill,
  stockGetRecentTradesSkill,
  stockGetQuoteSkill,
  stockGetExternalQuoteSkill,
  stockGetTechnicalSnapshotSkill,
  stockGetFinancialsSkill,
]

const MANIFESTS = [
  ...loadBuiltinSkillManifests(),
  ...loadConfiguredSkillManifests(),
]
const MANIFEST_BY_NAME = new Map(MANIFESTS.map((manifest) => [manifest.name, manifest]))
const REGISTERED_SKILLS = BUILTIN_SKILLS.map((skill) => applySkillManifest(skill, MANIFEST_BY_NAME.get(skill.name) ?? null))

export function getBuiltinSkills() {
  return REGISTERED_SKILLS
}

export function getRegisteredSkillManifests() {
  return MANIFESTS
}

export function getSkillByName(name: string) {
  return REGISTERED_SKILLS.find((skill) => skill.name === name) ?? null
}
