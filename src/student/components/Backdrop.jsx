// 学生端共享背景层：与权限端同一张「书香与晨光」景观图，
// 但薄纱更暖、光晕换成「暖阳 + 淡青绿 + 浅天蓝」三片，符合学生端更暖更有生命力的定位。
// 母规则：背景始终可感知，书页与主体几何静止，只有光晕缓慢宽幅移动；
// 开启「减少动态效果」后只留静态渐变。整张背景图可整体替换。
export default function Backdrop() {
  const src = `${import.meta.env.BASE_URL}bg/reading-scene.png`
  return (
    <div className="student-backdrop" aria-hidden="true">
      <div className="student-backdrop-photo" style={{ backgroundImage: `url("${src}")` }} />
      {/* 奶油白薄纱：压低照片对比，保证上层文字始终清晰可读 */}
      <div className="student-backdrop-veil" />
      <div className="student-glow student-glow--sun" />
      <div className="student-glow student-glow--mint" />
      <div className="student-glow student-glow--sky" />
      {/* 尘埃：母规则明确要求「极少」，只放 6 颗 */}
      <div className="student-dust">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`student-dust-mote student-dust-mote--${i + 1}`} />
        ))}
      </div>
    </div>
  )
}
