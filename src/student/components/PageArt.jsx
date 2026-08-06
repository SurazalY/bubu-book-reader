// 示例内页的插图：全部是为本演示手写的原创线描 SVG。
//
// 为什么不用 public/covers 里的真封面来当插图：Codex 第 85 轮明确「封面不能冒充内页」。
// 为什么不用位图：插图要跟着整页一起等比缩放，矢量线描放大不糊，也不额外增加仓库体积。
// 线条统一用墨色低透明度，配合纸张底色，保持「安静的书页」而不是彩色贴图。
const stroke = 'currentColor'

function Frame({ children, label }) {
  return (
    <svg
      viewBox="0 0 320 190"
      className="student-page-art"
      role="img"
      aria-label={label}
      fill="none"
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

// 芦花湾的小木船：水平线、芦苇丛、翻过来的小船
function Reeds() {
  return (
    <Frame label="河岸的芦苇与一只小木船">
      <path d="M8 132h304" strokeWidth="1.1" opacity="0.55" />
      <path d="M8 143h304" strokeWidth="0.8" opacity="0.3" />
      <path d="M22 156h120" strokeWidth="0.8" opacity="0.22" />
      <path d="M186 166h112" strokeWidth="0.8" opacity="0.22" />
      {/* 芦苇：左密右疏 */}
      {[
        [30, 132, 26, -8],
        [42, 132, 44, 6],
        [54, 132, 34, -12],
        [66, 132, 52, 9],
        [78, 132, 30, -6],
        [268, 132, 48, 10],
        [280, 132, 32, -7],
        [292, 132, 42, 5],
      ].map(([x, y, h, bend], i) => (
        <g key={i} opacity={0.62}>
          <path d={`M${x} ${y}C${x + bend / 2} ${y - h / 2} ${x + bend} ${y - h * 0.75} ${x + bend} ${y - h}`} strokeWidth="1" />
          <path d={`M${x + bend} ${y - h}q${bend > 0 ? 7 : -7} -5 ${bend > 0 ? 11 : -11} -1`} strokeWidth="1.4" opacity="0.7" />
        </g>
      ))}
      {/* 翻过来的小木船：船底朝天 */}
      <path d="M104 130c6-22 26-34 58-34s52 12 58 34" strokeWidth="1.4" />
      <path d="M104 130h116" strokeWidth="1.2" />
      <path d="M120 122c8-14 22-20 42-20s34 6 42 20" strokeWidth="0.8" opacity="0.45" />
      <path d="M138 114c6-8 14-11 24-11s18 3 24 11" strokeWidth="0.8" opacity="0.32" />
      <path d="M162 96v34" strokeWidth="0.7" opacity="0.28" />
      {/* 水面倒影 */}
      <path d="M112 138h100" strokeWidth="2" opacity="0.14" />
      <path d="M128 146h68" strokeWidth="1.6" opacity="0.1" />
    </Frame>
  )
}

// 田东头的稻草人：斗笠、竹骨、稻穗、两只麻雀
function Field() {
  return (
    <Frame label="稻田里的稻草人与两只麻雀">
      <path d="M8 150h304" strokeWidth="1.1" opacity="0.5" />
      {/* 稻穗 */}
      {Array.from({ length: 16 }).map((_, i) => {
        const x = 20 + i * 19
        const h = 20 + ((i * 7) % 11)
        return (
          <g key={i} opacity={0.42}>
            <path d={`M${x} 150c1-${h / 2} 2-${h * 0.8} 3-${h}`} strokeWidth="0.9" />
            <path d={`M${x + 3} ${150 - h}q5-3 7 2`} strokeWidth="1.1" />
            <path d={`M${x + 3} ${150 - h + 6}q-5-3-7 2`} strokeWidth="1.1" />
          </g>
        )
      })}
      {/* 稻草人 */}
      <path d="M160 150V58" strokeWidth="1.5" />
      <path d="M116 82h88" strokeWidth="1.5" />
      {/* 斗笠 */}
      <path d="M132 58h56" strokeWidth="1.3" />
      <path d="M138 58c4-13 10-19 22-19s18 6 22 19" strokeWidth="1.3" />
      <path d="M188 58l6 3" strokeWidth="1.1" opacity="0.6" />
      {/* 褂子 */}
      <path d="M160 70l-30 12v40l30 8 30-8V82z" strokeWidth="1.2" opacity="0.75" />
      <path d="M160 70v58" strokeWidth="0.8" opacity="0.4" />
      <path d="M130 96l30 6 30-6" strokeWidth="0.8" opacity="0.35" />
      {/* 袖口垂下的草 */}
      <path d="M118 82l-6 16M124 82l-3 18M198 82l6 15M204 82l3 17" strokeWidth="0.9" opacity="0.5" />
      {/* 麻雀 */}
      <g opacity="0.8">
        <path d="M228 62q7-8 15-4t2 12q-6 5-13 2z" strokeWidth="1.1" />
        <path d="M245 70l9 5-9 2" strokeWidth="1" />
        <path d="M232 62l-4-6" strokeWidth="1" />
        <circle cx="236" cy="65" r="0.9" fill={stroke} stroke="none" />
      </g>
      <g opacity="0.6">
        <path d="M74 48q6-7 13-3t2 10q-5 5-11 2z" strokeWidth="1.1" />
        <path d="M89 55l8 4-8 2" strokeWidth="1" />
        <circle cx="81" cy="51" r="0.8" fill={stroke} stroke="none" />
      </g>
    </Frame>
  )
}

// 雪夜的窗与提灯：窄街、亮着的窗、一盏小灯、空中打转的雪
function Lantern() {
  return (
    <Frame label="雪夜的窄街、亮着的窗与一盏提灯">
      <path d="M8 158h304" strokeWidth="1.1" opacity="0.5" />
      {/* 左侧墙与窗 */}
      <path d="M28 20v138" strokeWidth="1.2" opacity="0.6" />
      <path d="M28 20h96v112H28" strokeWidth="0.9" opacity="0.3" />
      <rect x="48" y="52" width="56" height="60" rx="3" strokeWidth="1.4" />
      <path d="M76 52v60M48 82h56" strokeWidth="1" opacity="0.7" />
      <path d="M52 108h48" strokeWidth="4" opacity="0.16" />
      {/* 窗里透出的光 */}
      <path d="M104 60l38-14v82l-38-14z" strokeWidth="0" fill={stroke} opacity="0.07" />
      {/* 右侧墙 */}
      <path d="M292 14v144" strokeWidth="1.2" opacity="0.6" />
      <path d="M292 14h-72v118h72" strokeWidth="0.9" opacity="0.28" />
      <path d="M238 40h30v26h-30z" strokeWidth="0.9" opacity="0.45" />
      {/* 提灯 */}
      <path d="M184 158V96" strokeWidth="1.3" />
      <path d="M176 96h16" strokeWidth="1.2" />
      <path d="M178 96V78h12v18z" strokeWidth="1.4" />
      <path d="M180 78q4-8 8 0" strokeWidth="1.2" />
      <path d="M184 70v6" strokeWidth="1" opacity="0.6" />
      <circle cx="184" cy="87" r="3.4" strokeWidth="1" opacity="0.9" />
      <circle cx="184" cy="87" r="14" strokeWidth="0" fill={stroke} opacity="0.06" />
      {/* 灯下的一圈雪地 */}
      <path d="M162 158h44" strokeWidth="2.4" opacity="0.14" />
      {/* 打转的雪 */}
      {[
        [70, 32],
        [118, 22],
        [154, 46],
        [206, 30],
        [246, 20],
        [136, 128],
        [222, 112],
        [92, 140],
      ].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y}q4-4 7 0t-3 7`} strokeWidth="0.9" opacity="0.4" />
      ))}
    </Frame>
  )
}

// 灯下的一页书：桌面、翻开的书、台灯与杯子
function Desk() {
  return (
    <Frame label="灯下摊开的一本书与一只杯子">
      <path d="M8 152h304" strokeWidth="1.1" opacity="0.5" />
      {/* 翻开的书 */}
      <path d="M62 148c34-14 64-14 96 0 32-14 62-14 96 0" strokeWidth="1.4" />
      <path d="M62 148V116c34-14 64-14 96 0v32" strokeWidth="1.3" />
      <path d="M254 148V116c-34-14-64-14-96 0v32" strokeWidth="1.3" />
      <path d="M158 116v32" strokeWidth="1" opacity="0.6" />
      {/* 页面上的文字线 */}
      {[126, 133, 140].map((y, i) => (
        <g key={i} opacity={0.34}>
          <path d={`M${80 + i * 3} ${y}h${58 - i * 4}`} strokeWidth="1.4" />
          <path d={`M${178 + i * 2} ${y}h${58 - i * 4}`} strokeWidth="1.4" />
        </g>
      ))}
      {/* 台灯 */}
      <path d="M258 148V70" strokeWidth="1.3" />
      <path d="M244 148h28" strokeWidth="1.4" />
      <path d="M258 70h32" strokeWidth="1.2" />
      <path d="M276 70l-14 22h32z" strokeWidth="1.4" />
      <path d="M262 100q14 12 28 0" strokeWidth="0.9" opacity="0.4" />
      <circle cx="278" cy="98" r="16" strokeWidth="0" fill={stroke} opacity="0.06" />
      {/* 杯子 */}
      <path d="M36 122h30v20a8 8 0 0 1-8 8H44a8 8 0 0 1-8-8z" strokeWidth="1.3" />
      <path d="M66 128h8a6 6 0 0 1 0 12h-8" strokeWidth="1.1" />
      <path d="M44 112q3-8 7 0M56 108q3-8 7 0" strokeWidth="0.9" opacity="0.45" />
    </Frame>
  )
}

const ART = { reeds: Reeds, field: Field, lantern: Lantern, desk: Desk }

export default function PageArt({ kind, src }) {
  if (src) return <img src={src} alt="" className="student-page-art h-full w-full object-cover" />
  const C = ART[kind]
  return C ? <C /> : null
}
