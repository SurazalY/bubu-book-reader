import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { EmptyState, SearchBox, StatusTag } from '../../components/Controls.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useStage4ConsoleData from '../../state/useStage4ConsoleData.js'

export default function StudentDirectory() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const resource = useStage4ConsoleData('studentList', { workspaceId: workspace?.id })
  const [keyword, setKeyword] = useState('')
  const students = resource.data?.items || []
  const rows = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase('zh-CN')
    if (!query) return students
    return students.filter((student) => [student.displayName, student.className, student.id]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('zh-CN').includes(query)))
  }, [keyword, students])

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前范围'} · 学生目录`}
      desc="学生与班级关系来自正式账号接口；本页只提供真实读取与详情下钻，没有后端写入契约的新增、转班和删除操作不会显示。"
      toolbar={<SearchBox value={keyword} onChange={setKeyword} placeholder="搜索学生、班级或账号" />}
    >
      {resource.status === 'error' ? (
        <EmptyState icon="TriangleAlert" title="学生目录加载失败" desc={resource.error?.message || '服务端拒绝了这次请求。'} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="Users"
          title={resource.status === 'loading' ? '正在读取学生目录' : keyword ? '没有匹配的学生' : '当前范围没有学生'}
          desc={resource.status === 'loading' ? '正在向正式账号接口请求数据。' : keyword ? '换一个姓名、班级或账号关键词试试。' : '不会用演示名单填充空数据。'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {rows.map((student) => (
            <button
              key={student.id}
              type="button"
              onClick={() => navigate(`/console/accounts/students/${student.id}`, { state: { from: '/console/accounts/students' } })}
              className="text-left"
            >
              <GlassCard className="p-4 h-full hover:shadow-e2 transition">
                <div className="flex items-center gap-3">
                  <span className="console-avatar w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-semibold text-white shrink-0">
                    {(student.displayName || student.id).slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[14px] font-semibold text-ink-900 truncate">{student.displayName || '未返回姓名'}</h2>
                    <p className="text-[11.5px] text-ink-500 mt-0.5 truncate">{student.className || student.classId || '未返回班级'}</p>
                    <p className="text-[10.5px] text-ink-400 mt-1 truncate">{student.id}</p>
                  </div>
                  <StatusTag tone="success" dot>在当前范围</StatusTag>
                  <Icon name="ChevronRight" className="w-4 h-4 text-ink-300 shrink-0" />
                </div>
              </GlassCard>
            </button>
          ))}
        </div>
      )}
    </PagePanel>
  )
}
