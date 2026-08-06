import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AI_QUOTA,
  AI_SAFE_FALLBACK,
  SEED_CHATS,
  SEED_TRASH,
  demoAnswer,
  draftTitle,
} from '../data/aiChat.js'

// 竹娃多会话状态（规格 §7.3／§7.5 + Plan_6 §5）。
//
// 只放内存，不落 localStorage：会话内容属于业务数据，
// 前端壳不能假装「已经写进后端」，偏好类数据才落盘（见 StudentContext）。
//
// 关于「逐字动画」——这不是流式。Plan_6 §5 明确：服务端先收齐并校验回答、引用、
// 隐私与危险字段，前端再逐字呈现，避免先显示剧透或无效引用再撤回。
// 所以这里的每条回复一开始就持有完整文本（full），打字机只控制显示到第几个字（text）。

const TICK_MS = 26 // 逐字节奏：一跳约 2 个字，读起来像有人在写
const TICK_STEP = 2

let seq = 0
const uid = (p) => `${p}-${(seq += 1)}-${Date.now().toString(36)}`

function clock() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 种子会话里的 AI 回复都是已完成状态：text 就是全文
function seedChat(c) {
  return {
    ...c,
    messages: c.messages.map((m) => ({
      ...m,
      full: m.role === 'student' ? undefined : m.text,
      typing: false,
      stopped: false,
      sendState: 'sent',
    })),
  }
}

export default function useAiChats({ reduceMotion = false } = {}) {
  const [chats, setChats] = useState(() => SEED_CHATS.map(seedChat))
  const [trash, setTrash] = useState(() => SEED_TRASH.map(seedChat))
  const [activeId, setActiveId] = useState(SEED_CHATS[0].id)
  // 额度：学生只看到剩余提问次数与用量百分比（红线 9：不显示 Token 与费用）
  const [quota, setQuota] = useState({
    remaining: AI_QUOTA.askLimit - AI_QUOTA.askUsed,
    usagePercent: AI_QUOTA.usagePercent,
  })
  // 正在逐字呈现的那一条：{ chatId, msgId }
  const [pending, setPending] = useState(null)
  // 面板没打开时来的新消息（课堂广播、上一条回答写完）要有未读提醒
  const [unread, setUnread] = useState(0)
  const reduceRef = useRef(reduceMotion)
  reduceRef.current = reduceMotion

  const active = chats.find((c) => c.id === activeId) || chats[0] || null

  const patchMsg = useCallback((chatId, msgId, patch) => {
    setChats((list) =>
      list.map((c) =>
        c.id !== chatId
          ? c
          : { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)) },
      ),
    )
  }, [])

  // —— 逐字呈现 ——
  // 「减少动态效果」下直接给完整文本，不做打字机（规格 §12：持续动画都要服从这个开关）
  useEffect(() => {
    if (!pending) return undefined
    const { chatId, msgId } = pending
    if (reduceRef.current) {
      patchMsg(chatId, msgId, (m) => ({ text: m.full || '', typing: false }))
      setPending(null)
      return undefined
    }
    const timer = window.setInterval(() => {
      let finished = false
      setChats((list) =>
        list.map((c) => {
          if (c.id !== chatId) return c
          return {
            ...c,
            messages: c.messages.map((m) => {
              if (m.id !== msgId) return m
              const full = m.full || ''
              const next = Math.min(full.length, (m.text?.length || 0) + TICK_STEP)
              if (next >= full.length) finished = true
              return { ...m, text: full.slice(0, next), typing: next < full.length }
            }),
          }
        }),
      )
      if (finished) {
        window.clearInterval(timer)
        setPending(null)
      }
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [pending, patchMsg])

  const selectChat = useCallback((id) => setActiveId(id), [])

  const newChat = useCallback(
    (bookId) => {
      const id = uid('chat')
      // 新对话默认普通会话（规格 §7.5 第 1 条）
      setChats((list) => [{ id, title: '新的对话', bookId, private: false, at: '刚刚', messages: [] }, ...list])
      setActiveId(id)
      return id
    },
    [],
  )

  const renameChat = useCallback((id, title) => {
    const t = (title || '').trim()
    if (!t) return
    setChats((list) => list.map((c) => (c.id === id ? { ...c, title: t.slice(0, 24) } : c)))
  }, [])

  // 普通 ↔ 私密。学生看自己的私密会话，标题与完整历史照常显示。
  const togglePrivate = useCallback((id) => {
    setChats((list) => list.map((c) => (c.id === id ? { ...c, private: !c.private } : c)))
  }, [])

  // 删除进最近删除，可恢复（规格 §7.5）
  const deleteChat = useCallback(
    (id) => {
      setChats((list) => {
        const gone = list.find((c) => c.id === id)
        if (gone) setTrash((t) => [{ ...gone, deletedAt: '刚刚删除' }, ...t])
        const rest = list.filter((c) => c.id !== id)
        setActiveId((cur) => (cur === id ? rest[0]?.id || '' : cur))
        return rest
      })
    },
    [],
  )

  const restoreChat = useCallback((id) => {
    setTrash((t) => {
      const back = t.find((c) => c.id === id)
      if (back) {
        const { deletedAt, ...clean } = back
        setChats((list) => [clean, ...list])
        setActiveId(id)
      }
      return t.filter((c) => c.id !== id)
    })
  }, [])

  // —— 发送 ——
  // blocker：'offline' 时消息发不出去（保留学生原文并允许重试），
  // safe=true 时走安全兜底回复（界面上不出现任何报警字样）。
  const send = useCallback(
    ({ text, quotes = [], bookId, blocker = null, safe = false, visible = true } = {}) => {
      const body = (text || '').trim()
      if (!body && !quotes.length) return
      let chatId = activeId
      setChats((list) => {
        let target = list.find((c) => c.id === chatId)
        let next = list
        if (!target) {
          chatId = uid('chat')
          target = { id: chatId, title: '新的对话', bookId, private: false, at: '刚刚', messages: [] }
          next = [target, ...list]
        }
        const studentMsg = {
          id: uid('m'),
          role: 'student',
          at: clock(),
          text: body,
          quotes,
          sendState: blocker === 'offline' ? 'failed' : 'sent',
        }
        const add = [studentMsg]
        if (blocker !== 'offline') {
          const answer = safe ? { ...AI_SAFE_FALLBACK, refs: [] } : demoAnswer(body, quotes)
          const aiMsg = {
            id: uid('m'),
            role: 'ai',
            at: clock(),
            text: '',
            full: answer.text,
            refs: answer.refs || [],
            guide: !!answer.guide,
            typing: true,
            stopped: false,
            feedback: null,
          }
          add.push(aiMsg)
          setPending({ chatId, msgId: aiMsg.id })
        }
        return next.map((c) =>
          c.id !== chatId
            ? c
            : {
                ...c,
                at: '刚刚',
                // 首条消息顺手把标题从「新的对话」改成问题摘要，学生随时能重命名
                title: c.messages.length === 0 && c.title === '新的对话' ? draftTitle(body, quotes) : c.title,
                messages: [...c.messages, ...add],
              },
        )
      })
      setActiveId(chatId)
      // 发不出去的消息不扣次数（Plan_6 §5：失败请求与系统重试不扣学生提问次数）
      if (blocker !== 'offline') {
        setQuota((q) => ({ remaining: Math.max(0, q.remaining - 1), usagePercent: Math.min(100, q.usagePercent + 3) }))
        if (!visible) setUnread((n) => n + 1)
      }
    },
    [activeId],
  )

  // 停止生成：保留已经写出来的部分，并标明是被停下的
  const stop = useCallback(() => {
    if (!pending) return
    patchMsg(pending.chatId, pending.msgId, { typing: false, stopped: true })
    setPending(null)
  }, [pending, patchMsg])

  // 重试：重新写一遍同一条回答，不扣提问次数
  const retry = useCallback(
    (msgId) => {
      const chat = chats.find((c) => c.messages.some((m) => m.id === msgId))
      if (!chat) return
      const msg = chat.messages.find((m) => m.id === msgId)
      if (!msg) return
      if (msg.role === 'student') {
        // 网络中断那条：改成已发送，并补一条回答
        patchMsg(chat.id, msgId, { sendState: 'sent' })
        const answer = demoAnswer(msg.text, msg.quotes || [])
        const aiMsg = {
          id: uid('m'),
          role: 'ai',
          at: clock(),
          text: '',
          full: answer.text,
          refs: answer.refs || [],
          typing: true,
          stopped: false,
          feedback: null,
        }
        setChats((list) => list.map((c) => (c.id === chat.id ? { ...c, messages: [...c.messages, aiMsg] } : c)))
        setPending({ chatId: chat.id, msgId: aiMsg.id })
        return
      }
      patchMsg(chat.id, msgId, { text: '', typing: true, stopped: false, feedback: null })
      setPending({ chatId: chat.id, msgId })
    },
    [chats, patchMsg],
  )

  const feedback = useCallback(
    (msgId, value) => {
      const chat = chats.find((c) => c.messages.some((m) => m.id === msgId))
      if (!chat) return
      patchMsg(chat.id, msgId, (m) => ({ feedback: m.feedback === value ? null : value }))
    },
    [chats, patchMsg],
  )

  // —— 教师课堂 AI 广播（规格 §8.3）——
  // 教师只问一次、系统只生成一次，同一条提问与回复广播给全班；
  // 学生这边强制展开面板并标明「教师提问／课堂 AI 回复」，不占学生自己的提问次数。
  const pushBroadcast = useCallback((broadcast, bookId) => {
    const payload = broadcast?.message || broadcast || {}
    const question = typeof payload.question === 'string' ? payload.question : payload.question?.text || payload.text || '教师发起了课堂提问'
    const quotes = payload.question?.quotes || payload.quotes || []
    const answer = typeof payload.answer === 'string' ? payload.answer : payload.answer?.text || payload.reply || payload.text || '课堂回答暂不可用'
    const refs = payload.answer?.refs || payload.refs || []
    const teacher = broadcast?.teacher || payload.teacher || '任课教师'
    const at = broadcast?.createdAt || '刚刚'
    const id = `chat-class-${broadcast?.id || broadcast?.sourceRequestId}`
    const teacherMsg = {
      id: uid('m'),
      role: 'teacher',
      at,
      teacher,
      text: question,
      quotes,
      sendState: 'sent',
    }
    const aiMsg = {
      id: uid('m'),
      role: 'classAi',
      at,
      text: '',
      full: answer,
      refs,
      typing: true,
      stopped: false,
      feedback: null,
    }
    setChats((list) => {
      const has = list.find((c) => c.id === id)
      const chat = has
        ? { ...has, at: '刚刚', messages: [...has.messages, teacherMsg, aiMsg] }
        : {
            id,
            title: `${teacher}的课堂提问`,
            bookId,
            private: false,
            classroom: true,
            at: '刚刚',
            messages: [teacherMsg, aiMsg],
          }
      return has ? list.map((c) => (c.id === id ? chat : c)) : [chat, ...list]
    })
    setActiveId(id)
    setPending({ chatId: id, msgId: aiMsg.id })
    return id
  }, [])

  const clearUnread = useCallback(() => setUnread(0), [])

  // 返回值固定引用：上层 StudentContext 的 useMemo 靠它才不会每帧重建整个 context
  return useMemo(
    () => ({
      chats,
      trash,
      active,
      activeId,
      quota,
      pending,
      unread,
      clearUnread,
      selectChat,
      newChat,
      renameChat,
      togglePrivate,
      deleteChat,
      restoreChat,
      send,
      stop,
      retry,
      feedback,
      pushBroadcast,
    }),
    [
      chats,
      trash,
      active,
      activeId,
      quota,
      pending,
      unread,
      clearUnread,
      selectChat,
      newChat,
      renameChat,
      togglePrivate,
      deleteChat,
      restoreChat,
      send,
      stop,
      retry,
      feedback,
      pushBroadcast,
    ],
  )
}
