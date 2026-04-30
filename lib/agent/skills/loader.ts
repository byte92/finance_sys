import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AgentDataScope, AgentSkill } from '@/lib/agent/types'

export type StockTrackerSkillMetadata = {
  kind?: 'instruction' | 'executable'
  handler?: string
  scopes?: AgentDataScope[]
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  prompt?: string
  dependencies?: string[]
}

export type AgentSkillManifest = {
  name: string
  description: string
  version?: number
  kind: 'instruction' | 'executable'
  scopes: AgentDataScope[]
  /** Legacy alias kept for current builtin manifests. Prefer inputSchema. */
  inputs: Record<string, unknown>
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  dependencies: string[]
  runtime?: string
  handler?: string
  /** Legacy alias for handler. */
  script?: string
  prompt?: string
  metadata: Record<string, unknown>
  stocktracker?: StockTrackerSkillMetadata
  documentation: string
  sourcePath: string
}

const SKILL_FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : []
}

function asAgentScopes(value: unknown) {
  return asStringArray(value) as AgentDataScope[]
}

function pickSchema(...values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value)
    if (Object.keys(record).length) return record
  }
  return {}
}

function parseFrontmatter(raw: string) {
  return asRecord(parseYaml(raw))
}

function getStockTrackerMetadata(metadata: Record<string, unknown>): StockTrackerSkillMetadata | undefined {
  const raw = asRecord(metadata.stocktracker)
  if (!Object.keys(raw).length) return undefined

  const kind = raw.kind === 'executable' || raw.kind === 'instruction' ? raw.kind : undefined
  const inputSchema = pickSchema(raw.inputSchema, raw.input_schema)
  const outputSchema = pickSchema(raw.outputSchema, raw.output_schema)

  return {
    kind,
    handler: typeof raw.handler === 'string' ? raw.handler : undefined,
    scopes: Array.isArray(raw.scopes) ? asAgentScopes(raw.scopes) : undefined,
    inputSchema: Object.keys(inputSchema).length ? inputSchema : undefined,
    outputSchema: Object.keys(outputSchema).length ? outputSchema : undefined,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : undefined,
    dependencies: Array.isArray(raw.dependencies) ? asStringArray(raw.dependencies) : undefined,
  }
}

export function parseSkillMarkdown(filePath: string): AgentSkillManifest {
  const raw = fs.readFileSync(filePath, 'utf8')
  const match = raw.match(SKILL_FRONTMATTER_PATTERN)
  if (!match) {
    throw new Error(`Skill 缺少 frontmatter：${filePath}`)
  }

  const frontmatter = parseFrontmatter(match[1])
  const name = String(frontmatter.name ?? '').trim()
  const description = String(frontmatter.description ?? '').trim()
  if (!name || !description) {
    throw new Error(`Skill frontmatter 必须包含 name 和 description：${filePath}`)
  }

  const metadata = asRecord(frontmatter.metadata)
  const stocktracker = getStockTrackerMetadata(metadata)
  const inputs = asRecord(frontmatter.inputs)
  const inputSchema = stocktracker?.inputSchema ?? pickSchema(frontmatter.inputSchema, frontmatter.input_schema, inputs)
  const outputSchema = stocktracker?.outputSchema ?? pickSchema(frontmatter.outputSchema, frontmatter.output_schema)
  const handler = stocktracker?.handler
    ?? (typeof frontmatter.handler === 'string' ? frontmatter.handler : undefined)
    ?? (typeof frontmatter.script === 'string' ? frontmatter.script : undefined)
  const script = typeof frontmatter.script === 'string' ? frontmatter.script : handler
  const prompt = stocktracker?.prompt ?? (typeof frontmatter.prompt === 'string' ? frontmatter.prompt : undefined)
  const dependencies = stocktracker?.dependencies ?? asStringArray(frontmatter.dependencies)
  const scopes = stocktracker?.scopes ?? asAgentScopes(frontmatter.scopes)
  const explicitKind = stocktracker?.kind
    ?? (frontmatter.kind === 'executable' || frontmatter.kind === 'instruction' ? frontmatter.kind : undefined)
  const kind = explicitKind ?? (handler ? 'executable' : 'instruction')

  return {
    name,
    description,
    version: typeof frontmatter.version === 'number' ? frontmatter.version : undefined,
    kind,
    scopes,
    inputs,
    inputSchema,
    outputSchema: Object.keys(outputSchema).length ? outputSchema : undefined,
    dependencies,
    runtime: typeof frontmatter.runtime === 'string' ? frontmatter.runtime : undefined,
    handler,
    script,
    prompt,
    metadata,
    stocktracker,
    documentation: match[2].trim(),
    sourcePath: filePath,
  }
}

export function loadSkillManifests(rootDir: string) {
  if (!fs.existsSync(rootDir)) return []
  const rootSkillPath = path.join(rootDir, 'SKILL.md')
  if (fs.existsSync(rootSkillPath)) {
    return [parseSkillMarkdown(rootSkillPath)]
  }
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name, 'SKILL.md'))
    .filter((filePath) => fs.existsSync(filePath))
    .map(parseSkillMarkdown)
}

export function loadBuiltinSkillManifests(rootDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'skills', 'builtin')) {
  return loadSkillManifests(rootDir)
}

function getConfiguredSkillRoots() {
  const roots = [path.join(/*turbopackIgnore: true*/ process.cwd(), 'skills', 'custom')]
  const envRoots = process.env.AGENT_SKILL_PATHS
    ?.split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean) ?? []
  return [...roots, ...envRoots]
}

export function loadConfiguredSkillManifests(roots = getConfiguredSkillRoots()) {
  return roots.flatMap((root) => loadSkillManifests(path.isAbsolute(root) ? root : path.join(/*turbopackIgnore: true*/ process.cwd(), root)))
}

export function applySkillManifest<TArgs, TResult>(
  skill: AgentSkill<TArgs, TResult>,
  manifest: AgentSkillManifest | null,
): AgentSkill<TArgs, TResult> {
  if (!manifest) return skill
  return {
    ...skill,
    description: manifest.description,
    version: manifest.version,
    inputSchema: manifest.inputSchema,
    requiredScopes: manifest.scopes,
    dependencies: manifest.dependencies,
    script: manifest.script,
    prompt: manifest.prompt,
    documentation: manifest.documentation,
    sourcePath: manifest.sourcePath,
  }
}
