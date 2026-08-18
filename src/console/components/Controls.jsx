import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'

// 管理页通用控件：按钮、搜索框、卡片/列表切换、筛选胶囊、页签、空状态、分页。
// 参考图里的做法：工具栏在面板头部一行，主操作在最右，视图切换是一个小分段控件。

const BTN_TONE = {
  primary: 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700 hover:border-brand-700 shadow-e1',
  soft: 'bg-brand-50 text-brand-700 border-brand-100 hover:bg-brand-100',
  plain: 'bg-white/80 text-ink-700 border-ink-200 hover:bg-white hover:border-ink-300',
  danger: 'bg-white/80 text-danger-600 border-danger-100 hover:bg-danger-50 hover:border-danger-200',
  ghost: 'bg-transparent text-ink-600 border-transparent hover:bg-white/70',
}

// 按钮：默认 32px 高，管理页里所有操作都用它，避免各页自己拼样式
export function Btn({ tone = 'plain', icon, iconRight, children, className, size = 'md', ...props }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium whitespace-nowrap transition duration-140 ease-soft disabled:opacity-45 disabled:pointer-events-none',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]',
        BTN_TONE[tone],
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} strokeWidth={1.9} />}
      {children}
      {iconRight && <Icon name={iconRight} className="w-3.5 h-3.5" strokeWidth={1.9} />}
    </button>
  )
}

// 纯图标按钮：列表行尾的操作用它，必须带 title 说明，不留哑图标
export function IconBtn({ icon, title, tone = 'ghost', className, ...props }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={cx(
        'inline-flex items-center justify-center w-7 h-7 rounded-lg border transition duration-140 disabled:opacity-45 disabled:pointer-events-none',
        tone === 'danger'
          ? 'text-ink-400 border-transparent hover:text-danger-600 hover:bg-danger-50'
          : 'text-ink-400 border-transparent hover:text-brand-600 hover:bg-brand-50',
        className,
      )}
      {...props}
    >
      <Icon name={icon} className="w-4 h-4" strokeWidth={1.9} />
    </button>
  )
}

export function SearchBox({ value, onChange, placeholder = '搜索', className, width = 'w-[200px]' }) {
  return (
    <div className={cx('relative', width, className)}>
      <Icon
        name="Search"
        className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none"
        strokeWidth={1.9}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-8 pl-8 pr-7 rounded-lg border border-ink-200 bg-white/85 text-[12.5px] text-ink-800 placeholder:text-ink-400 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清空搜索"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
        >
          <Icon name="X" className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

// 下拉筛选：原生 select，保证键盘可用，外观按 token 收敛
export function Select({ value, onChange, options, className, width = 'w-[132px]' }) {
  return (
    <div className={cx('relative', width, className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 pl-2.5 pr-7 rounded-lg border border-ink-200 bg-white/85 text-[12.5px] text-ink-800 outline-none appearance-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        name="ChevronDown"
        className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none"
      />
    </div>
  )
}

// 卡片/列表切换：参考图右上角那个两格分段控件
export function ViewToggle({ value, onChange }) {
  return (
    <div className="console-seg" role="group" aria-label="切换显示方式">
      {[
        { key: 'card', icon: 'LayoutGrid', label: '卡片' },
        { key: 'list', icon: 'List', label: '列表' },
      ].map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onChange(v.key)}
          title={v.label}
          aria-pressed={value === v.key}
          className={cx('console-seg-btn', value === v.key && 'console-seg-btn--on')}
        >
          <Icon name={v.icon} className="w-3.5 h-3.5" strokeWidth={1.9} />
        </button>
      ))}
    </div>
  )
}

// 筛选胶囊：书库右侧筛选、社区页签下的次级筛选都用它
export function Chip({ active, count, children, ...props }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cx(
        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] transition duration-140',
        'disabled:opacity-45 disabled:pointer-events-none',
        active
          ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium'
          : 'bg-white/70 border-ink-200 text-ink-600 hover:border-ink-300 hover:bg-white',
      )}
      {...props}
    >
      {children}
      {typeof count === 'number' && (
        <span className={cx('text-[11px] tabular-nums', active ? 'text-brand-500' : 'text-ink-400')}>{count}</span>
      )}
    </button>
  )
}

// 状态徽标：六种语义色，列表和详情共用同一套，避免同一状态两处不同色
const STATUS_TONE = {
  success: 'bg-success-50 text-success-700 border-success-100',
  warning: 'bg-warning-50 text-warning-700 border-warning-100',
  danger: 'bg-danger-50 text-danger-700 border-danger-100',
  brand: 'bg-brand-50 text-brand-700 border-brand-100',
  accent: 'bg-accent-50 text-accent-700 border-accent-100',
  // 私密会话专用：紫色只表示「学生自己锁起来的内容」，不表示风险
  violet: 'bg-[#F0ECFB] text-[#6355A6] border-[#DED6F6]',
  muted: 'bg-ink-100 text-ink-600 border-ink-200',
}

export function StatusTag({ tone = 'muted', dot = false, children, className }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 px-2 h-[22px] rounded-full border text-[11.5px] font-medium whitespace-nowrap',
        STATUS_TONE[tone] || STATUS_TONE.muted,
        className,
      )}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  )
}

// 页签：社区三页签、学生详情多页签、隐私访问三页签共用
export function Tabs({ value, onChange, items, className }) {
  return (
    <div className={cx('flex items-center gap-1 border-b border-ink-150', className)} role="tablist">
      {items.map((it) => {
        const on = value === it.key
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.key)}
            className={cx(
              'relative h-9 px-3 text-[13px] transition duration-140',
              on ? 'text-brand-700 font-semibold' : 'text-ink-500 hover:text-ink-700',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {it.label}
              {typeof it.count === 'number' && (
                <span
                  className={cx(
                    'px-1.5 h-[17px] inline-flex items-center rounded-full text-[10.5px] tabular-nums',
                    on ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500',
                  )}
                >
                  {it.count}
                </span>
              )}
            </span>
            {on && <span className="absolute left-2.5 right-2.5 -bottom-px h-[2px] rounded-full bg-brand-500" />}
          </button>
        )
      })}
    </div>
  )
}

// 空状态：规范要求图标 + 主文案 + 副文案，可选一个操作
export function EmptyState({ icon = 'Inbox', title, desc, action, className }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center py-14 px-6', className)}>
      <span className="w-12 h-12 rounded-2xl bg-ink-100/80 flex items-center justify-center">
        <Icon name={icon} className="w-6 h-6 text-ink-400" strokeWidth={1.6} />
      </span>
      <p className="text-[14px] font-medium text-ink-700 mt-3.5">{title}</p>
      {desc && <p className="text-[12.5px] text-ink-500 mt-1.5 max-w-[420px]">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// 底部统计与分页：参考图的「总计 N / 每页行数 / 上一页下一页」
export function TableFooter({ total, page, pageSize, onPage, onPageSize, unit = '条' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center gap-4 h-11 px-1 border-t border-ink-150/70 text-[12px] text-ink-500">
      <span>
        总计 <span className="font-medium text-ink-700 tabular-nums">{total}</span> {unit}
      </span>
      <div className="flex-1" />
      <label className="flex items-center gap-1.5">
        每页
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="h-7 pl-1.5 pr-5 rounded-md border border-ink-200 bg-white/85 text-[12px] outline-none appearance-none focus:border-brand-300"
        >
          {[10, 20, 50].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        行
      </label>
      <div className="flex items-center gap-1">
        <IconBtn icon="ChevronLeft" title="上一页" disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <span className="px-1 tabular-nums">
          {page} / {pages}
        </span>
        <IconBtn icon="ChevronRight" title="下一页" disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </div>
  )
}

// 资料键值行：详情页左右两列资料统一用它，冒号对齐靠固定标签宽度
export function Field({ label, children, className, labelWidth = 'w-[76px]' }) {
  return (
    <div className={cx('flex items-start gap-3 py-[7px]', className)}>
      <span className={cx('shrink-0 text-[12.5px] text-ink-400', labelWidth)}>{label}</span>
      <div className="min-w-0 flex-1 text-[12.5px] text-ink-800">{children}</div>
    </div>
  )
}

// 小节标题：详情页里分段用，比页面标题轻一档
export function SubHead({ icon, title, extra, className }) {
  return (
    <div className={cx('flex items-center gap-2 mb-2.5', className)}>
      {icon && <Icon name={icon} className="w-4 h-4 text-[#3E9E8F]" strokeWidth={1.9} />}
      <h3 className="text-[13.5px] font-semibold text-ink-800">{title}</h3>
      <div className="flex-1" />
      {extra}
    </div>
  )
}
