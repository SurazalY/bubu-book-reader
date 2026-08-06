import 'dotenv/config'

import { createReadmateApplication } from './app.js'
import { resolveRuntimeListenOptions } from './runtime-options.js'

const { host, port } = resolveRuntimeListenOptions(process.env)
const application = createReadmateApplication()
const server = application.app.listen(port, host, () => {
  process.stdout.write(`[readmate] listening on http://${host}:${port}\n`)
})

function shutdown() {
  server.close(() => {
    application.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
