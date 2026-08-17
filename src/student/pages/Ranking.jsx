import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { BookCover, Icon } from '../../components/ui.jsx'
import { formatReadingMinutes } from '../../shared/format.js'
import { GlassPanel } from '../components/Glass.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import useRefreshStudentRuntimeOnMount from '../state/useRefreshStudentRuntimeOnMount.js'

const titleCollator = new Intl.Collator('zh-CN', { sensitivity: 'base', numeric: true })

// 旧路由保留兼容，但页面不再按阅读时长、页码或完成情况做竞争式排序。
export default function Ranking() {
  useRefreshStudentRuntimeOnMount()
  const { runtime } = useStudent()
  const rows = useMemo(() => (runtime.data?.books || [])
    .slice()
    .sort((left, right) =>
      titleCollator.compare(String(left.title || ''), String(right.title || ''))
      || String(left.id || '').localeCompare(String(right.id || ''), 'en')), [runtime.data?.books])

  return (
    <div className="flex-1 space-y-4">
      <div className="student-enter flex items-center gap-3">
        <Link to="/student/home" className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-600 transition hover:bg-white/90 hover:text-ink-900">
          <Icon name="ArrowLeft" className="h-4 w-4" />返回主页
        </Link>
      </div>

      <GlassPanel tone="solid" sheen className="student-enter rounded-2xl p-6">
        <h1 className="font-serif text-h1 font-bold text-ink-900">我的阅读书目</h1>
        <p className="mt-1.5 text-caption text-ink-500">书目按规范化书名和 ID 稳定排列，不按时长、完成情况或页码评出名次。</p>

        {runtime.status === 'loading' ? (
          <p className="mt-6 rounded-xl bg-white/58 px-6 py-10 text-center text-caption text-ink-500">正在读取书目…</p>
        ) : runtime.status === 'error' ? (
          <p className="mt-6 rounded-xl bg-white/58 px-6 py-10 text-center text-caption text-ink-500">书目请求失败，本页不会回退到演示排行。</p>
        ) : rows.length ? (
          <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {rows.map((book, index) => {
              const minutes = formatReadingMinutes(book.progress?.effectiveMinutes)
              return (
                <li key={book.id} className="student-stagger" style={{ '--i': index }}>
                  <Link to={`/student/books/${book.id}`} className="group flex items-center gap-3.5 rounded-xl bg-white/62 px-3.5 py-3 transition hover:bg-white/88">
                    <BookCover book={book} className="w-[44px] shrink-0 rounded-md shadow-e1" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-title font-bold text-ink-900">{book.title || '服务端未返回书名'}</span>
                      <span className="mt-0.5 block truncate text-micro text-ink-500">{book.author || '服务端未返回作者'}</span>
                      <span className="mt-1 block text-micro text-ink-400 tabular-nums">
                        {Number.isSafeInteger(book.progress?.currentPage) ? `最近位置：第 ${book.progress.currentPage} 页` : '暂无最近阅读位置'}
                        {minutes ? ` · 有效阅读 ${minutes}` : ''}
                      </span>
                    </span>
                    <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5" />
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-6 rounded-xl bg-white/58 px-6 py-10 text-center text-caption text-ink-500">当前书架还没有可展示的书目。</p>
        )}
      </GlassPanel>
    </div>
  )
}
