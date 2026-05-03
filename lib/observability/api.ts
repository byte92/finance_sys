import { randomUUID } from 'node:crypto'
import { logger } from '@/lib/observability/logger'

type ApiHandler<TRequest extends Request = Request> = (request: TRequest) => Response | Promise<Response>

function requestPath(request: Request) {
  try {
    const url = new URL(request.url)
    return `${url.pathname}${url.search}`
  } catch {
    return request.url
  }
}

function queryKeys(request: Request) {
  try {
    return Array.from(new URL(request.url).searchParams.keys())
  } catch {
    return []
  }
}

export function withApiLogging<TRequest extends Request = Request>(route: string, handler: ApiHandler<TRequest>) {
  return async function loggedApiHandler(request: TRequest) {
    const requestId = randomUUID()
    const startedAt = Date.now()
    const method = request.method || 'GET'

    logger.debug('api.request.start', {
      requestId,
      route,
      method,
      path: requestPath(request),
      queryKeys: queryKeys(request),
    })

    try {
      const response = await handler(request)
      const durationMs = Date.now() - startedAt
      const fields = {
        requestId,
        route,
        method,
        status: response.status,
        durationMs,
      }
      if (response.status >= 500) {
        logger.error('api.request.end', fields)
      } else if (response.status >= 400) {
        logger.warn('api.request.end', fields)
      } else {
        logger.debug('api.request.end', fields)
      }
      return response
    } catch (error) {
      logger.error('api.request.error', {
        requestId,
        route,
        method,
        durationMs: Date.now() - startedAt,
        error,
      })
      throw error
    }
  }
}
