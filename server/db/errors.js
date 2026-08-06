export class HttpError extends Error {
  constructor(status, code, message, options = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = options.details ?? {}
    this.retryable = options.retryable ?? false
  }
}

export function isHttpError(error) {
  return error instanceof HttpError
}
