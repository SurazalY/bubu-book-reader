import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'
import { GlassPanel } from '../Glass.jsx'
import { buildDailyReadingBriefViewModel } from './dailyReadingBriefModel.js'

function BriefStatus({ icon, title, description, action }) {
  return (
    <GlassPanel tone="card" className="student-enter rounded-2xl px-5 py-5">
      <div className="flex min-h-[124px] flex-col items-start gap-4 sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/75 text-ink-400">
          <Icon name={icon} className="h-6 w-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-h3 font-bold text-ink-900">{title}</h2>
          <p className="mt-1 text-caption leading-6 text-ink-500">{description}</p>
        </div>
        {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
      </div>
    </GlassPanel>
  )
}

export default function DailyReadingBrief({ resource, onRetry, onContinueReading, onOpenShelf }) {
  if (!resource || resource.status === 'loading') {
    return (
      <BriefStatus
        icon="LoaderCircle"
        title="正在整理今天的阅读简报"
        description="简报会使用服务端返回的有效阅读汇总，不会用本地数据补齐。"
      />
    )
  }

  if (resource.status === 'forbidden') {
    return (
      <BriefStatus
        icon="LockKeyhole"
        title="暂时无法查看阅读简报"
        description="当前账号没有读取这份个人简报的权限。"
      />
    )
  }

  if (resource.status === 'error') {
    return (
      <BriefStatus
        icon="CloudOff"
        title="阅读简报暂时没有加载出来"
        description={resource.error?.message || '稍后可以重试，本页不会用旧数据或默认值代替。'}
        action={onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="w-full shrink-0 rounded-full border border-white/80 bg-white px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F8F7B] focus-visible:ring-offset-2 sm:w-auto"
          >
            重试
          </button>
        ) : null}
      />
    )
  }

  if (!['ready', 'stale'].includes(resource.status)) {
    return (
      <BriefStatus
        icon="CircleHelp"
        title="阅读简报状态无法识别"
        description="请刷新页面后重试。"
      />
    )
  }

  const view = buildDailyReadingBriefViewModel(resource.data)
  if (!view.valid) {
    return (
      <BriefStatus
        icon="FileWarning"
        title="阅读简报数据不完整"
        description="服务端返回缺少必要字段，本页没有把缺失字段补成 0。"
        action={onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="w-full shrink-0 rounded-full border border-white/80 bg-white px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F8F7B] focus-visible:ring-offset-2 sm:w-auto"
          >
            重新读取
          </button>
        ) : null}
      />
    )
  }

  return (
    <GlassPanel
      tone="card"
      className="student-enter overflow-hidden rounded-2xl px-5 py-5 md:px-6"
      aria-labelledby="daily-reading-brief-title"
    >
      {resource.status === 'stale' && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-ink-200 bg-white/65 px-3.5 py-3 text-caption text-ink-600 sm:flex-row sm:items-center" role="status">
          <span className="flex min-w-0 flex-1 items-start gap-2.5">
            <Icon name="History" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
            <span>当前显示上一次成功读取的简报，数据时间：{view.updateLabel}。</span>
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="w-full shrink-0 rounded-full border border-ink-200 bg-white/85 px-3.5 py-1.5 text-micro font-semibold text-ink-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F8F7B] focus-visible:ring-offset-2 sm:w-auto"
            >
              重新读取
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#D8F1E8] text-[#278774]">
              <Icon name="BookOpenCheck" className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="text-micro font-semibold tracking-wide text-ink-500">今日阅读简报</p>
              <h2 id="daily-reading-brief-title" className="mt-0.5 font-serif text-[28px] font-bold leading-tight text-ink-900 tabular-nums">
                {view.todayDuration}
              </h2>
              <p className="mt-1 text-caption text-ink-600">{view.encouragement}</p>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3 text-micro text-ink-500">
              <span>{view.progressLabel}</span>
              <span className="shrink-0 tabular-nums">目标 {view.thresholdDuration}</span>
            </div>
            <div
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/85"
              role="progressbar"
              aria-label="今日五分钟阅读积累"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={view.progressAriaValue}
              aria-valuetext={view.progressLabel}
            >
              <div
                className="h-full rounded-full bg-[#4BAA92] transition-[width] duration-300"
                style={{ width: `${view.progressPercent}%` }}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-micro text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="CalendarCheck2" className="h-4 w-4 text-[#4BAA92]" />
              {view.streakLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="RefreshCw" className="h-3.5 w-3.5 text-ink-400" />
              {view.updateLabel}
            </span>
          </div>
        </div>

        <div className="flex min-h-[126px] flex-col justify-between rounded-xl border border-white/75 bg-white/55 p-4 lg:w-[300px]">
          {view.lastReading ? (
            <>
              <div>
                <p className="text-micro text-ink-500">上次阅读</p>
                <p className="mt-1 line-clamp-2 text-title font-semibold text-ink-900">{view.lastReading.title}</p>
                <p className="mt-1 text-micro text-ink-500">可以从上次停留的位置继续</p>
              </div>
              <button
                type="button"
                onClick={() => onContinueReading?.(view.lastReading)}
                disabled={!onContinueReading}
                title={onContinueReading ? undefined : '继续阅读将在真实路由接线后开放'}
                className="mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-[#2F8F7B] px-4 text-caption font-semibold text-white transition hover:bg-[#277866] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F8F7B] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
              >
                继续阅读
                <Icon name="ArrowRight" className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="text-micro text-ink-500">开始今天的阅读</p>
                <p className="mt-1 text-title font-semibold text-ink-900">还没有可继续的最近书籍</p>
                <p className="mt-1 text-micro text-ink-500">可以先到书架选择一本书</p>
              </div>
              <button
                type="button"
                onClick={() => onOpenShelf?.()}
                disabled={!onOpenShelf}
                className="mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-white/90 bg-white/85 px-4 text-caption font-semibold text-ink-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F8F7B] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55"
              >
                去书架看看
                <Icon name="Library" className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </GlassPanel>
  )
}
