export function sendData(res, data, options = {}) {
  const meta = {
    requestId: options.requestId,
    serverTime: new Date().toISOString(),
    ...(options.meta ?? {}),
  }
  return res.status(options.status ?? 200).json({ data, meta })
}

export function sendFailure(res, error, requestId) {
  return res.status(error.status ?? 500).json({
    error: {
      code: error.code ?? 'DEPENDENCY_UNAVAILABLE',
      message: error.message ?? '服务暂时不可用',
      retryable: error.retryable ?? false,
      details: error.details ?? {},
      requestId,
    },
  })
}
