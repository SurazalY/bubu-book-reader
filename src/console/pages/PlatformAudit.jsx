import { useCallback, useMemo } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { useApiResource } from '../../api/useApiResource.js'
import { EmptyState } from '../components/Controls.jsx'
import { PagePanel } from '../components/PagePanel.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'

export default function PlatformAudit() {
  const { workspace } = useConsole()
  const api = useMemo(() => createConsoleApi(), [])
  const load = useCallback(async () => {
    if (!workspace?.id) return { data: [], meta: {} }
    const response = await api.listAuditEvents({ workspaceId: workspace?.id })
    return { data: Array.isArray(response.data?.items) ? response.data.items : [], meta: response.meta }
  }, [api, workspace?.id])
  const resource = useApiResource(load)
  const items = resource.data || []

  return (
    <PagePanel title="平台审计" desc="运营管理员仅查看平台运行审计，不进入学校业务原文。">
      {items.length === 0 ? (
        <EmptyState icon="ShieldCheck" title={resource.status === 'loading' ? '正在读取平台审计' : '暂无平台审计记录'} desc={resource.error?.message || '审计记录只从后端真实接口读取。'} />
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-white/70 bg-white/62 px-4 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <strong className="text-title text-ink-900">{item.eventType || item.event_type}</strong>
                <span className="text-micro text-ink-400">{item.createdAt || item.created_at}</span>
              </div>
              <p className="mt-1.5 text-caption text-ink-500">
                {item.actorName || item.actor_name || '系统'} · {item.resourceType || item.resource_type || '平台资源'} · {item.outcome || 'recorded'}
              </p>
            </article>
          ))}
        </div>
      )}
    </PagePanel>
  )
}
