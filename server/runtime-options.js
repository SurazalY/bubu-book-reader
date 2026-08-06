const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 5191

export function resolveRuntimeListenOptions(env = process.env) {
  const host = String(env.HOST || '').trim() || DEFAULT_HOST
  const requestedPort = Number(env.PORT || DEFAULT_PORT)
  const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
    ? requestedPort
    : DEFAULT_PORT
  return { host, port }
}
