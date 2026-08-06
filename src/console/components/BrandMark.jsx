import { cx } from '../../shared/cx.js'

// 读伴品牌标识（母版 01）：摊开的双瓣书页，左瓣淡紫→蓝、右瓣青→蓝绿，
// 面状填充无描边无底块；右侧「读伴」宋体深墨蓝。侧栏顶部与登录页共用。
export function BrandMark({ size = 40, showText = true, textClass, className }) {
  return (
    <div className={cx('inline-flex items-center gap-3', className)}>
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <linearGradient id="brandmark-left" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#C9B8F2" />
            <stop offset="100%" stopColor="#7FA9F0" />
          </linearGradient>
          <linearGradient id="brandmark-right" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7FD3E0" />
            <stop offset="100%" stopColor="#6FB6D9" />
          </linearGradient>
        </defs>
        {/* 左页：外缘上扬如翻起的纸，向书脊收窄 */}
        <path d="M23 15.5C19.6 11.4 14.9 9.2 9.2 8.4c-1 -.15 -1.9 .6 -1.9 1.6v20.4c0 .85 .64 1.55 1.5 1.63C14 32.6 19 34.6 23 38.4Z" fill="url(#brandmark-left)" />
        {/* 右页 */}
        <path d="M25 15.5C28.4 11.4 33.1 9.2 38.8 8.4c1 -.15 1.9 .6 1.9 1.6v20.4c0 .85 -.64 1.55 -1.5 1.63C34 32.6 29 34.6 25 38.4Z" fill="url(#brandmark-right)" />
        {/* 书脊 */}
        <path d="M23.1 16.4h1.8v22.6h-1.8Z" fill="#8FB4E8" opacity=".55" />
      </svg>
      {showText && (
        <span className={cx('font-serif font-bold text-ink-900 tracking-tightish', textClass || 'text-display')}>
          读伴
        </span>
      )}
    </div>
  )
}

// 菱形分隔纹：一个小菱形 + 两侧极细短线，比标题弱很多
export function DiamondRule({ className }) {
  return (
    <div className={cx('flex items-center justify-center gap-2', className)} aria-hidden="true">
      <span className="h-px w-16 bg-gradient-to-r from-transparent to-ink-300" />
      <span className="w-2 h-2 rotate-45 rounded-[1px] bg-brand-300" />
      <span className="h-px w-16 bg-gradient-to-l from-transparent to-ink-300" />
    </div>
  )
}
