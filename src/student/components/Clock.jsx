import { useEffect, useState } from 'react'
import { cx } from '../../shared/cx.js'
import { useStudent } from '../state/StudentContext.jsx'

// 主页顶部的动态时钟（母版：问候 + 超大时间 + 日期星期一行，直接落在背景上，不包色块）。
// Kimi 反例把这块做成深绿实心卡压住整屏视觉，这里只用字重、字号与半透明分隔点分层。
// 规格没有天气数据来源，Codex 第 85 轮明确「首页不加天气」，所以这里只有时间与日期。

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function greetOf(hour) {
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

// 时段一句话：跟着时间走的阅读氛围文案，不做营销口号也不催促学生多读
function moodOf(hour) {
  if (hour < 6) return '这么晚了，看两页就休息吧'
  if (hour < 11) return '早读时间，光线正好'
  if (hour < 13) return '午后翻两页，让眼睛也歇一歇'
  if (hour < 18) return '下午的书页最安静'
  return '睡前读一小段，故事会跟着你入梦'
}

export default function Clock({ className }) {
  const { student, prefs } = useStudent()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // 只按分钟跳，不做秒级重绘：主页不需要秒针，也避免持续动画干扰阅读
    const tick = () => setNow(new Date())
    const timer = window.setInterval(tick, 20_000)
    return () => window.clearInterval(timer)
  }, [])

  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const hour = now.getHours()

  return (
    <header className={cx('student-clock', className)}>
      <p className="text-title text-ink-600">
        {greetOf(hour)}，<span className="font-semibold text-ink-900">{student?.name?.slice(1) || '同学'}</span>
      </p>
      <div className="mt-1 flex items-end gap-4">
        <p
          className={cx(
            'student-clock-time font-serif tabular-nums leading-[0.95] text-ink-900',
            !prefs.reduceMotion && 'student-clock-time--live',
          )}
        >
          {hh}
          <span className="student-clock-colon">:</span>
          {mm}
        </p>
        <p className="pb-2 text-caption text-ink-500">
          {now.getMonth() + 1} 月 {now.getDate()} 日
          <span className="mx-2 text-ink-300">·</span>
          {WEEKDAYS[now.getDay()]}
        </p>
      </div>
      <p className="mt-1.5 text-caption text-ink-500">{moodOf(hour)}</p>
    </header>
  )
}
