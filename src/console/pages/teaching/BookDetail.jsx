import { useNavigate, useParams } from 'react-router-dom'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, Field, StatusTag, SubHead } from '../../components/Controls.jsx'
import { BarProgress } from '../../components/Progress.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useAssignmentsData from '../../state/useAssignmentsData.js'
import useReadingStatistics from '../../state/useReadingStatistics.js'
import useStage4ConsoleData from '../../state/useStage4ConsoleData.js'

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function minutesFromSeconds(value) {
  const seconds = numberOrNull(value)
  return seconds === null ? null : Math.floor(seconds / 60)
}

export default function BookDetail() {
  const { bookId } = useParams()
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const bookResource = useStage4ConsoleData('bookDetail', { workspaceId: workspace?.id, resourceId: bookId })
  const assignmentsResource = useAssignmentsData(workspace?.id)
  const statisticsResource = useReadingStatistics(workspace?.id, { bookVersionId: bookResource.data?.versionId })

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
  const personalProgress = numberOrNull(book.progress?.percent)
  const readingMinutes = minutesFromSeconds(statisticsResource.data?.effectiveReadingSeconds)
  const relatedPlans = assignmentsResource.status === 'ready'
    ? (assignmentsResource.data?.arrangements || []).filter((plan) => plan.bookId === book.id)
    : []
  const coverUrl = typeof book.cover?.url === 'string' && book.cover.url ? book.cover.url : null
  const coverStyle = coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined

  return (
    <PagePanel
      title={`${text(book.title, '服务端未返回书名')} · 书目详情`}
      desc={`${text(book.author, '服务端未返回作者')} · 当前已发布版本`}
      toolbar={
        <>
          <Btn icon="ArrowLeft" onClick={() => navigate('/console/teaching/books')}>返回书库</Btn>
          <Btn tone="primary" icon="BookOpen" onClick={() => navigate(`/console/teaching/reader/${book.id}`)}>用教师阅读器打开</Btn>
        </>
      }
    >
      <div className="flex items-start gap-5">
        <div className="shrink-0 w-[132px]">
          <div
            className="w-full aspect-[3/4] rounded-xl shadow-e3 relative overflow-hidden bg-ink-300 bg-cover bg-center"
            style={coverStyle}
          >
            <span className="console-sheen absolute inset-0" aria-hidden="true" />
            <span className="absolute left-0 top-0 bottom-0 w-[8px] bg-black/12" aria-hidden="true" />
            {!coverUrl && (
              <span className="absolute inset-x-3 bottom-4 text-white font-serif text-[15px] font-bold leading-snug drop-shadow">
                {text(book.title, '服务端未返回书名')}
              </span>
            )}
          </div>
          <div className="mt-2 text-center"><StatusTag tone="success" dot>已发布</StatusTag></div>
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
              <Field label="当前账号进度">{personalProgress === null ? '服务端未返回' : `${personalProgress}%`}</Field>
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
        <span className="text-[11.5px] text-ink-500">导入、下架、删除和版本回滚尚无已接入的写入契约，本页不伪造管理操作。</span>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <GlassCard className="p-3.5 lg:col-span-2">
          <SubHead icon="ChartNoAxesColumn" title="阅读数据" />
          {statisticsResource.status === 'loading' ? (
            <p className="text-[12.5px] text-ink-500 py-3">正在读取当前范围的真实阅读统计。</p>
          ) : statisticsResource.status === 'ready' ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="参与学生" value={statisticsResource.data?.participantCount} unit="人" />
                <Metric label="有效阅读" value={readingMinutes} unit="分钟" />
                <Metric label="书目分项" value={statisticsResource.data?.byBook?.length} unit="项" />
              </div>
              {personalProgress !== null && <div className="mt-3"><BarProgress label="当前账号阅读进度" value={personalProgress} size="sm" /></div>}
            </>
          ) : (
            <p className="text-[12.5px] text-ink-500 py-3">{statisticsResource.error?.message || '当前账号无法读取这本书的范围统计。'}</p>
          )}
        </GlassCard>

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

function Metric({ label, value, unit }) {
  const number = numberOrNull(value)
  return (
    <div>
      <div className="text-[11.5px] text-ink-400">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-[19px] font-semibold text-ink-900 tabular-nums leading-none">{number === null ? '—' : number}</span>
        {unit && number !== null && <span className="text-[11px] text-ink-500">{unit}</span>}
      </div>
    </div>
  )
}
