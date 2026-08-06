import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../components/ui.jsx'
import { GlassCard } from '../components/Glass.jsx'
import { PagePanel } from '../components/PagePanel.jsx'
import { Btn, Field, IconBtn, StatusTag, SubHead } from '../components/Controls.jsx'
import { ConfirmModal, Modal } from '../components/Overlay.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'
import {
  ASSIST_REQUEST_STATE,
  ASSIST_TIMEOUT_LABEL,
  HELP_LINKS,
  NOTIFY_PREFS,
  PROFILE,
  SECURITY,
  TRUSTED,
  TRUSTED_RULES,
  TRUSTED_STATE,
} from '../data/fixtures/me.js'

// 个人主页：顶部资料 + 密码管理 / 可信辅助账号 / 个性化 / 通知偏好 / 帮助与反馈五组。
//
// 「可信辅助账号」的定义是拍板过的（Codex 第 78 轮）：忘记密码时可以请求其确认身份
// 并放行「一次性登录」的预设可信人员，不拥有代操作权限，也看不到密码。
// 页面上必须把这句话写出来，否则很容易被当成「可以替我操作的人」。

const AVATAR_TONE = {
  brand: 'bg-gradient-to-br from-[#8E9CF0] to-[#3C6FE0]',
  cyan: 'bg-gradient-to-br from-[#67D4C6] to-[#2E8C86]',
  violet: 'bg-gradient-to-br from-[#B3A4EE] to-[#7C6BD8]',
  muted: 'bg-gradient-to-br from-[#C6CBD8] to-[#8A94AD]',
}

export default function Me() {
  const { workspace, prefs, setPref, togglePref, assistRequests, answerAssistRequest } = useConsole()
  const navigate = useNavigate()
  const [notify, setNotify] = useState(() =>
    Object.fromEntries(NOTIFY_PREFS.map((n) => [n.key, { inApp: n.inApp, sms: n.sms }])),
  )
  const [modal, setModal] = useState(null)
  const [removing, setRemoving] = useState(null)

  const toggleNotify = (key, field) =>
    setNotify((m) => ({ ...m, [key]: { ...m[key], [field]: !m[key][field] } }))

  return (
    <PagePanel
      title="个人主页"
      desc="账号、密码、可信辅助账号与通知偏好都在这里；权限与数据范围由学校管理员分配，不在本页修改。"
      toolbar={
        <>
          <Btn icon="LayoutDashboard" onClick={() => navigate('/console/home')}>
            回到首页
          </Btn>
          <Btn tone="primary" icon="PenLine" onClick={() => setModal('profile')}>
            编辑资料
          </Btn>
        </>
      }
    >
      {/* 顶部资料 */}
      <GlassCard className="console-enter p-4 rounded-xl">
        <div className="flex items-start gap-4 flex-wrap">
          <span
            className={cx(
              'w-[68px] h-[68px] rounded-2xl flex items-center justify-center text-[26px] font-semibold text-white shrink-0 shadow-e1',
              AVATAR_TONE.brand,
            )}
          >
            {PROFILE.name.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-x-8">
            <div>
              <Field label="姓名">
                <span className="font-medium">{PROFILE.fullName}</span>
                <span className="text-ink-400">（{PROFILE.name}）</span>
              </Field>
              <Field label="账号">
                <span className="tabular-nums">{PROFILE.account}</span>
              </Field>
              <Field label="手机号">
                <span className="tabular-nums">{PROFILE.phone}</span>
                <StatusTag tone="success" dot className="ml-2">
                  已验证
                </StatusTag>
              </Field>
            </div>
            <div>
              <Field label="所属学校">{PROFILE.school}</Field>
              <Field label="当前身份">{PROFILE.duty}</Field>
              <Field label="工作空间">
                {PROFILE.workspaceCount} 个 · 当前「{workspace.name}」
                <span className="text-ink-400">（在右上角头像菜单里切换）</span>
              </Field>
            </div>
          </div>
        </div>
        <p className="mt-3 pt-2.5 border-t border-ink-150/70 text-[11.5px] text-ink-500">
          最近登录：{PROFILE.lastLogin} · 入职 {PROFILE.joinedAt}
        </p>
      </GlassCard>

      <div className="mt-3.5 grid grid-cols-1 xl:grid-cols-2 gap-3.5 items-start">
        {/* 密码管理 */}
        <GlassCard className="console-enter p-4 rounded-xl">
          <SubHead
            icon="KeyRound"
            title="密码管理"
            extra={
              <Btn size="sm" icon="RefreshCcw" onClick={() => setModal('password')}>
                修改密码
              </Btn>
            }
          />
          <Field label="上次修改" labelWidth="w-[68px]">
            {SECURITY.passwordChangedAt}
            <span className="text-ink-400">（{SECURITY.passwordAge}）</span>
          </Field>
          <Field label="强度" labelWidth="w-[68px]">
            <StatusTag tone={SECURITY.strength.tone} dot>
              {SECURITY.strength.label}
            </StatusTag>
            <span className="text-ink-500 ml-2">{SECURITY.strength.note}</span>
          </Field>

          <p className="text-[11.5px] text-ink-400 mt-2.5 mb-1.5">最近登录记录</p>
          <ul className="space-y-1">
            {SECURITY.loginRecords.map((r) => (
              <li key={r.at} className="flex items-center gap-2 text-[12px] text-ink-600">
                <Icon name="MonitorSmartphone" className="w-3.5 h-3.5 text-ink-400 shrink-0" strokeWidth={1.8} />
                <span className="tabular-nums">{r.at}</span>
                <span className="truncate">{r.device}</span>
                <span className="text-ink-400 truncate">{r.place}</span>
              </li>
            ))}
          </ul>

          <p className="text-[11.5px] text-ink-400 mt-2.5 mb-1.5">辅助登录记录</p>
          {SECURITY.assistLogins.map((a) => (
            <p key={a.at} className="text-[12px] text-ink-600 leading-relaxed">
              {a.at} 由 <b className="text-ink-800">{a.by}</b> 放行一次性登录 · {a.device}
              <span className="text-ink-400">（{a.note}）</span>
            </p>
          ))}
        </GlassCard>

        {/* 可信辅助账号 */}
        <GlassCard className="console-enter p-4 rounded-xl">
          <SubHead
            icon="UsersRound"
            title={`可信辅助账号（${TRUSTED.filter((t) => t.state === 'active').length} 位有效）`}
            extra={
              <Btn size="sm" icon="UserRoundPlus" onClick={() => setModal('trusted')}>
                添加
              </Btn>
            }
          />
          <p className="text-[12px] text-ink-600 leading-relaxed bg-ink-50 border border-ink-150 rounded-lg px-3 py-2">
            <b className="text-ink-800">这是什么：</b>
            忘记密码时，可以请他们确认你的身份并放行一次<b>一次性登录</b>。他们
            <b className="text-ink-800">不能代替你操作</b>，也<b className="text-ink-800">看不到你的密码</b>。
          </p>

          <ul className="mt-2.5 space-y-1.5">
            {TRUSTED.map((t) => {
              const s = TRUSTED_STATE[t.state]
              const off = t.state === 'disabled'
              return (
                <li
                  key={t.id}
                  className={cx(
                    'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
                    off ? 'border-ink-200 bg-ink-50' : 'border-ink-150 bg-white/70',
                  )}
                >
                  <span
                    className={cx(
                      'w-8 h-8 rounded-xl flex items-center justify-center text-[13px] font-semibold text-white shrink-0',
                      AVATAR_TONE[t.tone],
                      off && 'opacity-60',
                    )}
                  >
                    {t.initial}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cx('text-[13px] font-semibold', off ? 'text-ink-500' : 'text-ink-900')}>
                        {t.name}
                      </span>
                      <StatusTag tone={s.tone} dot>
                        {s.label}
                      </StatusTag>
                    </div>
                    <p className="text-[11.5px] text-ink-500 mt-0.5">
                      {t.duty} · {t.school}
                    </p>
                    <p className="text-[11px] text-ink-400 mt-0.5">
                      添加于 {t.addedAt} · 最近辅助登录 {t.lastAssist}
                      {t.disabledNote && ` · ${t.disabledNote}`}
                    </p>
                  </div>
                  <IconBtn icon="UserRoundMinus" title={`移除 ${t.name}`} tone="danger" onClick={() => setRemoving(t)} />
                </li>
              )
            })}
          </ul>

          <ul className="mt-2.5 pt-2.5 border-t border-ink-150/70 space-y-1">
            {TRUSTED_RULES.slice(1).map((r) => (
              <li key={r} className="flex items-start gap-1.5 text-[11.5px] text-ink-500 leading-relaxed">
                <Icon name="Check" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#3E9E8F]" strokeWidth={2.4} />
                {r}
              </li>
            ))}
          </ul>
        </GlassCard>

        {/* 收到的辅助请求（Plan_2 P3）：与全局小窗共用一份状态，在哪里处理都一致 */}
        <GlassCard className="console-enter p-4 rounded-xl">
          <SubHead
            icon="Inbox"
            title={`收到的辅助请求（${assistRequests.filter((r) => r.state === 'pending').length} 条待确认）`}
          />
          <p className="text-[12px] text-ink-600 leading-relaxed bg-ink-50 border border-ink-150 rounded-lg px-3 py-2">
            <b className="text-ink-800">这是什么：</b>
            其他人把你设为可信辅助账号后，他们忘密码时发起的请求会到这里（同时弹全局小窗）。
            你确认后只会放行<b className="text-ink-800">一次登录</b>；{ASSIST_TIMEOUT_LABEL}，
            <b className="text-ink-800">超时只会失效，不会自动同意</b>。
          </p>

          <ul className="mt-2.5 space-y-1.5">
            {assistRequests.map((r) => {
              const st = ASSIST_REQUEST_STATE[r.state]
              const waiting = r.state === 'pending'
              return (
                <li
                  key={r.id}
                  className={cx(
                    'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
                    waiting ? 'border-warning-200 bg-warning-50/60' : 'border-ink-150 bg-white/70',
                  )}
                >
                  <span
                    className={cx(
                      'w-8 h-8 rounded-xl flex items-center justify-center text-[13px] font-semibold text-white shrink-0',
                      AVATAR_TONE[r.tone],
                      !waiting && 'opacity-70',
                    )}
                  >
                    {r.initial}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-ink-900">{r.name}</span>
                      <StatusTag tone={st.tone} dot>
                        {st.label}
                      </StatusTag>
                    </div>
                    <p className="text-[11.5px] text-ink-500 mt-0.5">{r.duty}</p>
                    {/* break-all 会把「8月2日 14:22」这种时间从中间拆开，
                        只让长账号自己可断，其余片段整体不拆 */}
                    <p className="text-[11px] text-ink-400 mt-0.5 leading-relaxed">
                      <span>申请账号 </span>
                      <span className="break-all">{r.account}</span>
                      <span className="whitespace-nowrap"> · {r.device}</span>
                      <span className="whitespace-nowrap"> · {r.at}</span>
                      {r.handledAt && <span className="whitespace-nowrap"> · 处理于 {r.handledAt}</span>}
                    </p>
                    <p className="text-[11px] text-ink-500 mt-0.5">{r.reason}</p>
                  </div>
                  {waiting ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Btn size="sm" tone="primary" onClick={() => answerAssistRequest(r.id, 'approved')}>
                        同意
                      </Btn>
                      <Btn size="sm" tone="danger" onClick={() => answerAssistRequest(r.id, 'rejected')}>
                        拒绝
                      </Btn>
                    </div>
                  ) : (
                    <span className="text-[11px] text-ink-400 shrink-0 pt-1">已完结</span>
                  )}
                </li>
              )
            })}
          </ul>
        </GlassCard>

        {/* 个性化：真的接偏好，不做假开关 */}
        <GlassCard className="console-enter p-4 rounded-xl">
          <SubHead icon="Palette" title="个性化" />
          <Row label="主题" note="正式品牌色与竹娃素材尚未交付，暗色主题待接入">
            <div className="console-seg">
              {[
                { k: 'light', icon: 'Sun', label: '亮色' },
                { k: 'dark', icon: 'Moon', label: '暗色（待接入）' },
              ].map((t) => (
                <button
                  key={t.k}
                  type="button"
                  title={t.label}
                  aria-label={t.label}
                  onClick={() => setPref('theme', t.k)}
                  className={cx('console-seg-btn', (prefs.theme || 'light') === t.k && 'console-seg-btn--on')}
                >
                  <Icon name={t.icon} className="w-3.5 h-3.5" strokeWidth={1.9} />
                </button>
              ))}
            </div>
          </Row>
          <Row label="减少动态效果" note="开启后停止背景漂移、尘埃与反光扫描，只保留极短淡入淡出">
            <Switch on={prefs.reduceMotion} onClick={() => togglePref('reduceMotion')} label="减少动态效果" />
          </Row>
          <Row label="默认视图" note="影响班级、书库、额度、社区这些页面的默认显示方式">
            <div className="console-seg">
              {[
                { k: 'card', icon: 'LayoutGrid', label: '卡片' },
                { k: 'list', icon: 'List', label: '列表' },
              ].map((v) => (
                <button
                  key={v.k}
                  type="button"
                  title={v.label}
                  aria-label={v.label}
                  onClick={() => setPref('viewMode', v.k)}
                  className={cx('console-seg-btn', prefs.viewMode === v.k && 'console-seg-btn--on')}
                >
                  <Icon name={v.icon} className="w-3.5 h-3.5" strokeWidth={1.9} />
                </button>
              ))}
            </div>
          </Row>
          <Row label="额度图表" note="条状或环状；时间趋势仍然是折线，不强行画成环">
            <div className="console-seg">
              {[
                { k: 'bar', icon: 'AlignLeft', label: '条状' },
                { k: 'ring', icon: 'PieChart', label: '环状' },
              ].map((v) => (
                <button
                  key={v.k}
                  type="button"
                  title={v.label}
                  aria-label={v.label}
                  onClick={() => setPref('chartStyle', v.k)}
                  className={cx('console-seg-btn', prefs.chartStyle === v.k && 'console-seg-btn--on')}
                >
                  <Icon name={v.icon} className="w-3.5 h-3.5" strokeWidth={1.9} />
                </button>
              ))}
            </div>
          </Row>
          <p className="text-[11.5px] text-ink-400 mt-2 pt-2 border-t border-ink-150/70">
            这四项是本地偏好，会记在这台设备上；权限与数据范围不受影响。
          </p>
        </GlassCard>

        {/* 通知偏好 */}
        <GlassCard className="console-enter p-4 rounded-xl">
          <SubHead icon="BellRing" title="通知偏好" />
          <div className="rounded-xl border border-ink-150 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-ink-50/70 text-[11px] text-ink-500">
                  <th className="px-3 py-2 font-medium">通知类型</th>
                  <th className="px-2 py-2 font-medium w-[62px] text-center">站内</th>
                  <th className="px-2 py-2 font-medium w-[62px] text-center">短信</th>
                </tr>
              </thead>
              <tbody>
                {NOTIFY_PREFS.map((n) => (
                  <tr key={n.key} className="border-t border-ink-150/70">
                    <td className="px-3 py-2">
                      <p className="text-[12.5px] font-medium text-ink-800">
                        {n.label}
                        {n.locked && (
                          <span className="ml-1.5 text-[10.5px] text-ink-400 border border-ink-200 rounded px-1">
                            不可关闭
                          </span>
                        )}
                      </p>
                      <p className="text-[11.5px] text-ink-500 leading-relaxed">{n.desc}</p>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Switch
                        on={notify[n.key].inApp}
                        disabled={n.locked}
                        onClick={() => toggleNotify(n.key, 'inApp')}
                        label={`${n.label} 站内通知`}
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <Switch
                        on={notify[n.key].sms}
                        disabled={n.locked}
                        onClick={() => toggleNotify(n.key, 'sms')}
                        label={`${n.label} 短信通知`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-ink-400 mt-2">
            安全相关通知不可关闭；涉事回避的事件不会通知到你。演示环境不真正发短信。
          </p>
        </GlassCard>

        {/* 帮助与反馈 */}
        <GlassCard className="console-enter p-4 rounded-xl xl:col-span-2">
          <SubHead icon="LifeBuoy" title="帮助与反馈" />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {HELP_LINKS.map((h) => (
              <button
                key={h.key}
                type="button"
                onClick={() => setModal(h.key)}
                className="text-left rounded-xl border border-ink-150 bg-white/70 hover:bg-white hover:border-brand-200 transition px-3 py-2.5"
              >
                <span className="flex items-center gap-2">
                  <Icon name={h.icon} className="w-4 h-4 text-[#3E9E8F] shrink-0" strokeWidth={1.9} />
                  <span className="text-[13px] font-semibold text-ink-900">{h.label}</span>
                  <Icon name="ArrowUpRight" className="w-3.5 h-3.5 text-ink-300 ml-auto" strokeWidth={1.9} />
                </span>
                <span className="block text-[11.5px] text-ink-500 leading-relaxed mt-1">{h.desc}</span>
              </button>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* 弹窗：都是壳，说明清楚就行，不假装保存 */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        icon={MODAL_META[modal]?.icon || 'Info'}
        title={MODAL_META[modal]?.title || ''}
        desc={MODAL_META[modal]?.desc}
        width="max-w-[480px]"
        footer={
          <>
            <Btn onClick={() => setModal(null)}>关闭</Btn>
            {MODAL_META[modal]?.primary && (
              <Btn tone="primary" onClick={() => setModal(null)}>
                {MODAL_META[modal].primary}
              </Btn>
            )}
          </>
        }
      >
        <p className="text-[13px] text-ink-700 leading-relaxed">{MODAL_META[modal]?.body}</p>
        {modal === 'trusted' && (
          <>
            <label className="block text-[12px] text-ink-500 mt-3 mb-1">从本校账号里选择</label>
            <select className="console-input">
              <option>周老师 · 三年级（3）班班主任</option>
              <option>王主任 · 教务处</option>
              <option>陈老师 · 六年级（1）班班主任</option>
            </select>
            <p className="text-[11.5px] text-ink-400 mt-1.5">
              对方需要在自己的个人主页里确认；确认前状态是「待确认」，不能用于辅助登录。
            </p>
          </>
        )}
        {modal === 'password' && (
          <p className="text-[12.5px] text-ink-500 leading-relaxed mt-2.5">
            前端壳不实现真实改密。忘记密码时可以用「可信辅助账号」放行一次性登录，或联系学校管理员重置。
          </p>
        )}
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => setRemoving(null)}
        title={removing ? `移除可信辅助账号「${removing.name}」？` : ''}
        confirmText="移除"
        desc={
          removing
            ? `移除后 ${removing.name} 不能再为你放行一次性登录，历史辅助登录记录仍然保留。你可以随时重新添加，但需要对方再确认一次。`
            : ''
        }
      />
    </PagePanel>
  )
}

const MODAL_META = {
  profile: {
    icon: 'PenLine',
    title: '编辑资料',
    desc: '姓名与身份由学校统一维护',
    body: '手机号与头像可以自己改；姓名、所属学校与任教班级来自学校导入的名册，需要联系学校管理员修改。前端壳不实现保存。',
    primary: '我知道了',
  },
  password: {
    icon: 'KeyRound',
    title: '修改密码',
    desc: '需要先验证当前密码',
    body: '正式版会要求输入当前密码 + 新密码两次，并校验强度；本轮前端壳只展示入口。',
  },
  trusted: {
    icon: 'UserRoundPlus',
    title: '添加可信辅助账号',
    desc: '只能从本校账号里选',
    body: '被添加的人只能在你忘记密码时放行一次性登录，看不到你的密码，也不能代替你操作。',
    primary: '发送确认请求',
  },
  guide: {
    icon: 'BookOpenCheck',
    title: '教师使用指引',
    desc: '共读安排、课堂同步与报告确认',
    body: '正式版会链接到学校下发的使用手册。本轮先给入口，内容待运营补齐。',
  },
  privacy: {
    icon: 'ShieldCheck',
    title: '隐私与安全说明',
    desc: '你能看什么、看了留下什么',
    body: '普通会话在授权范围内可直接查看并自动留痕；私密会话必须申请；安全事件按最小必要上下文查看，涉事人员一律回避。所有原文访问都会记入审计，学生本人也能看到「谁在什么时候看过」。',
  },
  feedback: {
    icon: 'MessageSquarePlus',
    title: '提交产品反馈',
    desc: '会进入运营维护的反馈列表',
    body: '正式版这里是一个带截图的反馈表单。本轮前端壳只展示入口，运营侧的反馈列表已经做好了。',
    primary: '我知道了',
  },
  contact: {
    icon: 'LifeBuoy',
    title: '联系学校管理员',
    desc: '账号、班级与权限问题',
    body: '培新小学 · 教务处 王主任（内线 8012）。权限与数据范围由学校管理员分配，个人主页里改不了。',
  },
}

function Row({ label, note, children }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-ink-150/60 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-ink-800">{label}</p>
        <p className="text-[11.5px] text-ink-500 leading-relaxed mt-0.5">{note}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}

function Switch({ on, onClick, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={disabled ? '这项通知不可关闭' : label}
      disabled={disabled}
      onClick={onClick}
      className={cx('console-switch', on && 'console-switch--on', disabled && 'opacity-45 pointer-events-none')}
    >
      <span className="console-switch-dot" />
    </button>
  )
}
