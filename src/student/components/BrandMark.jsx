import { cx } from '../../shared/cx.js'

const markSrc = `${import.meta.env.BASE_URL}brand/peixin-mark@128.png`
const wordmarkSrc = `${import.meta.env.BASE_URL}brand/peixin-wordmark.png`

export function BrandMark({ size = 40, showText = true, textClass, className }) {
  return (
    <div className={cx('inline-flex items-center gap-3', className)}>
      <img src={markSrc} alt="培新教育" width={size} height={size} />
      {showText && (
        <img
          src={wordmarkSrc}
          alt="培新教育"
          width={84}
          height={24}
          className={textClass}
        />
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
