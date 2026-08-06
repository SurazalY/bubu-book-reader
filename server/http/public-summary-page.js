const labels = {
  effectiveMinutes: '有效阅读时长',
  pagesRead: '阅读页数',
  startedBookCount: '开始阅读书目',
  latestReadingAt: '最近有效阅读',
  highlights: '阅读亮点',
  teacherComment: '教师寄语',
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function displayValue(key, value) {
  if (key === 'effectiveMinutes' && Number.isFinite(Number(value))) return `${Number(value)} 分钟`
  if (Array.isArray(value)) return value.map((item) => String(item)).join('、')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '—')
}

export function renderPublicSummaryPage(summary) {
  const content = summary.report.content && typeof summary.report.content === 'object' && !Array.isArray(summary.report.content)
    ? summary.report.content
    : summary.report.content
      ? { teacherComment: summary.report.content }
      : {}
  const entries = Object.entries(content)
  const metrics = entries.length
    ? entries.map(([key, value]) => `<div class="metric"><span>${escapeHtml(labels[key] || key)}</span><strong>${escapeHtml(displayValue(key, value))}</strong></div>`).join('')
    : '<div class="empty">本期报告暂无可展示内容</div>'
  const notice = summary.report.aiNotice
    ? `<p class="notice">${escapeHtml(summary.report.aiNotice)}</p>`
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>阅读成长报告</title>
  <style>
    :root { color-scheme: light; font-family: "Noto Serif SC", "Songti SC", serif; color: #302b26; background: #f4efe5; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; padding: 48px 20px; background: radial-gradient(circle at 10% 10%, #fffaf0 0, transparent 38%), linear-gradient(135deg, #eee3cf, #f7f2e8 48%, #e7ddca); }
    main { width: min(760px, 100%); margin: 0 auto; padding: 42px; border: 1px solid rgba(88, 69, 46, .18); border-radius: 28px; background: rgba(255, 253, 247, .9); box-shadow: 0 24px 80px rgba(91, 70, 40, .14); backdrop-filter: blur(12px); }
    .eyebrow { margin: 0 0 10px; color: #8d7554; font: 600 13px/1.4 system-ui, sans-serif; letter-spacing: .18em; }
    h1 { margin: 0; font-size: clamp(32px, 6vw, 52px); font-weight: 650; letter-spacing: -.03em; }
    .student { margin: 18px 0 34px; color: #655846; font-size: 18px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .metric { min-height: 112px; padding: 20px; border-radius: 18px; background: #f4ede0; display: flex; flex-direction: column; justify-content: space-between; }
    .metric span { color: #796b58; font: 500 13px/1.5 system-ui, sans-serif; }
    .metric strong { margin-top: 14px; font-size: 22px; font-weight: 620; overflow-wrap: anywhere; }
    .notice, .empty { margin: 28px 0 0; color: #766957; font: 14px/1.7 system-ui, sans-serif; }
    .foot { margin: 34px 0 0; padding-top: 22px; border-top: 1px solid rgba(88, 69, 46, .14); color: #8b7b65; font: 13px/1.6 system-ui, sans-serif; }
    @media (max-width: 560px) { body { padding: 20px 12px; } main { padding: 28px 22px; border-radius: 22px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">READMATE · 家长查阅</p>
    <h1>阅读成长报告</h1>
    <p class="student">${escapeHtml(summary.student.displayName)} 的本期阅读记录</p>
    <section class="grid">${metrics}</section>
    ${notice}
    <p class="foot">此链接已完成验真并记录首次打开时间，出于隐私保护不可重复使用</p>
  </main>
</body>
</html>`
}
