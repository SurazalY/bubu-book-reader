import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'

import { createIdentityModule, sendApiNotFound } from './domains/identity/index.js'
import { createIntegrationRouter } from './http/integration-router.js'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))

export function createReadmateApplication(options = {}) {
  const sessionSecret = options.sessionSecret ?? process.env.SESSION_TOKEN_SECRET
  const identity = createIdentityModule({
    databasePath: options.databasePath ?? process.env.DATABASE_PATH,
    migrationDirectory: options.migrationDirectory,
    sessionSecret,
    sessionTtlMs: options.sessionTtlMs,
    cookieSecure: options.cookieSecure,
    permissionPolicy: options.permissionPolicy,
  })
  const distDirectory = path.resolve(serverDirectory, options.distDirectory ?? process.env.DIST_DIR ?? '../dist')
  const publicAssetDirectory = path.resolve(
    serverDirectory,
    options.publicAssetDirectory ?? process.env.PUBLIC_ASSET_DIR ?? distDirectory,
  )
  const integration = createIntegrationRouter({
    database: identity.database,
    identityService: identity.service,
    sessionSecret,
    modelProvider: options.modelProvider,
    reviewProvider: options.reviewProvider,
    quotaPolicy: options.quotaPolicy,
    deliveryAdapter: options.deliveryAdapter,
    summaryLinkSigningKey: options.summaryLinkSigningKey,
    miniProgramReceiptVerifier: options.miniProgramReceiptVerifier,
    cookieSecure: options.cookieSecure,
    publicAssetDirectory,
    internalDemoMode: options.internalDemoMode ?? process.env.INTERNAL_DEMO_MODE === '1',
  })
  const app = express()
  app.disable('x-powered-by')
  app.use('/api/v1', identity.router)
  app.use('/api/v1', integration.router)
  app.use('/api/v1', sendApiNotFound)

  if (options.serveStatic !== false) {
    app.use('/books', (_req, res) => res.status(404).end())
    app.use(express.static(distDirectory))
    app.get('*', (req, res) => res.sendFile(path.join(distDirectory, 'index.html')))
  }

  return {
    app,
    database: identity.database,
    identity,
    integration,
    close: () => identity.close(),
  }
}
