import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassPanel } from '../../components/Glass.jsx'
import { Btn, EmptyState, IconBtn, SearchBox, StatusTag } from '../../components/Controls.jsx'
import { ConfirmModal } from '../../components/Overlay.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useConversationData from '../../state/useConversationData.js'
import usePrivacyEyeCareData from '../../state/usePrivacyEyeCareData.js'
import {
  booksFromConversationTree,
  buildConversationTree,
  REQUEST_STATE,
  SAFETY_CONTEXT_SPAN,
  SESSION_KIND,
  safetyWindow,
  sessionBook,
  sessionClass,
  sessionCount,
  sessionStudent,
  sessionTitle,
} from '../../state/conversationViewModel.js'

// 学生会话：中部长对话 + 右侧「同一根栏内三级逐层展开」的索引。
// 红线三条：右侧不是三根并排侧栏；底部书目约束选中即胶囊且可与／或组合；
// 页面只读 —— 教师文字永不写入原会话，出口只有「记录干预」「进入课堂引导」。

export default function Sessions() {
  const { workspace, operator } = useConsole()
  const workspaceId = workspace?.id
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [keyword, setKeyword] = useState('')
  const [bookIds, setBookIds] = useState([])
  const [bookOp, setBookOp] = useState('and')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [openClasses, setOpenClasses] = useState([])
  const [openStudents, setOpenStudents] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [ask, setAsk] = useState(null)
  // 右侧索引可收起：空间不足时不能让两根导航 + 索引把正文挤成细条
  const [idxOpen, setIdxOpen] = useState(true)
  const conversationQuery = useMemo(() => ({
    text: keyword,
    bookVersionIds: bookIds,
    bookMode: bookOp === 'and' ? 'AND' : 'OR',
  }), [bookIds, bookOp, keyword])
  const indexResource = useConversationData({
    workspaceId,
    query: conversationQuery,
  })
  const privacy = usePrivacyEyeCareData({ workspaceId })
  const indexTree = useMemo(
    () => buildConversationTree(indexResource.index.data, null, privacy.data?.requests),
    [indexResource.index.data, privacy.data?.requests],
  )
  const indexFlat = useMemo(() => indexTree.flatMap((g) => g.students.flatMap((s) => s.sessions)), [indexTree])
  const selectedSummary = indexFlat.find((session) => session.id === activeId) || indexFlat[0] || null
  const detailResource = useConversationData({
    workspaceId,
    ownerUserId: selectedSummary?.ownerUserId,
    conversationId: selectedSummary?.id,
    purpose: selectedSummary?.kind === 'safety' ? '学校安全处置最小上下文复核' : undefined,
  })
  const tree = useMemo(
    () => buildConversationTree(indexResource.index.data, detailResource.detail.data, privacy.data?.requests),
    [detailResource.detail.data, indexResource.index.data, privacy.data?.requests],
  )
  const books = useMemo(() => booksFromConversationTree(tree), [tree])
  const flat = useMemo(() => tree.flatMap((g) => g.students.flatMap((s) => s.sessions)), [tree])
  const active = flat.find((s) => s.id === activeId) || flat[0] || null

  // 从额度管理带 ?student= 进来时，自动展开到这名学生并选中他最近一段会话
  const studentParam = params.get('student')
  useEffect(() => {
    if (!studentParam) return
    const hit = tree.find((g) => g.students.some((s) => s.student.id === studentParam))
    if (!hit) return
    const group = hit.students.find((s) => s.student.id === studentParam)
    setOpenClasses((p) => (p.includes(hit.klass.id) ? p : [...p, hit.klass.id]))
    setOpenStudents((p) => (p.includes(studentParam) ? p : [...p, studentParam]))
    if (group.sessions[0]) setActiveId(group.sessions[0].id)
    const next = new URLSearchParams(params)
    next.delete('student')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentParam, tree])

  // 默认展开第一个班和第一名学生，右侧不至于一片折叠
  useEffect(() => {
    if (openClasses.length === 0 && tree[0]) {
      setOpenClasses([tree[0].klass.id])
      if (tree[0].students[0]) setOpenStudents([tree[0].students[0].student.id])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree])

  const toggleClass = (id) => setOpenClasses((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const toggleStudent = (id) => setOpenStudents((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const addBook = (id) => {
    setBookIds((p) => (p.includes(id) ? p : [...p, id]))
    setPickerOpen(false)
  }

  return (
    <div className="console-page-enter flex h-full min-h-0 gap-3">
      {/* ── 中部会话 ─────────────────────────── */}
      <GlassPanel tone="solid" className="console-page rounded-2xl flex-1 min-w-0 flex flex-col">
        {active ? (
          <>
            <ChatHead
              session={active}
              onGuide={(bookId) => navigate(`/console/teaching/reader/${bookId}`)}
              idxOpen={idxOpen}
              onToggleIdx={() => setIdxOpen((v) => !v)}
            />
            <div className="flex-1 min-h-0 relative">
              {active.kind === 'private' ? (
                <PrivateLock session={active} onAsk={setAsk} />
              ) : (
                <Stream session={active} viewer={operator?.displayName || '当前查看人'} navigate={navigate} />
              )}
            </div>
          </>
        ) : (
          <EmptyState
            className="my-auto"
            icon="MessagesSquare"
            title="没有符合条件的会话"
              desc={indexResource.index.status === 'loading'
                ? '正在读取当前权限范围内的真实会话。'
                : indexResource.index.error?.message || '清掉右侧的书目约束或换一个搜索词；跨班会话需要更高一级工作空间才能看到。'}
            action={
              <Btn
                tone="primary"
                onClick={() => {
                  setBookIds([])
                  setKeyword('')
                }}
              >
                清空筛选
              </Btn>
            }
          />
        )}
      </GlassPanel>

      {/* ── 右侧三级索引：同一根栏内逐层展开，可收起 ─── */}
      <GlassPanel
        tone="sub"
        className={cx('rounded-2xl w-[300px] shrink-0 flex flex-col', !idxOpen && 'hidden')}
      >
        <div className="shrink-0 px-3 pt-3 pb-2.5 border-b border-ink-150/70">
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜对话、学生、班级或书目" width="w-full" />
          <p className="text-[11px] text-ink-400 mt-2 leading-relaxed">
            班级 → 学生 → 对话 逐层展开，空间不足可从标题栏收起
          </p>
          <div className="flex items-center gap-3 mt-1.5">
            {Object.entries(SESSION_KIND).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-ink-400">
                <i className="w-1.5 h-1.5 rounded-full" style={{ background: v.dot }} />
                {v.label}
              </span>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto console-scroll p-2">
          {tree.length === 0 ? (
            <p className="text-[12px] text-ink-400 text-center py-8 px-3 leading-relaxed">
              当前筛选下没有会话。
              {bookIds.length > 1 && bookOp === 'and' && '「与」要求同一名学生同时读过全部所选书目，试试切成「或」。'}
            </p>
          ) : (
            tree.map((g) => (
              <div key={g.klass.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleClass(g.klass.id)}
                  className="w-full flex items-center gap-2 px-2.5 h-9 rounded-lg hover:bg-white/70 transition"
                >
                  <Icon
                    name="ChevronRight"
                    className={cx(
                      'w-3.5 h-3.5 text-ink-400 transition-transform duration-200',
                      openClasses.includes(g.klass.id) && 'rotate-90',
                    )}
                  />
                  <span className="text-[12.5px] font-semibold text-ink-800 flex-1 text-left truncate">
                    {g.klass.name}
                  </span>
                  <span className="text-[11px] text-ink-400 tabular-nums shrink-0">
                    {g.students.length} 人 · {g.total} 段
                  </span>
                </button>

                {openClasses.includes(g.klass.id) && (
                  <div className="ml-3.5 pl-2 border-l border-ink-150">
                    {g.students.map((sg) => (
                      <div key={sg.student.id}>
                        <button
                          type="button"
                          onClick={() => toggleStudent(sg.student.id)}
                          className="w-full flex items-center gap-2 px-2 h-8 rounded-lg hover:bg-white/70 transition"
                        >
                          <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] flex items-center justify-center shrink-0">
                            {sg.student.name.slice(0, 1)}
                          </span>
                          <span className="text-[12.5px] text-ink-700 flex-1 text-left truncate">
                            {sg.student.name}
                          </span>
                          <span className="flex items-center gap-[3px] shrink-0">
                            {Array.from(new Set(sg.sessions.map((s) => s.kind))).map((k) => (
                              <i
                                key={k}
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ background: SESSION_KIND[k].dot }}
                              />
                            ))}
                          </span>
                          <span className="text-[11px] text-ink-400 tabular-nums shrink-0 w-4 text-right">
                            {sg.sessions.length}
                          </span>
                        </button>

                        {openStudents.includes(sg.student.id) && (
                          <div className="ml-2.5 pl-2 border-l border-ink-150">
                            {sg.sessions.map((s) => (
                              <SessionRow
                                key={s.id}
                                session={s}
                                active={active?.id === s.id}
                                onPick={() => setActiveId(s.id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 底部书目约束：选中即胶囊，中间「与／或」可点切换 */}
        <div className="shrink-0 px-3 pt-2.5 pb-3 border-t border-ink-150/70">
          <p className="text-[11px] text-ink-400 mb-2">
            {bookIds.length === 0 ? '书目约束 · 未设置，显示范围内全部会话' : '书目约束 · 只看涉及这些书的会话'}
          </p>
          {bookIds.length === 0 ? null : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {bookIds.map((id, i) => {
                const b = books.find((x) => x.id === id)
                return (
                  <span key={id} className="inline-flex items-center gap-1.5">
                    {i > 0 && (
                      <button
                        type="button"
                        onClick={() => setBookOp((o) => (o === 'and' ? 'or' : 'and'))}
                        title="切换与／或"
                        className={cx(
                          'h-[22px] min-w-[26px] px-1.5 rounded-md text-[11px] font-semibold transition',
                          bookOp === 'and'
                            ? 'bg-ink-800 text-white'
                            : 'bg-white/80 border border-ink-200 text-ink-600 hover:border-ink-300',
                        )}
                      >
                        {bookOp === 'and' ? '与' : '或'}
                      </button>
                    )}
                    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-brand-50 border border-brand-200 text-[11.5px] text-brand-700">
                      《{b?.title || id}》
                      <button
                        type="button"
                        onClick={() => setBookIds((p) => p.filter((x) => x !== id))}
                        aria-label={`移除 ${b?.title}`}
                        className="w-3 h-3 rounded-full bg-brand-200 text-white flex items-center justify-center hover:bg-brand-500 transition"
                      >
                        <Icon name="X" className="w-2 h-2" strokeWidth={3.5} />
                      </button>
                    </span>
                  </span>
                )
              })}
            </div>
          )}

          <div className="relative mt-2">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="w-full h-8 px-2.5 rounded-lg border border-dashed border-ink-200 bg-ink-50 text-[11.5px] text-ink-400 text-left hover:border-brand-300 hover:text-brand-600 transition"
            >
              输入书名添加约束…
            </button>
            {pickerOpen && (
              <div className="absolute left-0 right-0 bottom-[38px] z-10 rounded-xl bg-white border border-ink-150 shadow-e3 p-1.5 max-h-[210px] overflow-y-auto console-scroll">
                <p className="text-[10.5px] text-ink-400 px-2 pt-1 pb-1.5">选中即变胶囊，已选的不再出现</p>
                {books.filter((b) => !bookIds.includes(b.id)).length === 0 ? (
                  <p className="text-[11.5px] text-ink-400 px-2 py-2">范围内的书目都已加入约束</p>
                ) : (
                  books
                    .filter((b) => !bookIds.includes(b.id))
                    .map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => addBook(b.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] text-ink-700 hover:bg-ink-50 transition text-left"
                      >
                        <span
                          className="w-3.5 h-[18px] rounded-[2px] shrink-0"
                          style={{ backgroundImage: `linear-gradient(150deg, ${b.cover[0]}, ${b.cover[1]})` }}
                        />
                        <span className="truncate">《{b.title}》</span>
                      </button>
                    ))
                )}
              </div>
            )}
          </div>

          {bookIds.length > 1 && (
            <p className="text-[10.5px] text-ink-400 mt-1.5 leading-relaxed">
              {bookOp === 'and'
                ? '「与」：只看同时读过这些书的学生的会话'
                : '「或」：看涉及任意一本所选书的会话'}
            </p>
          )}
        </div>
      </GlassPanel>

      <InterventionModal
        ask={ask}
        onClose={() => setAsk(null)}
        session={active}
        onRequest={privacy.createAccessRequest}
        actionState={privacy.actionState}
      />
    </div>
  )
}

// 索引里的一条会话：私密不显示自动标题
function SessionRow({ session, active, onPick }) {
  const kind = SESSION_KIND[session.kind]
  const book = sessionBook(session)
  return (
    <button
      type="button"
      onClick={onPick}
      className={cx(
        'w-full text-left px-2 py-1.5 rounded-lg border transition mb-0.5',
        active ? 'bg-brand-50 border-brand-200' : 'border-transparent hover:bg-white/70',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cx(
            'text-[12.5px] font-semibold flex-1 truncate',
            session.kind === 'private' ? 'text-ink-500' : 'text-ink-800',
          )}
        >
          {sessionTitle(session)}
        </span>
        <StatusTag tone={kind.tone} className="shrink-0 h-[18px] px-1.5 text-[10.5px]">
          {kind.label}
        </StatusTag>
      </div>
      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-ink-400 tabular-nums">
        {session.kind !== 'private' && (
          <span className="bg-ink-100 rounded px-1">#{session.no.slice(-4)}</span>
        )}
        <span className="text-ink-500 truncate">《{book?.title}》</span>
        <span className="shrink-0">{session.lastAt.replace('今天 ', '今天')}</span>
        <span className="shrink-0">{sessionCount(session)} 条</span>
      </div>
    </button>
  )
}

// 标题栏：五要素齐全 + 教师可进入课堂引导
function ChatHead({ session, onGuide, idxOpen, onToggleIdx }) {
  const kind = SESSION_KIND[session.kind]
  const stu = sessionStudent(session)
  const cls = sessionClass(session)
  const book = sessionBook(session)

  const trace =
    session.kind === 'private'
      ? '锁定状态下连自动生成的标题也不显示（标题本身可能泄露内容），统一显示为「私密会话 #编号」。'
      : session.kind === 'safety'
        ? `安全会话只开放触发消息与前后各 ${SAFETY_CONTEXT_SPAN} 条的最小必要上下文；涉事人员不得访问，查看行为全部记入审计。`
        : '标题由系统按首条提问自动生成，普通会话不额外调用模型生成主题摘要；本次查看已记录访问人与时间。'

  return (
    <div className="shrink-0 px-5 pt-4 pb-3 border-b border-ink-150">
      {/* 不换行：标题过长就截断，两个动作必须留在标题行右侧，
          否则被挤到下一行会看起来像页面级操作 */}
      <div className="flex items-center gap-2.5 min-w-0">
        <h1
          title={sessionTitle(session)}
          className={cx(
            'font-serif text-[17px] font-bold truncate min-w-0',
            session.kind === 'private' ? 'text-ink-600' : 'text-ink-900',
          )}
        >
          {sessionTitle(session)}
        </h1>
        <span
          title={`完整编号 ${session.no}`}
          className="text-[11.5px] text-ink-400 tabular-nums bg-ink-100 rounded px-1.5 py-0.5 shrink-0"
        >
          #{session.no.slice(-4)}
        </span>
        <StatusTag tone={kind.tone} dot className="shrink-0">
          {kind.label}
        </StatusTag>
        <div className="flex-1" />
        <span title="干预记录写入接口暂未开放，当前不会创建未保存的记录。">
          <Btn size="sm" icon="ClipboardPen" className="shrink-0" disabled>
            记录干预
          </Btn>
        </span>
        <Btn size="sm" icon="BookOpen" className="shrink-0" onClick={() => onGuide(session.bookId)}>
          进入课堂引导
        </Btn>
        <IconBtn
          icon={idxOpen ? 'PanelRightClose' : 'PanelRightOpen'}
          title={idxOpen ? '收起右侧会话索引' : '展开右侧会话索引'}
          onClick={onToggleIdx}
          className="shrink-0"
        />
      </div>

      <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-[12px] text-ink-500 flex-wrap">
        <span>
          书籍 <b className="font-semibold text-ink-700">《{book?.title}》</b>
        </span>
        <span>
          学生 <b className="font-semibold text-ink-700">{stu?.name}</b>
        </span>
        <span>
          班级 <b className="font-semibold text-ink-700">{cls?.name}</b>
        </span>
        <span>
          编号 <b className="font-semibold text-ink-700 tabular-nums">{session.no}</b>
        </span>
        <span>
          最近 {session.lastAt} · {sessionCount(session)} 条消息
          {session.kind === 'private' && ` · ${REQUEST_STATE[session.request].label}`}
        </span>
      </div>

      <div className="mt-2.5 flex items-start gap-2 px-3 py-2 rounded-lg bg-ink-50 border border-ink-150">
        <span className="w-1.5 h-1.5 rounded-full bg-ink-400 mt-[7px] shrink-0" />
        <p className="text-[11.5px] text-ink-500 leading-relaxed">{trace}</p>
      </div>
    </div>
  )
}

// 会话正文。教师只读：整页没有输入框，这是拍板过的硬规则
function Stream({ session, viewer, navigate }) {
  const isSafety = session.kind === 'safety'
  const win = isSafety ? safetyWindow(session) : { list: session.messages, before: 0, after: 0 }
  const stu = sessionStudent(session)
  const stamp = session.watermark || viewer

  return (
    <div className="absolute inset-0 overflow-y-auto console-scroll px-5 py-4">
      {/* 查看水印：谁在什么时候看过，落在正文上但不影响阅读 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.055] select-none">
        {[
          ['6%', '10%'],
          ['54%', '30%'],
          ['14%', '56%'],
          ['58%', '80%'],
        ].map(([left, top]) => (
          <span
            key={`${left}${top}`}
            className="absolute text-[15px] font-semibold whitespace-nowrap"
            style={{ left, top, transform: 'rotate(-26deg)' }}
          >
            {stamp}
          </span>
        ))}
      </div>

      {isSafety && (
        <div className="relative mb-4 px-3.5 py-2.5 rounded-xl bg-danger-50/80 border border-danger-100">
          <div className="flex items-start gap-2.5">
            <Icon name="ShieldAlert" className="w-4 h-4 text-danger-600 mt-px shrink-0" strokeWidth={1.9} />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-bold text-danger-700">
                已关联安全复核 {session.eventId || ''}
                {session.risk && session.eventState ? `（${session.risk} · ${session.eventState}）` : ''}
              </p>
              <p className="text-[12px] text-ink-600 leading-relaxed mt-1">
                默认只展开<b>触发消息及其前后各 {SAFETY_CONTEXT_SPAN} 条</b>（最多{' '}
                {SAFETY_CONTEXT_SPAN * 2 + 1} 条），不自动展开无关历史。若该会话同时是私密会话，
                <b>安全处理规则优先</b>：授权处理人填写用途后直接查看，不等待学生同意；查看全程带水印并留痕，涉事教师自动回避。
              </p>
            </div>
            <Btn size="sm" tone="ghost" icon="ArrowRight" disabled={!session.eventId} onClick={() => navigate(`/console/safety/${session.eventId}`)}>
              事件详情
            </Btn>
          </div>
        </div>
      )}

      {!isSafety && <p className="relative text-center text-[11px] text-ink-400 mb-4">{session.day}</p>}
      {win.before > 0 && <CutLine text={`此前 ${win.before} 条消息未展开`} />}

      {win.list.map((m, i) => (
        <div key={i} className="relative" style={{ marginBottom: 18 }}>
          <div className="flex items-center gap-2 mb-1.5 text-[11.5px] text-ink-400">
            <span
              className={cx(
                'w-[19px] h-[19px] rounded-full text-[10px] text-white flex items-center justify-center shrink-0',
                m.role === 'stu' ? 'bg-gradient-to-br from-[#F3B76B] to-[#EC8A4C]' : 'bg-gradient-to-br from-[#8E9CF0] to-[#3C6FE0]',
              )}
            >
              {m.role === 'stu' ? stu?.name.slice(0, 1) : '伴'}
            </span>
            <b className="font-semibold text-ink-600">{m.role === 'stu' ? stu?.name : '读伴'}</b>
            <span>{m.at}</span>
            {m.trigger && (
              <span className="text-[10.5px] font-semibold text-danger-600 bg-danger-50 rounded px-1.5 py-px">
                触发消息
              </span>
            )}
          </div>

          {m.quote && (
            <div className="mb-2 pl-3 pr-3 py-2 rounded-r-lg border-l-[3px] border-accent-500 bg-accent-50/50">
              <p className="text-[11px] text-ink-500 mb-1">
                选中原文 · <span className="font-semibold text-accent-600">第 {m.quote.page} 页 {m.quote.chapter}</span>
              </p>
              <p className="text-[12.5px] text-ink-700 leading-relaxed">{m.quote.text}</p>
            </div>
          )}

          <div
            className={cx(
              'rounded-xl px-3.5 py-2.5 text-[13px] leading-[1.75] text-ink-800 border',
              m.role === 'stu' ? 'bg-[#FBF7F1] border-[#F0E6D8]' : 'bg-[#F7F9FE] border-brand-100',
              m.trigger && 'ring-[1.5px] ring-danger-100',
            )}
          >
            {m.text}
            {m.cite && (
              <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-white border border-dashed border-ink-200">
                <p className="text-[11px] text-ink-400">引用书内内容 · 第 {m.cite.page} 页</p>
                <p className="text-[12px] text-ink-600 mt-0.5">「{m.cite.text}」</p>
              </div>
            )}
          </div>
        </div>
      ))}

      {win.after > 0 && <CutLine text={`其后 ${win.after} 条消息未展开`} />}

      {isSafety && (
        <div className="relative flex items-center justify-center gap-2 flex-wrap mt-5 mb-2">
          <Btn tone="danger" icon="Hand" onClick={() => navigate(`/console/safety/${session.eventId}`)}>
            打开事件详情
          </Btn>
          <span title="更多上下文与用途留痕需在安全事件详情完成。">
            <Btn icon="FileSearch" disabled>
              更多上下文
            </Btn>
          </span>
          <span title="误报关闭需在安全事件详情填写说明后提交。">
            <Btn icon="CircleSlash" disabled>
              标记误报
            </Btn>
          </span>
        </div>
      )}

      {!isSafety && (
        <p className="relative text-center text-[11px] text-ink-400 pt-2 pb-1">
          教师只读：本页没有输入框，教师文字不会写入学生与读伴的原始对话
        </p>
      )}
    </div>
  )
}

function CutLine({ text }) {
  return (
    <div className="relative flex items-center gap-2.5 my-4 text-[11px] text-ink-400">
      <span className="h-px flex-1 bg-ink-150" />
      {text}
      <span className="h-px flex-1 bg-ink-150" />
    </div>
  )
}

// 私密会话锁定态：可见字段与隐藏字段都写清楚，不给猜的空间
function PrivateLock({ session, onAsk }) {
  const req = REQUEST_STATE[session.request] || REQUEST_STATE.none
  return (
    <div className="absolute inset-0 overflow-y-auto console-scroll px-5 py-4">
      <div className="mx-auto max-w-[460px] my-10 text-center px-6 py-7 rounded-2xl bg-ink-50 border border-ink-150">
        <span className="w-[46px] h-[46px] rounded-2xl bg-[#F0ECFB] text-[#7C6BD8] flex items-center justify-center mx-auto mb-3.5">
          <Icon name="Lock" className="w-[23px] h-[23px]" strokeWidth={1.75} />
        </span>
        <h3 className="text-[15px] font-bold text-ink-800">私密会话 #{session.no.slice(-4)}</h3>
        <p className="text-[12.5px] text-ink-500 leading-[1.8] mt-2">
          学生把这段对话设为私密，教师与学校管理员<b className="text-ink-700">不能直接查看内容</b>。
          <br />
          你可以向学生发起查看申请并说明用途；学生同意后才会展开，逾时未回应按学校配置处理。
        </p>
        <div className="mt-3">
          <StatusTag tone={req.tone} dot>
            {req.label}
          </StatusTag>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Btn
            tone="primary"
            disabled={session.request === 'pending'}
            onClick={() => onAsk({ kind: 'request' })}
          >
            {session.request === 'pending' ? '申请已发出，等待学生' : '申请查看并填写用途'}
          </Btn>
          <Btn onClick={() => onAsk({ kind: 'rule' })}>查看申请规则</Btn>
        </div>
        <p className="text-[11.5px] text-ink-400 mt-3.5 leading-relaxed">
          可见：学生、班级、会话编号、关联书籍、创建或最近时间、消息数量、申请状态。
          <br />
          隐藏：正文、消息片段、选中原文、AI 回复与<b className="text-ink-500">自动生成标题</b>。
        </p>
      </div>
    </div>
  )
}

// 私密申请由学生处理；本页只向学生端提交真实查看申请
function InterventionModal({ ask, onClose, session, onRequest, actionState }) {
  if (!ask || !session) return null

  const MAP = {
    request: {
      title: '向学生申请查看这段私密会话',
      desc: actionState?.error?.message || '本次用途为「教学关怀核查，确认学生阅读支持需求」。申请会真实写入并由学生同意、拒绝或按学校规则超时处理。',
      confirmText: '发出申请',
      tone: 'primary',
    },
    rule: {
      title: '私密会话的查看规则',
      desc: '普通会话授权范围内可直接查看并自动留痕；私密会话必须申请；被安全标记后，学校管理员可填写用途直接查看。涉事人员一律不得访问。',
      confirmText: '我知道了',
      tone: 'primary',
    },
  }
  const cfg = MAP[ask.kind]
  if (!cfg) return null

  return (
    <ConfirmModal
      open
      onClose={onClose}
      onConfirm={async () => {
        if (ask.kind === 'request') {
          await onRequest(session.id, '教学关怀核查，确认学生阅读支持需求')
        }
        onClose()
      }}
      title={cfg.title}
      desc={cfg.desc}
      confirmText={cfg.confirmText}
      tone={cfg.tone}
    />
  )
}
