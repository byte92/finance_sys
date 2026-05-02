const userAgent = process.env.npm_config_user_agent || ''
const execPath = process.env.npm_execpath || ''

const isPnpm = userAgent.startsWith('pnpm/') || /(^|[/\\])pnpm(?:\.cjs|\.js)?$/.test(execPath)

if (!isPnpm) {
  console.error('This project only supports pnpm. Run `corepack enable` if needed, then use `pnpm install` and `pnpm build`.')
  process.exit(1)
}
