// 整书阅读 AI 边栏前端调用：POST /api/chat，带「页面感知」context。
// dev 经 vite proxy /api → 本地后端(5191)；生产由后端同源 serve，相对 /api 直达。
const API_BASE = import.meta.env.VITE_AI_BASE || ''

// context: { page, pageName, book, chapter, pageNo, totalPages, pageText, selection }
// messages: [{ role:'user'|'assistant', content }]
export async function askAI({ context = {}, messages = [] }) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, messages }),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    const error = new Error(payload?.error?.message || `AI 服务请求失败（HTTP ${res.status}）`)
    error.code = payload?.error?.code || 'DEPENDENCY_UNAVAILABLE'
    error.status = res.status
    error.retryable = payload?.error?.retryable ?? res.status >= 500
    error.requestId = payload?.error?.requestId
    throw error
  }
  return payload?.data ?? payload
}
