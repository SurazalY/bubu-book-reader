import { useCallback, useEffect, useRef, useState } from 'react'

import { asApiError } from './envelope.js'

export function useApiResource(loader) {
  const [reloadVersion, setReloadVersion] = useState(0)
  const [state, setState] = useState({ status: 'loading', data: null, error: null, meta: {} })
  const requestVersion = useRef(0)

  const reload = useCallback(() => setReloadVersion((version) => version + 1), [])

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

  return { ...state, reload }
}
