const net = require('node:net')
const { spawn } = require('node:child_process')

const DEFAULT_PORT = 3218
const MAX_PORT_ATTEMPTS = 20

function parsePort(value) {
  if (!value) {
    return DEFAULT_PORT
  }

  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(`Invalid PORT "${value}", falling back to ${DEFAULT_PORT}.`)
    return DEFAULT_PORT
  }

  return port
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port, '0.0.0.0')
  })
}

async function findAvailablePort(startPort) {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset

    if (port > 65535) {
      break
    }

    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error(`No available port found from ${startPort} to ${Math.min(startPort + MAX_PORT_ATTEMPTS - 1, 65535)}.`)
}

async function main() {
  const requestedPort = parsePort(process.env.PORT)
  const port = await findAvailablePort(requestedPort)

  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} is in use, using ${port} instead.`)
  }

  const nextBin = require.resolve('next/dist/bin/next')
  const child = spawn(process.execPath, [nextBin, 'dev', '-p', String(port)], {
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: 'inherit',
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 0)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
