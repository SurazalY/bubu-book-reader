import { useCallback, useEffect, useRef, useState } from 'react'

import { asApiError } from './envelope.js'

export function nextStateAfterBackgroundSuccess(_previous, result) {
  return {
    status: 'ready',
    data: result.data,
    error: null,
    meta: result.meta || {},
  }
}

export function nextStateAfterBackgroundFailure(previous, error) {
  const apiError = asApiError(error)
  if (previous.data) {
    return { ...previous, status: 'ready', error: apiError }
  }
  return { status: 'error', data: null, error: apiError, meta: {} }
}

export function useApiResource(loader) {
  const [reloadVersion, setReloadVersion] = useState(0)
  const [state, setState] = useState({ status: 'loading', data: null, error: null, meta: {} })
  const requestVersion = useRef(0)
  const backgroundRequestVersion = useRef(0)

  const reload = useCallback(() => setReloadVersion((version) => version + 1), [])

  const refreshInBackground = useCallback(() => {
    const version = backgroundRequestVersion.current + 1
    backgroundRequestVersion.current = version
    return Promise.resolve(loader())
      .then((result) => {
        if (backgroundRequestVersion.current !== version) return null
        setState(nextStateAfterBackgroundSuccess(null, result))
        return result
      })
      .catch((error) => {
        if (backgroundRequestVersion.current !== version) return null
        setState((previous) => nextStateAfterBackgroundFailure(previous, error))
        return null
      })
  }, [loader])

  useEffect(() => {
    let active = true
    const version = requestVersion.current + 1
    requestVersion.current = version
    setState((previous) => ({ ...previous, status: 'loading', error: null }))

    Promise.resolve(loader())
      .then((result) => {
        if (!active || requestVersion.current !== version) return
        setState({
          status: 'ready',
          data: result.data,
          error: null,
          meta: result.meta || {},
        })
      })
      .catch((error) => {
        if (!active || requestVersion.current !== version) return
        setState({ status: 'error', data: null, error: asApiError(error), meta: {} })
      })

    return () => {
      active = false
    }
  }, [loader, reloadVersion])

  return { ...state, reload, refreshInBackground }
}
