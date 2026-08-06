// 竹娃 AI 与课堂共读的演示数据（前端壳专用，**不是真实业务数据**）。
//
// 三条口径写在最前面，后面所有实现都不许违反：
//   1. 额度是「每日提问次数 + 每日用量额度」双限制，任一耗尽即停；
//      学生只看到剩余提问次数、用量百分比、恢复时间，绝不出现 Token、模型价格与费用（Plan_6 §5、红线 9）。
//   2. AI 回复不做真流式：服务端收齐并校验完引用与安全字段后，前端只负责逐字动画呈现（Plan_6 §5）。
//      所以这里的每条回复都是「完整文本 + 已校验引用」，打字机只是呈现方式。
//   3. 书页转换完就能读，但索引与情节记忆卡没建完时该书 AI 暂时不可用，
//      学生端说明为「竹娃正在认识这本书」（Plan_6 §5）。
//
// 竹娃形象当前用 Codex Neko 示意素材，等学校正式素材（见 data/mascot.js）。

// AI 伙伴称呼：学校正式命名到位后只改这里
export const AI_NAME = '竹娃'

// —— 额度（双限制）——
// 前端壳不模拟后端结算，只表达学生能看到的三件事：剩余次数、用量百分比、恢复时间。
export const AI_QUOTA = {
  askLimit: 20, // 今日提问次数上限
  askUsed: 6, // 已用次数
  usagePercent: 34, // 今日用量额度已用比例
  resetAt: '明天早上 6:00',
  note: '提问次数和用量额度都由学校设置，任一用完就要等恢复。失败重试不算次数。',
}

// —— 该书 AI 暂不可用（索引与情节记忆卡还没建完）——
// 演示用：这本书能正常翻阅，但问竹娃会给出「正在认识这本书」的说明。
export const AI_INDEXING_BOOKS = ['xijun-shijie']

// —— 异常与受控状态（规格 §7.4 + Plan_6 新增的第六态）——
// 每一态都必须同时给「发生了什么 + 现在还能做什么」，不能只写一句「AI 不可用」。
export const AI_BLOCKERS = {
  indexing: {
    key: 'indexing',
    icon: 'BookOpen',
    tone: 'info',
    title: `${AI_NAME}正在认识这本书`,
    desc: '这本书刚上架，正文已经可以读了，但竹娃还在把书里的人物和情节读一遍。读完就会自动开放。',
    stillCan: '现在可以正常翻页、选文、收藏摘录和写批注。',
  },
  offline: {
    key: 'offline',
    icon: 'WifiOff',
    tone: 'warn',
    title: '网络断开了',
    desc: '刚才那条消息没有发出去。网络恢复后可以重试，你写的字不会丢。',
    stillCan: '离线也能继续读这本书，书签、摘录和批注照常保存。',
  },
  unavailable: {
    key: 'unavailable',
    icon: 'CloudOff',
    tone: 'warn',
    title: `${AI_NAME}暂时不能回答`,
    desc: '学校的 AI 服务正在维护，稍后会自动恢复，不用你做什么。',
    stillCan: '历史对话可以照常翻看，阅读、批注和书签都不受影响。',
  },
  quota: {
    key: 'quota',
    icon: 'Hourglass',
    tone: 'warn',
    title: '今天的提问次数用完了',
    desc: `剩余次数会在${AI_QUOTA.resetAt}恢复。次数和用量额度用完哪一个都会暂停新的提问。`,
    stillCan: '还能继续阅读、翻看历史对话、写批注和加书签。',
  },
}

// 安全兜底回复：学生问到不适合由 AI 直接回答的内容时，竹娃给克制的引导。
// 界面上不出现任何报警、风险等级或事件字样（红线 8：安全事件对学生完全不可见）。
export const AI_SAFE_FALLBACK = {
  text:
    '这件事我不太适合替你判断，也不想只给你一个听起来很轻松的答案。\n\n如果你心里正难受，或者担心身边的人，最好和信任的大人说一说——班主任、家里人都可以。你愿意的话，我们先回到这本书，我陪你把这一段读完。',
  guide: true,
}

// —— 语音转文字（规格 §7.3：只保存识别后的文字，不保存原始录音）——
export const AI_VOICE_DEMO = {
  hint: '正在听……说完再点一下就会变成文字',
  note: '语音只会变成文字保存，录音本身不会留下。',
  text: '桑桑为什么把那盏灯挂在河边',
}

// —— 演示会话（学生自己的普通会话 + 私密会话）——
// 私密会话对**学生自己**标题与完整历史照常显示（Plan_1 §2.1 更正表第 2 条），
// 只有未授权教师才只看到「私密会话 #编号」。
export const SEED_CHATS = [
  {
    id: 'chat-1',
    title: '草房子 · 河边那盏灯',
    bookId: 'caofangzi',
    private: false,
    at: '今天 12:36',
    messages: [
      {
        id: 'm-1',
        role: 'student',
        at: '12:34',
        text: '这句我读了三遍，桑桑为什么要把灯挂在河边？',
        quotes: [
          {
            bookId: 'caofangzi',
            title: '草房子',
            page: 135,
            text: '它只是让河上的人知道，岸上有人在看着',
          },
        ],
      },
      {
        id: 'm-2',
        role: 'ai',
        at: '12:35',
        text:
          '你选的这句，其实已经把答案说了一半了——灯不是为了照路，是为了让人知道「有人在」。\n\n第 134 页那里写过，原来挂灯是怕夜里过河的人看不清；后来他说「以后不用挂了」，是因为河上装了新的灯。可到了第 135 页他还是挂了。这两处放在一起看，就明白他挂的不是照明的灯。\n\n你可以再留意一下：这一章里「亮一次」这个说法出现了几次？作者写的是灯，也是桑桑心里那点没说出口的惦记。',
        refs: [
          { page: 134, text: '以后不用挂了' },
          { page: 133, text: '每放开一次，河面就亮一次' },
        ],
        feedback: null,
      },
    ],
  },
  {
    id: 'chat-2',
    title: '稻草人为什么站着不动',
    bookId: 'daocaoren',
    private: false,
    at: '今天 08:12',
    messages: [
      {
        id: 'm-3',
        role: 'student',
        at: '08:11',
        text: '稻草人明明看见了，为什么不去帮忙？',
        quotes: [
          {
            bookId: 'daocaoren',
            title: '稻草人',
            page: 98,
            text: '看得见，却帮不上，是这世上最难的一种站着',
          },
        ],
      },
      {
        id: 'm-4',
        role: 'ai',
        at: '08:11',
        text:
          '因为他被插在田里，动不了——这是故事一开始就定下的规矩。\n\n但作者让他「看得见」，就是故意的：能看见却动不了，比什么都看不见更难受。你读到的这一句，说的就是这种难受。\n\n往下读的时候可以对照着看：他每次想帮忙，作者都会先写他能做的是什么（看、听、想），再写他做不到的是什么。这个反复出现的写法，就是这本书难过的地方。',
        refs: [{ page: 96, text: '飘得很慢，慢得让人心里发急' }],
        feedback: 'up',
      },
    ],
  },
  {
    id: 'chat-3',
    title: '我自己想的一些事',
    bookId: 'caofangzi',
    private: true,
    at: '昨天 21:04',
    messages: [
      {
        id: 'm-5',
        role: 'student',
        at: '21:02',
        text: '我读到纸月转学走的那段，忽然有点难过，能跟你说说吗',
      },
      {
        id: 'm-6',
        role: 'ai',
        at: '21:03',
        text:
          '当然可以，你慢慢说。\n\n书里桑桑也没有把这件事说出来——他只是把那把伞收好了。有时候难过不需要马上讲清楚原因，先承认「我现在有点难过」就已经很好。\n\n如果你愿意，我们可以从你最先注意到的那一句开始聊。',
        refs: [],
        feedback: null,
      },
    ],
  },
]

// 最近删除（规格 §7.5：删除会话进入最近删除并允许恢复，后台按学校设置保留 7／15／30 天）
export const SEED_TRASH = [
  {
    id: 'chat-9',
    title: '十万个为什么 · 打雷',
    bookId: 'shiwange-weishenme',
    private: false,
    at: '5 月 11 日',
    deletedAt: '3 天前删除',
    messages: [
      { id: 'm-9', role: 'student', at: '19:22', text: '为什么先看到闪电才听到雷声？' },
      {
        id: 'm-10',
        role: 'ai',
        at: '19:22',
        text: '因为光跑得比声音快很多。第 26 页那张图画的就是这件事：闪电几乎一瞬间就到你眼睛里，雷声还在路上。',
        refs: [{ page: 26, text: '光比声音跑得快' }],
        feedback: null,
      },
    ],
  },
]

export const TRASH_KEEP_NOTE = '删除的对话会先放在这里，学校设置的保留期内都可以恢复。'

// 私密会话规则说明（Codex 第 109 轮 Q5：不展示后台阈值，只讲学生能理解的规则）
export const PRIVACY_RULES = [
  '设为私密后，老师默认看不到这个对话。',
  '老师确实需要查看时，必须先提出申请并说明用途，你可以同意或拒绝。',
  '你一直没处理的申请，会按学校设置的超时规则处理。',
  '私密对话仍然会做安全识别，这一项不能关闭。',
]

// —— 演示回答库 ——
// 前端壳不接模型，但也不能给一句放之四海皆准的假话：
// 这里按「问到了什么」返回真正针对示例内页内容的回答，并带上真实页码引用。
// 正式版换成后端返回的 { answer, refs } 即可，面板结构不动。
const ANSWERS = [
  {
    match: /灯|挂/,
    text:
      '这一段的灯出现了两次，一次在第 134 页，一次在第 135 页。\n\n第一次是有用的灯——夜里过河看得见路；第二次已经没有实际用处了，他还是挂上去。作者把「有用」和「没用」摆在一起，就是想让你注意后面那一次。\n\n读到这里可以问自己一句：如果灯不为照路，那是为谁亮的？',
    refs: [
      { page: 134, text: '以后不用挂了' },
      { page: 135, text: '它只是让河上的人知道，岸上有人在看着' },
    ],
  },
  {
    match: /提前走|放学|同学/,
    text:
      '第 132 页那句话是老师说的，听起来只是一条安排：住得远的同学提前走。\n\n但你往后读会发现，这条安排改变了好几个人的路。作者常用这种「很小的一句话」推动后面的事，所以读到这种句子最好停一下，记一笔是谁说的、对谁说的。',
    refs: [{ page: 132, text: '从今天起，住得远的同学提前走' }],
  },
  {
    match: /稻草人|田|站/,
    text:
      '稻草人的位置是被固定的，这不是他不想动，而是他做不到。\n\n第 96 页写云「飘得很慢，慢得让人心里发急」，那个急其实是稻草人的急。作者写景，写的是他的心。你可以留意后面还有哪些地方是用景物说心情的。',
    refs: [{ page: 96, text: '飘得很慢，慢得让人心里发急' }],
  },
  {
    match: /木头|握/,
    text:
      '「像一块被人握久了的木头」这个比喻，重点在「握久了」——木头本身不会变，是被人手上的温度和汗磨成了那个样子。\n\n作者用它形容一件用了很久的东西，也在说这东西被人在意了很久。这类比喻你可以抄进摘录里，写作文时很好用。',
    refs: [{ page: 130, text: '像一块被人握久了的木头' }],
  },
]

const GENERIC_ANSWER = {
  text:
    '我先把你问的这段放回原文里看了一遍。\n\n这本书的写法有个特点：重要的事情往往不直接说，而是放在一个动作或者一件东西上。所以读到你选的这几句时，可以顺着问三件事——是谁做的、在什么时候做的、这之前发生过什么。\n\n你想从哪一句开始？我们一句一句来。',
  refs: [],
}

const OFF_TOPIC_ANSWER = {
  text:
    '这个好像和我们在读的这本书没什么关系，我就不往下聊了——我主要是陪你读书的。\n\n我们回到刚才那一页吧？你要是有想不通的句子，选中它再问我，我能把前后文一起看。',
  refs: [],
  guide: true,
}

const OFF_TOPIC = /(游戏|抖音|明星|奥特曼|王者|吃鸡|放假|考试答案)/

// 取一条演示回答：优先按选文与问题内容命中，明显跑题的走引导，其余给通用读法建议。
export function demoAnswer(question, quotes = []) {
  const hay = `${question || ''} ${quotes.map((q) => q.text).join(' ')}`
  if (OFF_TOPIC.test(question || '')) return { ...OFF_TOPIC_ANSWER }
  const hit = ANSWERS.find((a) => a.match.test(hay))
  if (hit) return { text: hit.text, refs: hit.refs }
  if (quotes.length) {
    return {
      text: `${GENERIC_ANSWER.text}`,
      refs: quotes.slice(0, 2).map((q) => ({ page: q.page, text: q.text })),
    }
  }
  return { ...GENERIC_ANSWER }
}

// 新会话标题：用第一句话的前几个字，学生随时可以重命名（规格 §7.3）
export function draftTitle(question, quotes = []) {
  const base = (question || quotes[0]?.text || '').replace(/\s+/g, '')
  if (!base) return '新的对话'
  return base.length > 12 ? `${base.slice(0, 12)}…` : base
}

// ===================================================================
//  课堂共读（规格 §8 + Codex 第 109 轮 Q7）
//  蓝色边缘光 = 锁定书籍（必须留在这本书，可以自己翻页）
//  紫色边缘光 = 同步页面（全班跟随教师指定页面）
//  两种都柔和、持续但不闪烁，且必须同时给文字状态与控制教师。
// ===================================================================

export const CLASSROOM_SCENES = {
  lock: {
    key: 'lock',
    mode: 'lock',
    tone: 'sky',
    teacher: '林老师',
    bookId: 'caofangzi',
    label: '课堂共读 · 锁定这本书',
    desc: '这节课要一起读《草房子》，你可以自己翻页、选文、写批注和问竹娃。',
    endAt: '预计 14:45 结束',
    connected: true,
  },
  sync: {
    key: 'sync',
    mode: 'sync',
    tone: 'violet',
    teacher: '林老师',
    bookId: 'caofangzi',
    page: 132,
    label: '课堂共读 · 跟随老师的页面',
    desc: '全班现在停在第 132 页。老师翻页时你这边会一起翻。',
    endAt: '预计 14:45 结束',
    connected: true,
  },
  broadcast: {
    key: 'broadcast',
    mode: 'sync',
    tone: 'violet',
    teacher: '林老师',
    bookId: 'caofangzi',
    page: 132,
    label: '课堂共读 · 跟随老师的页面',
    desc: '全班现在停在第 132 页。老师刚才向竹娃问了一个问题，回答已经发给全班。',
    endAt: '预计 14:45 结束',
    connected: true,
    broadcast: true,
  },
  lost: {
    key: 'lost',
    mode: 'sync',
    tone: 'violet',
    teacher: '林老师',
    bookId: 'caofangzi',
    page: 132,
    label: '课堂共读 · 正在重新连接',
    desc: '和课堂的连接断开了，正在自动重连。这不算你退出课堂，老师那边看到的也是「正在恢复」。',
    endAt: '预计 14:45 结束',
    connected: false,
  },
  ended: {
    key: 'ended',
    mode: 'ended',
    tone: 'mint',
    teacher: '林老师',
    bookId: 'caofangzi',
    label: '课堂共读已结束',
    desc: '已经恢复自由阅读：可以翻到任意一页，也可以换别的书。',
    connected: true,
  },
}

// 教师课堂 AI 广播：教师只问一次，同一条提问与同一条回复广播给全班（规格 §8.3、Plan_6 §4.2）
export const CLASSROOM_BROADCAST = {
  chatTitle: '课堂 · 林老师提问',
  teacher: '林老师',
  at: '14:12',
  question: {
    text: '大家看第 132 页老师说的这句话。它为什么会改变桑桑那天的路线？',
    quotes: [
      { bookId: 'caofangzi', title: '草房子', page: 132, text: '从今天起，住得远的同学提前走' },
    ],
  },
  answer: {
    text:
      '因为这句话把「什么时候走」从桑桑自己决定，变成了老师决定。\n\n他原本可以等纸月一起走，现在必须提前走。表面上只是放学时间变了，实际上是他和别人相处的机会少了——所以后面河边那段才显得那么重要。\n\n读的时候可以做个对照：这句话之前，他每天做的最后一件事是什么？之后又变成了什么？',
    refs: [
      { page: 132, text: '从今天起，住得远的同学提前走' },
      { page: 133, text: '每放开一次，河面就亮一次' },
    ],
  },
}
