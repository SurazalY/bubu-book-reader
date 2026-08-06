// 演示身份数据（前端壳专用，不是真实业务数据）。
// 真实姓名、学校、班级由学校下发，学生不可自行修改；头像只能选学校预设。
export const DEMO_STUDENT = {
  id: 'stu-demo-01',
  name: '林小竹',
  school: '培新小学',
  className: '三年级（1）班',
  grade: '三年级',
  studentNo: '2026030118',
  level: { value: 7, title: '爱书人', nextAt: 82 }, // 阅读等级只表达个人成长，不做同学比较
  avatarPreset: 'bamboo-01', // 学校预设头像编号
  homeTeacher: '林老师',
  // 阅读汇总数据不写在这里：一律由 data/library.js 的 READING_SUMMARY 从书库现算，
  // 否则主页、排行、详情三处很容易出现互相矛盾的数字（Stage 2 定的口径）。
  demo: true,
}

// 电子书包唤起的演示参数（真实凭证与协议属后端／跨端专项）
export const DEMO_LAUNCH = {
  bookTitle: '草房子',
  author: '曹文轩',
  page: 12,
  from: '电子书包 · 语文课堂',
}
