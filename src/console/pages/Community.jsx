import { useMemo, useState } from 'react'
import { cx, Icon } from '../../components/ui.jsx'
import { PagePanel } from '../components/PagePanel.jsx'
import {
  Btn,
  EmptyState,
  IconBtn,
  SearchBox,
  Select,
  StatusTag,
  SubHead,
  Tabs,
  ViewToggle,
} from '../components/Controls.jsx'
import { ConfirmModal, Modal } from '../components/Overlay.jsx'
import CommunityPostCard from '../components/CommunityPostCard.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'
import useConsoleCommunityRuntime from '../state/useConsoleCommunityRuntime.js'

// 社区管理：顶部固定「待审核／班级／学校」三页签，
// 没有具体班级关系的工作空间（校长、书记）不显示「班级」——交付说明的硬要求。
// 主体复用学生社区的内容卡片风格，再叠加审核状态与管理操作。

const TIME_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '近 7 天' },
]

const POST_STATUS = {
  pending: { label: '待审核', tone: 'warning' },
  published: { label: '已发布', tone: 'success' },
  rejected: { label: '已驳回', tone: 'danger' },
  revise: { label: '退回修改', tone: 'accent' },
  offline: { label: '已下架', tone: 'muted' },
}

const REVIEW_ACTIONS = {
  approve: { label: '通过', icon: 'Check', tone: 'primary', to: 'published' },
  reject: { label: '驳回', icon: 'X', tone: 'danger', to: 'rejected' },
}

const COVERS = {
  paper: ['#EADFC8', '#CFC0A0'],
  night: ['#3D4A6B', '#26314A'],
  leaf: ['#CFE3CB', '#A6C6A0'],
  dusk: ['#F0D2BC', '#D8A98C'],
  ink: ['#D8DCE6', '#B3BACB'],
}

const coverColors = (post) => COVERS[post.cover?.tone] || COVERS.paper
const postAuthor = (post) => post.author || null
const postBook = (post) => post.book || null
const postClass = (post) => post.class || null

export default function Community({ postsByTab: injectedPostsByTab, books: injectedBooks, onReview } = {}) {
  const { workspace, prefs, setPref } = useConsole()
  const communityRuntime = useConsoleCommunityRuntime({ workspaceId: workspace?.id, className: workspace?.scopeLabel })
  const postsByTab = injectedPostsByTab || communityRuntime.postsByTab
  const books = useMemo(() => injectedBooks || communityRuntime.books, [communityRuntime.books, injectedBooks])
  const reviewPost = onReview || communityRuntime.review
  const hasClassScope = workspace?.hasClassScope ?? workspace?.scopeType === 'class'

  const tabs = [
    { key: 'pending', label: '待审核' },
    // 没有班级关系就不显示「班级」页签
    ...(hasClassScope ? [{ key: 'class', label: '班级' }] : []),
    { key: 'school', label: '学校' },
  ]
  const [tab, setTab] = useState('pending')
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'pending'

  const [keyword, setKeyword] = useState('')
  const [bookId, setBookId] = useState('all')
  const [status, setStatus] = useState('all')
  const [time, setTime] = useState('all')
  const [picked, setPicked] = useState([])
  const [openId, setOpenId] = useState(null)
  const [ask, setAsk] = useState(null)
  const [reviewError, setReviewError] = useState('')
  const view = prefs.viewMode || 'card'

  const all = useMemo(() => postsByTab?.[activeTab] || [], [activeTab, postsByTab])
  const counts = useMemo(
    () => Object.fromEntries(tabs.map((tabItem) => [tabItem.key, postsByTab?.[tabItem.key]?.length || 0])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [postsByTab],
  )

  const rows = useMemo(() => {
    const k = keyword.trim()
    return all.filter((p) => {
      if (bookId !== 'all' && p.bookId !== bookId) return false
      if (status !== 'all' && p.status !== status) return false
      if (time === 'today' && !p.at.startsWith('今天')) return false
      if (time === 'week' && !(p.at.startsWith('今天') || p.at.startsWith('昨天') || p.at.startsWith('8月'))) return false
      if (!k) return true
      const a = postAuthor(p)
      const b = postBook(p)
      return p.title.includes(k) || p.text.includes(k) || a?.name.includes(k) || b?.title.includes(k)
    })
  }, [all, keyword, bookId, status, time])

  const opened = all.find((p) => p.id === openId) || null
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const openReviewAction = (act, target) => {
    setReviewError('')
    setAsk({ act, target })
  }
  const closeReviewAction = () => {
    setReviewError('')
    setAsk(null)
  }

  // 学校社区默认教师一审、学校管理员二审：一审过了但还没二审的会在详情里说明下一处理人
  const reviewNote =
    activeTab === 'school'
      ? '学校社区默认教师一审、学校管理员二审；审核结构可由学校管理员与运营调整。'
      : activeTab === 'class'
        ? '班级社区由班级教师管理，通过后直接在本班可见。'
        : '这里只显示需要当前账号处理的内容；处理完会离开这一页。'

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前工作空间'} · 社区管理`}
      desc={`学生社区没有评论、私聊与点踩，互动只有一个「友善互动」计数。${reviewNote}`}
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索标题、正文、作者或书目" />
          <Select
            value={bookId}
            onChange={setBookId}
            options={[{ value: 'all', label: '全部书目' }, ...books.map((b) => ({ value: b.id, label: b.title }))]}
            width="w-[148px]"
          />
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: '全部状态' },
              ...Object.entries(POST_STATUS).map(([k, v]) => ({ value: k, label: v.label })),
            ]}
          />
          <Select value={time} onChange={setTime} options={TIME_OPTIONS} width="w-[116px]" />
          <ViewToggle value={view} onChange={(v) => setPref('viewMode', v)} />
        </>
      }
    >
      <Tabs
        value={activeTab}
        onChange={(k) => (setTab(k), setPicked([]))}
        items={tabs.map((t) => ({ ...t, count: counts[t.key] }))}
        className="mb-3.5"
      />

      {workspace && !hasClassScope && (
        <div className="mb-3.5 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-ink-50 border border-ink-150">
          <Icon name="Info" className="w-4 h-4 text-ink-500 mt-px shrink-0" strokeWidth={1.9} />
          <p className="text-[12px] text-ink-600 leading-relaxed">
            当前工作空间没有具体班级关系，因此不显示「班级」页签；班级社区由对应班级教师管理。
          </p>
        </div>
      )}

      {picked.length > 0 && (
        <div className="mb-3 flex items-center gap-2.5 h-10 px-3 rounded-lg bg-brand-50/80 border border-brand-100">
          <Icon name="CheckCheck" className="w-4 h-4 text-brand-600" strokeWidth={1.9} />
          <span className="text-[12.5px] text-brand-800">
            已选择 <span className="font-semibold tabular-nums">{picked.length}</span> 条内容
          </span>
          <div className="flex-1" />
          <span title="当前正式审核接口只支持逐条处理，批量审核暂未开放。">
            <Btn size="sm" tone="primary" icon="Check" disabled>
              批量通过
            </Btn>
          </span>
          <span title="当前正式审核接口只支持逐条处理，批量审核暂未开放。">
            <Btn size="sm" tone="danger" icon="X" disabled>
              批量驳回
            </Btn>
          </span>
          <Btn size="sm" tone="ghost" onClick={() => setPicked([])}>
            取消选择
          </Btn>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={activeTab === 'pending' ? 'CircleCheck' : 'Sparkles'}
          title={activeTab === 'pending' ? '没有待你处理的内容' : '没有符合条件的内容'}
          desc={
            activeTab === 'pending'
              ? '待审核列表清空了。学生新提交的内容会自动出现在这里。'
              : '换一个关键词，或把书目、状态、时间筛选放宽一些。'
          }
          action={
            activeTab !== 'pending' && (
              <Btn
                tone="primary"
                onClick={() => {
                  setKeyword('')
                  setBookId('all')
                  setStatus('all')
                  setTime('all')
                }}
              >
                清空筛选
              </Btn>
            )
          }
        />
      ) : view === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {rows.map((p) => (
            <CommunityPostCard
              key={p.id}
              post={p}
              checked={picked.includes(p.id)}
              onCheck={() => toggle(p.id)}
              onOpen={() => setOpenId(p.id)}
              showScope={activeTab === 'pending'}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2.5 font-medium w-[34px]" />
                <th className="px-2 py-2.5 font-medium">内容</th>
                <th className="px-2 py-2.5 font-medium w-[150px]">作者与班级</th>
                <th className="px-2 py-2.5 font-medium w-[132px]">书目</th>
                <th className="px-2 py-2.5 font-medium w-[80px]">互动</th>
                <th className="px-2 py-2.5 font-medium w-[104px]">状态</th>
                <th className="px-2 py-2.5 font-medium w-[112px]">时间</th>
                <th className="px-2 py-2.5 font-medium w-[52px] text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const st = POST_STATUS[p.status]
                const a = postAuthor(p)
                const c = postClass(p)
                const b = postBook(p)
                return (
                  <tr key={p.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={picked.includes(p.id)}
                        aria-label={`选择《${p.title}》`}
                        onClick={() => toggle(p.id)}
                        className={cx(
                          'w-4 h-4 rounded-[5px] border flex items-center justify-center transition',
                          picked.includes(p.id)
                            ? 'bg-brand-500 border-brand-500 text-white'
                            : 'bg-white/80 border-ink-300 hover:border-brand-300',
                        )}
                      >
                        {picked.includes(p.id) && <Icon name="Check" className="w-3 h-3" strokeWidth={3} />}
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => setOpenId(p.id)}
                        className="text-[13px] font-medium text-ink-900 hover:text-brand-600 transition flex items-center gap-1.5"
                      >
                        {p.pinned && <Icon name="Pin" className="w-3.5 h-3.5 text-accent-600" strokeWidth={2} />}
                        {p.featured && <Icon name="Star" className="w-3.5 h-3.5 text-warning-600" strokeWidth={2} />}
                        {p.title}
                      </button>
                      <p className="text-[11.5px] text-ink-500 truncate max-w-[420px]">{p.text}</p>
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px] text-ink-700">
                      {a?.name}
                      <span className="text-ink-400 text-[11.5px] ml-1.5">{c?.name}</span>
                    </td>
                    <td className="px-2 py-2.5 text-[12px] text-ink-600">《{b?.title}》</td>
                    <td className="px-2 py-2.5 text-[12.5px] text-ink-700 tabular-nums">{p.kudos}</td>
                    <td className="px-2 py-2.5">
                      <StatusTag tone={st.tone} dot>
                        {st.label}
                      </StatusTag>
                    </td>
                    <td className="px-2 py-2.5 text-[12px] text-ink-500">{p.at}</td>
                    <td className="px-2 py-2.5 text-right">
                      <IconBtn icon="Maximize2" title="打开审核详情" onClick={() => setOpenId(p.id)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 审核详情：大号圆角弹窗，含完整内容、引文、书目与审核历史 */}
      <ReviewModal post={opened} onClose={() => setOpenId(null)} onAct={(act) => openReviewAction(act, opened)} />

      <ConfirmModal
        open={!!ask}
        onClose={closeReviewAction}
        onConfirm={async () => {
          if (!ask?.target) return
          try {
            const saved = await reviewPost(ask.target, ask.act)
            if (!saved) {
              setReviewError('审核未保存，服务端拒绝或网络异常，请检查后重试。')
              return
            }
          } catch {
            setReviewError('审核未保存，服务端请求异常，请检查后重试。')
            return
          }
          closeReviewAction()
          setPicked([])
          setOpenId(null)
        }}
        tone={ask?.act === 'reject' ? 'danger' : 'primary'}
        confirmText={ask ? REVIEW_ACTIONS[ask.act].label : ''}
        title={
          ask
            ? `${REVIEW_ACTIONS[ask.act].label}《${ask.target?.title}》`
            : ''
        }
        desc={ask ? `${ACT_DESC[ask.act]}${reviewError ? ` ${reviewError}` : ''}` : ''}
      />
    </PagePanel>
  )
}

const ACT_DESC = {
  approve: '通过后内容会写入审核记录，并按班级或学校的审核层级进入对应可见状态。',
  reject: '未通过的内容不会进入社区展示，作者刷新后会看到真实审核状态与原因。',
}

function ReviewModal({ post, onClose, onAct }) {
  if (!post) return null
  const st = POST_STATUS[post.status]
  const a = postAuthor(post)
  const c = postClass(post)
  const b = postBook(post)
  const [c1, c2] = coverColors(post)

  // 当前服务端审核契约只支持对待审核内容逐条通过或驳回
  const acts = post.status === 'pending' ? ['approve', 'reject'] : []

  return (
    <Modal
      open
      onClose={onClose}
      icon="Sparkles"
      title={post.title}
      desc={`${a?.name} · ${c?.name} · ${post.scope === 'school' ? '学校社区' : '班级社区'} · ${post.at}`}
      width="max-w-[760px]"
      footer={
        <>
          <Btn onClick={onClose}>关闭</Btn>
          {acts.map((k) => {
            const act = REVIEW_ACTIONS[k]
            return (
              <Btn key={k} tone={act.tone} icon={act.icon} onClick={() => onAct(k)}>
                {act.label}
              </Btn>
            )
          })}
          {acts.length === 0 && (
            <span className="text-[11.5px] text-ink-400">当前状态没有可用的真实审核写入操作</span>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_248px] gap-5">
        <div className="min-w-0">
          <div
            className="rounded-xl h-[132px] relative overflow-hidden"
            style={{ backgroundImage: `linear-gradient(140deg, ${c1}, ${c2})` }}
          >
            <span className="console-sheen absolute inset-0" aria-hidden="true" />
            <span
              className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/45 via-black/15 to-transparent"
              aria-hidden="true"
            />
            {post.cover.type === 'image' ? (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-white/85">
                <Icon name="Image" className="w-6 h-6" strokeWidth={1.7} />
                <span className="text-[11.5px]">当前审核视图不加载原图</span>
              </span>
            ) : (
              post.quote && (
                <span className="absolute inset-x-4 bottom-3.5 text-white text-[13px] leading-snug drop-shadow">
                  「{post.quote.text}」
                </span>
              )
            )}
          </div>

          {post.quote && (
            <div className="mt-3 pl-3 py-2 rounded-r-lg border-l-[3px] border-accent-500 bg-accent-50/50">
              <p className="text-[11px] text-ink-500">
                引文 · 《{b?.title}》第 {post.quote.page} 页
              </p>
              <p className="text-[12.5px] text-ink-700 mt-0.5">{post.quote.text}</p>
            </div>
          )}

          <p className="text-[13px] text-ink-800 leading-[1.85] mt-3">{post.text}</p>

          <div className="mt-3.5 pt-3 border-t border-ink-150/70 flex items-center gap-3 flex-wrap">
            <StatusTag tone={st.tone} dot>
              {st.label}
            </StatusTag>
            {post.featured && <StatusTag tone="warning">精选</StatusTag>}
            {post.pinned && <StatusTag tone="accent">置顶</StatusTag>}
            <span className="inline-flex items-center gap-1 text-[12px] text-ink-500">
              <Icon name="Heart" className="w-3.5 h-3.5 text-accent-500" strokeWidth={1.9} />
              友善互动 <span className="tabular-nums font-medium text-ink-700">{post.kudos}</span>
            </span>
            <span className="text-[11.5px] text-ink-400">学生社区没有评论、私聊与点踩</span>
          </div>
        </div>

        <div className="min-w-0">
          <SubHead icon="History" title="审核历史" />
          <ol className="relative pl-4">
            <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-ink-150" aria-hidden="true" />
            {post.history.map((h, i) => (
              <li key={i} className="relative pb-3 last:pb-0">
                <span className="absolute -left-4 top-[6px] w-[11px] h-[11px] rounded-full bg-white border-2 border-brand-300" />
                <p className="text-[12.5px] text-ink-800">
                  <b className="font-semibold">{h.who}</b> {h.action}
                </p>
                <p className="text-[11px] text-ink-400 mt-0.5">{h.at}</p>
                {h.note && <p className="text-[11.5px] text-ink-500 mt-1 leading-relaxed">{h.note}</p>}
              </li>
            ))}
          </ol>

          {post.scope === 'school' && post.status === 'pending' && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-warning-50/70 border border-warning-100">
              <p className="text-[11.5px] text-ink-600 leading-relaxed">
                <b className="text-ink-800">下一处理人：</b>
                学校管理员（二审）。学校社区默认教师一审、管理员二审。
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
