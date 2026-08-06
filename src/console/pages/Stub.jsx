import { useLocation } from 'react-router-dom'
import { Icon } from '../../components/ui.jsx'
import { PagePanel } from '../components/PagePanel.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'
import { matchLeaf } from '../data/nav.js'

// Stage 2 只交付外壳，业务页面在 Stage 3～5 逐个替换。
// 这里不是死入口：路由可达、标题随工作空间范围变化、明确说明由哪个阶段接手，
// 空状态按规范给「图标 + 主文案 + 副文案」。
export default function Stub({ stage, plan }) {
  const { workspace } = useConsole()
  const location = useLocation()
  const leaf = matchLeaf(location.pathname)

  return (
    <PagePanel
      title={`${workspace.scopeLabel} · ${leaf?.label || '页面'}`}
      desc={`当前工作空间：${workspace.fullName} · ${workspace.role}`}
    >
      <div className="flex-1 rounded-xl border border-dashed border-ink-200 bg-white/50 px-6 flex flex-col items-center justify-center text-center">
        <Icon name="Hammer" className="w-8 h-8 text-ink-300" strokeWidth={1.5} />
        <p className="text-[14px] font-medium text-ink-700 mt-3">页面壳已接通，业务内容尚未填充</p>
        <p className="text-[12.5px] text-ink-500 mt-1.5">
          {plan || '列表、详情与操作流程'}将在 {stage || 'Stage 3'} 交付；当前外壳的栏位、范围与权限已按本工作空间生效。
        </p>
      </div>
    </PagePanel>
  )
}
