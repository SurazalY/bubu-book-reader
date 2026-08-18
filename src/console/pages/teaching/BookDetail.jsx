import { useNavigate, useParams } from 'react-router-dom'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, Field, StatusTag, SubHead } from '../../components/Controls.jsx'
import { useProtectedAssetUrl } from '../../../shared/useProtectedAssetUrl.js'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useAssignmentsData from '../../state/useAssignmentsData.js'
import useStage4ConsoleData from '../../state/useStage4ConsoleData.js'
import { bookGradeValue, bookPublishStatus } from './bookLibraryFilters.js'
import { canManageClassShelf } from './bookManagement.js'
import BookVisibilityPanel from './BookVisibilityPanel.jsx'

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function BookCoverFigure({ book, workspaceId }) {
  const coverUrl = typeof book?.cover?.url === 'string' && book.cover.url ? book.cover.url : null
  const { objectUrl, failed } = useProtectedAssetUrl(coverUrl, workspaceId)
  const available = Boolean(objectUrl) && !failed
  return (
    <div className="w-full aspect-[3/4] rounded-xl shadow-e3 relative overflow-hidden bg-ink-300">
      {available && (
        <img src={objectUrl} alt={text(book.title, '书籍封面')} className="absolute inset-0 h-full w-full object-cover" />
      )}
      <span className="console-sheen absolute inset-0" aria-hidden="true" />
      <span className="absolute left-0 top-0 bottom-0 w-[8px] bg-black/12" aria-hidden="true" />
      {(!coverUrl || failed) && (
        <span className="absolute inset-x-3 bottom-4 text-white font-serif text-[15px] font-bold leading-snug drop-shadow">
          {text(book.title, '服务端未返回书名')}
        </span>
      )}
    </div>
  )
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export default function BookDetail() {
  const { bookId } = useParams()
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const bookResource = useStage4ConsoleData('bookDetail', { workspaceId: workspace?.id, resourceId: bookId })
  const assignmentsResource = useAssignmentsData(workspace?.id)
  const manageShelf = canManageClassShelf(workspace)

  if (bookResource.status === 'loading') {
    return (
      <PagePanel title="书目详情" desc="正在读取当前工作空间可见的真实书目。">
        <EmptyState icon="LoaderCircle" title="正在读取书目详情" desc="不会从前端样例书目回退。" />
      </PagePanel>
    )
  }

  if (bookResource.status !== 'ready' || !bookResource.data) {
    return (
      <PagePanel title="书目详情" desc="书目详情只展示当前工作空间有权读取的真实数据。">
        <EmptyState
          icon={bookResource.status === 'empty' ? 'BookX' : 'CloudOff'}
          title={bookResource.status === 'empty' ? '找不到这本书' : '书目详情暂时无法读取'}
          desc={bookResource.error?.message || bookResource.reason?.message || '请回到书库重新选择，或检查当前工作空间权限。'}
          action={<Btn tone="primary" icon="ArrowLeft" onClick={() => navigate('/console/teaching/books')}>回到书库</Btn>}
        />
      </PagePanel>
    )
  }

  const book = bookResource.data
  const pages = numberOrNull(book.progress?.totalPages)
  const relatedPlans = assignmentsResource.status === 'ready'
    ? (assignmentsResource.data?.arrangements || []).filter((plan) => plan.bookId === book.id)
    : []
  const coverUrl = typeof book.cover?.url === 'string' && book.cover.url ? book.cover.url : null
  const published = bookPublishStatus(book) === 'published'
  const gradeValue = bookGradeValue(book)

  return (
    <PagePanel
      title={`${text(book.title, '服务端未返回书名')} · 书目详情`}
      desc={`${text(book.author, '服务端未返回作者')} · ${published ? '当前已发布版本' : '当前不是已发布状态，不能投放到班级书架'}`}
      toolbar={
        <>
          <Btn icon="ArrowLeft" onClick={() => navigate('/console/teaching/books')}>返回书库</Btn>
          {published ? (
            <Btn tone="primary" icon="BookOpen" onClick={() => navigate(`/console/teaching/reader/${book.id}`)}>用教师阅读器打开</Btn>
          ) : (
            <Btn tone="primary" icon="BookOpen" disabled>用教师阅读器打开</Btn>
          )}
        </>
      }
    >
      <div className="flex items-start gap-5">
        <div className="shrink-0 w-[132px]">
          <BookCoverFigure book={book} workspaceId={workspace?.id} />
          <div className="mt-2 text-center">
            <StatusTag tone={published ? 'success' : 'warning'} dot>{published ? '已发布' : '未发布'}</StatusTag>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink-700 leading-relaxed">
            当前接口未返回书籍简介，页面只展示已授权读取到的目录、版本、页数和素材用途信息。
          </p>
          <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-x-8">
            <div>
              <Field label="作者">{text(book.author, '服务端未返回')}</Field>
              <Field label="插图作者">{text(book.illustrator, '服务端未返回')}</Field>
              <Field label="篇幅">{pages === null ? '服务端未返回' : `${pages} 页`}</Field>
              <Field label="适用年级">{gradeValue === null ? '未标注年级' : `${gradeValue} 年级`}</Field>
            </div>
            <div>
              <Field label="版本标识">{text(book.versionId, '服务端未返回')}</Field>
              <Field label="目录来源">{text(book.sourcePage, '服务端未返回')}</Field>
              <Field label="素材用途">{text(book.usageLabel, '服务端未返回')}</Field>
              <Field label="封面资源">{coverUrl ? '已由真实资产服务返回' : '服务端未返回封面'}</Field>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3.5 border-t border-ink-150/70 flex items-center gap-2 flex-wrap">
        <Btn icon="CalendarPlus" onClick={() => navigate('/console/teaching/arrangements')}>用它建阅读安排</Btn>
      </div>

      {manageShelf && published && (
        <div className="mt-4">
          <BookVisibilityPanel workspace={workspace} bookId={book.id} />
        </div>
      )}

      <div className="mt-4">
        <GlassCard className="p-3.5">
          <SubHead icon="CalendarDays" title={`关联阅读安排（${assignmentsResource.status === 'ready' ? relatedPlans.length : '—'}）`} />
          {assignmentsResource.status === 'loading' ? (
            <p className="text-[12.5px] text-ink-500 py-3">正在读取真实阅读安排。</p>
          ) : assignmentsResource.status === 'ready' && relatedPlans.length === 0 ? (
            <p className="text-[12.5px] text-ink-500 py-3">当前工作空间没有用这本书的阅读安排。</p>
          ) : assignmentsResource.status === 'ready' ? (
            <ul className="space-y-1.5">
              {relatedPlans.map((plan) => (
                <li key={plan.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/console/teaching/arrangements/${plan.id}`)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/70 transition text-left"
                  >
                    <span className="text-[12.5px] text-ink-800 truncate flex-1">{text(plan.chapter, '未命名阅读安排')}</span>
                    <span className="text-[11.5px] text-ink-500 tabular-nums shrink-0">{plan.progress === null ? '—' : `${plan.progress}%`}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-500 py-3">{assignmentsResource.error?.message || '当前账号无法读取阅读安排。'}</p>
          )}
        </GlassCard>
      </div>

      <div className="mt-3.5">
        <GlassCard className="p-3.5">
          <SubHead icon="History" title="版本信息" />
          <p className="text-[12.5px] text-ink-600 leading-relaxed">
            当前目录接口已返回正在使用的版本标识「{text(book.versionId, '服务端未返回')}」。完整版本历史与回滚接口尚未开放，因此不显示前端样例时间线。
          </p>
        </GlassCard>
      </div>
    </PagePanel>
  )
}
