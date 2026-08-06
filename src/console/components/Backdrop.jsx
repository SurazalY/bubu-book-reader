// 权限端共享背景层：书香景观图 + 缓慢晨光位移 + 极少尘埃。
// 母版要求：背景始终可感知，书页与主体几何静止，只有光晕缓慢宽幅移动；
// 开启「减少动态效果」后只保留静态渐变。整张背景图可整体替换。
export default function Backdrop() {
  const src = `${import.meta.env.BASE_URL}bg/reading-scene.png`
  return (
    <div className="console-backdrop" aria-hidden="true">
      <div className="console-backdrop-photo" style={{ backgroundImage: `url("${src}")` }} />
      {/* 暖白纸感罩层：压低照片对比，保证上层文字始终清晰可读 */}
      <div className="console-backdrop-veil" />
      {/* 晨光：两片宽幅低对比光晕，错开周期缓慢漂移 */}
      <div className="console-glow console-glow--warm" />
      <div className="console-glow console-glow--cool" />
      {/* 尘埃：只放 6 颗，母版明确要求「极少」 */}
      <div className="console-dust">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`console-dust-mote console-dust-mote--${i + 1}`} />
        ))}
      </div>
    </div>
  )
}
