// 竹娃素材槽（前端读取用）。
// ⚠️ 与 public/mascot/mascot.json 保持一致：那份 json 是给「换素材的人」看的说明，
// 这份是给代码用的常量。换成学校正式「竹娃」素材时，只改这两个文件与图片，页面结构不动。
// 当前素材：Codex 宠物 Neko（内部示意，等待学校竹娃正式素材）。
export const MASCOT = {
  sprite: 'mascot/codex-neko.webp',
  columns: 8,
  rows: 11,
  cellWidth: 192,
  cellHeight: 208,
  // 只允许把 192 整除到底的尺寸，保证一个源像素对应整数个屏幕像素，否则像素图会发虚：
  //   192 = 探出与面板头像｜96 = 边缘收叠｜48 = 对话里每条回复前的小头像（Stage 4 追加）
  renderSizes: [48, 96, 192],
  states: {
    idle: { row: 0, frames: 7, fps: 6, loop: true },
    runningRight: { row: 1, frames: 8, fps: 10, loop: true },
    runningLeft: { row: 2, frames: 8, fps: 10, loop: true },
    waving: { row: 3, frames: 4, fps: 6, loop: false },
    jumping: { row: 4, frames: 5, fps: 8, loop: false },
    failed: { row: 5, frames: 8, fps: 6, loop: false },
    waiting: { row: 6, frames: 6, fps: 5, loop: true },
    running: { row: 7, frames: 6, fps: 10, loop: true },
    review: { row: 8, frames: 6, fps: 5, loop: true },
  },
  look: { rows: [9, 10], count: 16, stepDegrees: 22.5, neutral: { row: 0, column: 6 } },
}

// 把「状态 + 帧序号」换算成精灵图单元格；越界回落到第 0 帧，避免出现空格子。
export function mascotCell(state, frame = 0) {
  const s = MASCOT.states[state] || MASCOT.states.idle
  return { row: s.row, column: Math.max(0, Math.min(s.frames - 1, frame)) }
}

// 视线方向（0°～337.5°，每 22.5° 一格）→ 单元格，用于让竹娃看向学生选中的段落。
export function mascotLookCell(degrees) {
  const step = MASCOT.look.stepDegrees
  const idx = ((Math.round(Number(degrees || 0) / step) % MASCOT.look.count) + MASCOT.look.count) % MASCOT.look.count
  return { row: MASCOT.look.rows[idx < 8 ? 0 : 1], column: idx % 8 }
}
