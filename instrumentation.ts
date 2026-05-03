import type { Instrumentation } from 'next'
import { logger } from '@/lib/observability/logger'

export function register() {
  logger.info('next.instrumentation.register', {
    runtime: process.env.NEXT_RUNTIME ?? 'nodejs',
    nodeEnv: process.env.NODE_ENV,
  })
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  logger.error('next.request.error', {
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
    error,
  })
}
