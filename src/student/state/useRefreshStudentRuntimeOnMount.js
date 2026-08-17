import { useEffect, useRef } from 'react'

import { useStudent } from './StudentContext.jsx'

// 进页时后台刷新 Provider 级 runtime，拿到阅读器关闭后落库的最新页码与有效阅读时长。
// 只在页面挂载时触发一次；不轮询，也不把全局 runtime 切到 loading（避免书架/主页骨架屏闪烁）。
export default function useRefreshStudentRuntimeOnMount() {
  const { runtime } = useStudent()
  const refreshInBackground = useRef(runtime.refreshInBackground)
  refreshInBackground.current = runtime.refreshInBackground

  useEffect(() => {
    void refreshInBackground.current?.()
  }, [])
}
