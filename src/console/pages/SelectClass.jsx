import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createConsoleApi } from '../../api/console.js'
import { createIdentityConsoleApi } from './accounts/identityApi.js'
import {
  applyWriteTeacherCount,
  joinedClassIdsFromWorkspaces,
  stageLabel,
  teacherCountLabel,
  teacherJoinConfirmMessage,
  teacherJoinNeedsConfirm,
  unwrapList,
} from './accounts/identityUi.js'
import { GlassPanel } from '../components/Glass.jsx'
import { Btn, EmptyState } from '../components/Controls.jsx'
import { ConfirmModal } from '../components/Overlay.jsx'
import { useApiResource } from '../../api/useApiResource.js'
import { BrandMark } from '../components/BrandMark.jsx'

const identityApi = createIdentityConsoleApi()
const consoleApi = createConsoleApi()

const GRADE_LABELS = Object.freeze(['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'])

export default function SelectClass() {
  const navigate = useNavigate()
  const load = useCallback(async () => {
    const [directory, workspaces] = await Promise.all([
      identityApi.getTeacherClassDirectory(),
      consoleApi.listWorkspaces(),
    ])
    return {
      data: {
        classes: unwrapList(directory.data),
        joinedClassIds: joinedClassIdsFromWorkspaces(workspaces.data),
      },
      meta: directory.meta,
    }
  }, [])
  const resource = useApiResource(load)
  const [items, setItems] = useState(null)
  const [joinedIds, setJoinedIds] = useState(null)
  const [pending, setPending] = useState(null)
  const [joiningId, setJoiningId] = useState(null)
  const [leavingId, setLeavingId] = useState(null)
  const [error, setError] = useState('')
  const [joined, setJoined] = useState(false)
  const [selectedGrade, setSelectedGrade] = useState('')

  const classes = items ?? resource.data?.classes ?? []
  const joinedSet = joinedIds ?? new Set(resource.data?.joinedClassIds ?? [])

  const joinable = useMemo(
    () => classes.filter((klass) => klass.lifecycle !== 'graduated' && klass.status === 'active'),
    [classes],
  )
  const visible = useMemo(
    () => {
      if (!selectedGrade) return []
      return joinable.filter((klass) => klass.currentGrade === selectedGrade)
    },
    [joinable, selectedGrade],
  )

  function currentClasses() {
    return items ?? resource.data?.classes ?? []
  }

  function withJoinedSet(mutate) {
    setJoinedIds((current) => {
      const next = new Set(current ?? resource.data?.joinedClassIds ?? [])
      mutate(next)
      return next
    })
  }

  async function putJoin(klass) {
    setJoiningId(klass.id)
    setError('')
    try {
      const response = await identityApi.joinTeacherClass(klass.id)
      const teacherCount = response.data?.teacherCount
      setItems(applyWriteTeacherCount(currentClasses(), klass.id, teacherCount))
      withJoinedSet((next) => next.add(klass.id))
      setJoined(true)
    } catch (cause) {
      setError(cause?.message || '加入班级失败')
    } finally {
      setJoiningId(null)
      setPending(null)
    }
  }

  async function putLeave(klass) {
    setLeavingId(klass.id)
    setError('')
    try {
      const response = await identityApi.leaveTeacherClass(klass.id)
      const teacherCount = response.data?.teacherCount
      setItems(applyWriteTeacherCount(currentClasses(), klass.id, teacherCount))
      withJoinedSet((next) => next.delete(klass.id))
    } catch (cause) {
      setError(cause?.message || '退出班级失败')
    } finally {
      setLeavingId(null)
    }
  }

  function requestJoin(klass) {
    if (teacherJoinNeedsConfirm(klass.teacherCount)) {
      setPending(klass)
      return
    }
    putJoin(klass)
  }

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center px-6 py-12">
      <GlassPanel tone="crystal" sheen className="w-full max-w-[720px] rounded-[32px] px-8 py-10">
        <BrandMark size={36} textClass="text-[28px] leading-none" />
        <h1 className="font-serif text-[28px] font-bold text-ink-900 mt-6">选择任教班级</h1>
        <p className="text-[13px] text-ink-500 mt-2 leading-relaxed">
          教师加入班级后立即生效，不经过审批。可加入本校多个班级，也可退出已加入的班级。退出最后一班后仍留在本页。
        </p>

        {resource.status === 'error' ? (
          <EmptyState icon="TriangleAlert" title="班级目录加载失败" desc={resource.error?.message || '服务端拒绝了这次请求。'} />
        ) : joinable.length === 0 ? (
          <EmptyState
            icon="Users"
            title={resource.status === 'loading' ? '正在读取可加入班级' : '当前没有可加入的班级'}
            desc={resource.status === 'loading' ? '正在读取本校未毕业班级。' : '请联系校长或年级主任先预制班级。'}
          />
        ) : (
          <>
            <label className="mt-6 block">
              <span className="mb-2 block text-[12.5px] text-ink-500">选择年级</span>
              <select
                className="h-10 w-full rounded-xl border border-ink-150 bg-white/70 px-3 text-[13px] text-ink-800 outline-none"
                value={selectedGrade === '' ? '' : String(selectedGrade)}
                onChange={(event) => {
                  const raw = event.target.value
                  setSelectedGrade(raw === '' ? '' : Number(raw))
                }}
                aria-label="选择年级"
              >
                <option value="">请选择年级</option>
                {GRADE_LABELS.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {!selectedGrade && (
              <p className="mt-3 text-[12.5px] text-ink-500">请先选择年级，再加入该年级的班级。</p>
            )}
            {selectedGrade && (
              visible.length === 0 ? (
                <EmptyState icon="Users" title="该年级没有可加入的班级" desc="可改选其他年级，或联系校长、年级主任先预制班级。" />
              ) : (
                <ul className="mt-6 space-y-2.5">
                  {visible.map((klass) => {
                    const isJoined = joinedSet.has(klass.id)
                    return (
                      <li key={klass.id} className="flex items-center gap-3 rounded-xl border border-ink-150 bg-white/70 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] font-semibold text-ink-900">{klass.name}</div>
                          <div className="text-[11.5px] text-ink-500 mt-0.5">
                            {stageLabel(klass.stage)} · {klass.entryYear} 届 · {klass.classNumber} 班
                          </div>
                          <div className="text-[11.5px] text-ink-600 mt-1">{teacherCountLabel(klass.teacherCount)}</div>
                        </div>
                        {isJoined ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[12px] font-medium text-[#3E9E8F]">已加入</span>
                            <Btn
                              tone="danger"
                              disabled={leavingId === klass.id}
                              onClick={() => putLeave(klass)}
                            >
                              {leavingId === klass.id ? '退出中…' : '退出'}
                            </Btn>
                          </div>
                        ) : (
                          <Btn
                            tone="primary"
                            disabled={joiningId === klass.id}
                            onClick={() => requestJoin(klass)}
                          >
                            {joiningId === klass.id ? '加入中…' : '加入'}
                          </Btn>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )
            )}
          </>
        )}
        {error && <p className="mt-3 text-[12.5px] text-danger-600">{error}</p>}
        {(joined || joinedSet.size > 0) && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-ink-600">
              {joinedSet.size > 0
                ? '已加入。人数已按服务端写后 teacherCount 刷新，可继续选班或退出。'
                : '已退出全部任教班级，仍留在本页。'}
            </p>
            {joinedSet.size > 0 && (
              <Btn tone="primary" onClick={() => navigate('/console/home', { replace: true })}>进入控制台</Btn>
            )}
          </div>
        )}
      </GlassPanel>

      <ConfirmModal
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => pending && putJoin(pending)}
        title="加入已有教师的班级"
        desc={pending ? teacherJoinConfirmMessage(pending.teacherCount) : ''}
        confirmText="确认加入"
        tone="primary"
      />
    </div>
  )
}
