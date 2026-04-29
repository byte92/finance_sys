import fs from 'node:fs'
import path from 'node:path'
import type { AgentDataScope, AgentSkill } from '@/lib/agent/types'

export type AgentSkillManifest = {
  name: string
  description: string
  version?: number
  scopes: AgentDataScope[]
  inputs: Record<string, unknown>
  dependencies: string[]
  script?: string
  documentation: string
  sourcePath: string
}

const SKILL_FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

function parseScalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return trimmed.replace(/^["']|["']$/g, '')
}

function parseFrontmatter(raw: string) {
  const result: Record<string, unknown> = {}
  const lines = raw.split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!keyValue) {
      index += 1
      continue
    }

    const [, key, value] = keyValue
    if (value) {
      result[key] = parseScalar(value)
      index += 1
      continue
    }

    const list: string[] = []
    const object: Record<string, unknown> = {}
    index += 1
    while (index < lines.length && /^\s+/.test(lines[index])) {
      const child = lines[index].trim()
      const listItem = child.match(/^-\s*(.+)$/)
      const objectItem = child.match(/^([A-Za-z0-9_-]+):\s*(.+)$/)
      if (listItem) {
        list.push(String(parseScalar(listItem[1])))
      } else if (objectItem) {
        object[objectItem[1]] = parseScalar(objectItem[2])
      }
      index += 1
    }
    result[key] = list.length ? list : object
  }

  return result
}

function parseSkillMarkdown(filePath: string): AgentSkillManifest {
  const raw = fs.readFileSync(filePath, 'utf8')
  const match = raw.match(SKILL_FRONTMATTER_PATTERN)
  if (!match) {
    throw new Error(`Skill 缺少 frontmatter：${filePath}`)
  }

  const metadata = parseFrontmatter(match[1])
  const name = String(metadata.name ?? '').trim()
  const description = String(metadata.description ?? '').trim()
  if (!name || !description) {
    throw new Error(`Skill frontmatter 必须包含 name 和 description：${filePath}`)
  }

  return {
    name,
    description,
    version: typeof metadata.version === 'number' ? metadata.version : undefined,
    scopes: Array.isArray(metadata.scopes) ? metadata.scopes as AgentDataScope[] : [],
    inputs: metadata.inputs && typeof metadata.inputs === 'object' && !Array.isArray(metadata.inputs)
      ? metadata.inputs as Record<string, unknown>
      : {},
    dependencies: Array.isArray(metadata.dependencies) ? metadata.dependencies.map(String) : [],
    script: typeof metadata.script === 'string' ? metadata.script : undefined,
    documentation: match[2].trim(),
    sourcePath: filePath,
  }
}

export function loadBuiltinSkillManifests(rootDir = path.join(process.cwd(), 'skills', 'builtin')) {
  if (!fs.existsSync(rootDir)) return []
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name, 'SKILL.md'))
    .filter((filePath) => fs.existsSync(filePath))
    .map(parseSkillMarkdown)
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
    inputSchema: manifest.inputs,
    requiredScopes: manifest.scopes,
    dependencies: manifest.dependencies,
    script: manifest.script,
    documentation: manifest.documentation,
    sourcePath: manifest.sourcePath,
  }
}
