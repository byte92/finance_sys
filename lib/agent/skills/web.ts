import type { AgentSkill, AgentSkillCall } from '@/lib/agent/types'

export type WebFetchInput = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  extractPrompt?: string
}

export type WebFetchResult = {
  status: number
  body: string
  summary?: string
  url: string
}

const ALLOWED_HOSTS = [
  'finance.yahoo.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'qt.gtimg.cn',
  'web.ifzq.gtimg.cn',
  'ifzq.gtimg.cn',
  'api.nasdaq.com',
  'stooq.com',
  'www.alphavantage.co',
  'push2.eastmoney.com',
  'data.eastmoney.com',
  'emweb.securities.eastmoney.com',
  'www.cninfo.com.cn',
  'api.exchangerate-api.com',
  'news.google.com',
]

const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1']
const MAX_BODY_SIZE = 512 * 1024 // 512KB
const REQUEST_TIMEOUT_MS = 15_000

function validateUrl(raw: string): URL {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`不支持的协议：${url.protocol}`)
  }
  if (BLOCKED_HOSTS.some((h) => url.hostname === h || url.hostname.startsWith(h))) {
    throw new Error(`禁止访问内网地址：${url.hostname}`)
  }
  // 检查 IP 范围
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/.test(url.hostname)) {
    throw new Error(`禁止访问内网 IP：${url.hostname}`)
  }
  const allowed = ALLOWED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))
  if (!allowed) {
    throw new Error(`不在白名单中的域名：${url.hostname}`)
  }
  return url
}

export const webFetchSkill: AgentSkill<WebFetchInput, WebFetchResult> = {
  name: 'web.fetch',
  description: '发起受控网络请求，抓取外部金融数据（仅限白名单域名）。',
  inputSchema: { url: 'string', method: 'string?', headers: 'object?', body: 'string?', extractPrompt: 'string?' },
  requiredScopes: ['network.fetch'],
  async execute(args) {
    const method = args.method?.toUpperCase() || 'GET'
    const headers = args.headers ?? {}

    try {
      const url = validateUrl(args.url)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      const res = await fetch(url.toString(), {
        method,
        headers: {
          'User-Agent': 'StockTracker/2.0 (finance-agent)',
          Accept: 'application/json, text/plain, text/html, */*',
          ...headers,
        },
        body: method !== 'GET' && method !== 'HEAD' ? args.body : undefined,
        signal: controller.signal,
      })

      clearTimeout(timer)

      let body = ''
      const reader = res.body?.getReader()
      if (reader) {
        const decoder = new TextDecoder()
        let size = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > MAX_BODY_SIZE) {
            reader.cancel()
            body += decoder.decode(value.slice(0, MAX_BODY_SIZE - (size - value.length)))
            body += '\n\n[响应已截断，超过 512KB 上限]'
            break
          }
          body += decoder.decode(value, { stream: true })
        }
      }

      body = body.slice(0, MAX_BODY_SIZE)

      const result: WebFetchResult = { status: res.status, body, url: args.url }

      // 如果提供了提取提示词，标记为需要 AI 摘要
      if (args.extractPrompt && body) {
        result.summary = `按照以下要求从抓取内容中提取信息：${args.extractPrompt}\n\n原始内容：${body.slice(0, 4096)}`
      }

      return { skillName: 'web.fetch', ok: true, data: result }
    } catch (error) {
      return {
        skillName: 'web.fetch',
        ok: false,
        error: error instanceof Error ? error.message : '网络请求失败',
      }
    }
  },
}
