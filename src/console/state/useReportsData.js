import { useCallback, useMemo, useRef, useState } from 'react'

import { createReportsApi } from '../../api/reports.js'
import { asApiError } from '../../api/envelope.js'
import { useApiResource } from '../../api/useApiResource.js'

export const REPORT_TYPES = {
  student: { label: '学生个人阅读总结', icon: 'UserRound', tone: 'brand' },
  class: { label: '班级／阅读安排报告', icon: 'Users', tone: 'cyan' },
  school: { label: '学校范围汇总', icon: 'Building2', tone: 'violet' },
  parent: { label: '家长阅读报告', icon: 'Heart', tone: 'accent' },
}

export const REPORT_STATUS = {
  generating: { label: '生成中', tone: 'muted', icon: 'LoaderCircle' },
  confirm: { label: '待确认', tone: 'warning', icon: 'CircleUser' },
  review: { label: '待审核', tone: 'accent', icon: 'ClipboardCheck' },
  published: { label: '已发布', tone: 'success', icon: 'CircleCheck' },
  failed: { label: '发送失败', tone: 'danger', icon: 'CircleX' },
  withdrawn: { label: '已撤回', tone: 'muted', icon: 'Undo2' },
  ready: { label: '已审核待发送', tone: 'brand', icon: 'Send' },
}

export const FLOW_RULES = {
  confirm: { key: 'confirm', label: '教师确认后发送', teacher: ['编辑', '确认发送', '定时发送'], admin: ['查看记录'] },
  review: { key: 'review', label: '管理员审核后发送', teacher: ['编辑', '提交审核'], admin: ['通过并发送', '退回修改'] },
}

export const CHANNELS = {
  sms: { label: '纯短信', icon: 'MessageSquare', canTrack: false, note: '只有运营商送达结果，看不到家长是否打开。' },
  link: { label: '短信摘要 + 安全链接', icon: 'Link2', canTrack: true, note: '能记录链接打开与确认阅读。' },
  miniapp: { label: '小程序报告', icon: 'Smartphone', canTrack: true, note: '已绑定小程序的家长可直接查看。' },
}

export const RECIPIENT_SCOPES = {
  primary: { label: '主要接收人', desc: '只发给学生资料里设为主要接收人的那一位' },
  all: { label: '全部接收人', desc: '发给学生资料里所有监护人' },
  custom: { label: '指定监护人', desc: '本次单独选择接收人，不改学生资料' },
}

export const SEND_STATES = {
  queued: { label: '待发送', tone: 'muted' },
  sending: { label: '发送中', tone: 'brand' },
  success: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
}

export const REACH_STATES = {
  unopened: { label: '未打开', tone: 'muted' },
  opened: { label: '已打开', tone: 'brand' },
  read: { label: '已确认阅读', tone: 'success' },
}

export const SEND_MODES = {
  manual: { label: '手动发送', icon: 'Send' },
  weekly: { label: '定时周报', icon: 'CalendarClock' },
  stage: { label: '阶段报告', icon: 'Flag' },
}

export const SEND_DEFAULT_NOTE = '产品默认不向家长自动发送任何报告，学校需显式开启通道，且每一封都需要教师或管理员确认。'

export const SEND_RULES = [
  { key: 'weekly', icon: 'CalendarClock', title: '定时周报', source: 'school', productDefault: '出厂关闭，需学校开启', state: '按学校配置', tone: 'success', lines: ['教师确认后才进入发送队列', '实际通道由服务端学校配置决定'] },
  { key: 'manual', icon: 'Send', title: '手动发送', source: 'product', productDefault: '出厂可用，不会自动执行', state: '需人工确认', tone: 'brand', lines: ['从报告详情建立发送任务', '处理结果以服务端返回为准'] },
  { key: 'summary_link', icon: 'Link2', title: '摘要链接联系人', source: 'school', productDefault: '出厂关闭，需学校建立联系人', state: '按学校配置', tone: 'success', lines: ['联系人由教师在本页建立', '链接地址只使用服务端返回的 publicUrl'] },
  { key: 'privacy', icon: 'ShieldCheck', title: '内容边界', source: 'product', productDefault: '始终生效', state: '强制', tone: 'muted', lines: ['不发送学生原始对话', 'AI 草稿须经人工审核'] },
]

export const SOURCE_META = {
  fixed: { label: '系统固定评价' },
  teacher: { label: '教师手写' },
  ai: { label: 'AI 草稿' },
}

function firstText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || ''
}

function normalizeStatus(value) {
  const valueMap = { pending: 'confirm', pending_review: 'review', generated: 'confirm', reviewed: 'ready', approved: 'ready', sent: 'published', cancelled: 'withdrawn', error: 'failed' }
  const status = valueMap[value] || value
  return REPORT_STATUS[status] ? status : 'confirm'
}

function normalizeStudent(student) {
  if (!student) return null
  const contacts = student.parentContacts || student.contacts || student.parents || []
  return {
    id: student.id,
    name: firstText(student.displayName, student.name, student.fullName, '未命名学生'),
    classId: firstText(student.classId, student.class?.id),
    className: firstText(student.className, student.class?.displayName, student.class?.name),
    parents: contacts.map((contact) => ({
      id: contact.id,
      name: firstText(contact.displayName, contact.name, '未命名联系人'),
      relation: firstText(contact.relation, contact.relationship, '监护人'),
      phone: firstText(contact.phoneMasked, contact.phone, contact.mobile),
      primary: Boolean(contact.primary || contact.isPrimary),
      channel: firstText(contact.channel, contact.contactType, 'summary_link'),
    })),
  }
}

function normalizeSection(section, index) {
  const paragraphs = Array.isArray(section?.paragraphs) ? section.paragraphs : [firstText(section?.content, section?.text)].filter(Boolean)
  return {
    source: SOURCE_META[section?.source] ? section.source : 'teacher',
    title: firstText(section?.title, `正文 ${index + 1}`),
    paragraphs,
  }
}

function normalizeReport(report, students) {
  const student = normalizeStudent(report.student || students.find((item) => item.id === report.studentId))
  const content = report.content && typeof report.content === 'object' && !Array.isArray(report.content) ? report.content : null
  const derivedMetrics = content ? [
    { label: '有效阅读', value: Number(content.effectiveMinutes || 0), unit: '分钟' },
    { label: '阅读进度', value: Number(content.pagesRead || 0), unit: '页' },
    { label: '已读书目', value: Number(content.startedBookCount || 0), unit: '本' },
  ] : []
  const versionNumber = Number(report.versionNumber || report.version_number || 0)
  const derivedVersions = report.versionId ? [{
    v: versionNumber > 0 ? `v${versionNumber}` : '当前版本',
    at: firstText(report.reviewedAt, report.updatedAt, report.createdAt),
    by: report.reviewedAt ? '教师人工审核' : '系统生成',
    note: report.reviewedAt ? '当前版本已完成教师人工审核' : '当前版本由真实阅读快照生成，等待教师审核',
  }] : []
  const sections = Array.isArray(report.sections)
    ? report.sections.map(normalizeSection)
    : Array.isArray(content?.highlights)
      ? [{ source: 'fixed', title: '真实阅读数据摘要', paragraphs: content.highlights.map(String) }]
    : firstText(report.content, report.summary)
      ? [{ source: 'teacher', title: '报告正文', paragraphs: [firstText(report.content, report.summary)] }]
      : []
  return {
    ...report,
    id: report.id,
    no: firstText(report.no, report.number, report.reportNo, report.id),
    type: REPORT_TYPES[report.type] ? report.type : 'parent',
    title: firstText(report.title, student ? `${student.name} · 阅读报告` : '阅读报告'),
    studentId: firstText(report.studentId, student?.id),
    classId: firstText(report.classId, student?.classId, report.class?.id),
    className: firstText(report.className, student?.className, report.class?.displayName, report.class?.name),
    bookId: firstText(report.bookId, report.book?.id),
    bookTitle: firstText(report.bookTitle, report.book?.title),
    period: firstText(report.period, report.periodLabel, report.snapshotLabel, '当前阅读快照'),
    status: normalizeStatus(report.status),
    flowRule: FLOW_RULES[report.flowRule] ? report.flowRule : 'review',
    updatedAt: firstText(report.updatedAt, report.updated_at, report.createdAt, report.created_at),
    version: firstText(report.version?.label, report.version, versionNumber > 0 ? `v${versionNumber}` : '', report.currentVersion?.label, report.currentVersion?.id, '——'),
    versionId: firstText(report.versionId, report.current_version_id, report.version?.id, report.currentVersion?.id),
    nextHandler: firstText(report.nextHandler, report.nextActor?.displayName, '待处理'),
    metrics: Array.isArray(report.metrics) ? report.metrics : derivedMetrics,
    sections,
    versions: Array.isArray(report.versions) ? report.versions : derivedVersions,
    sendSummary: report.sendSummary || { channel: 'link', scope: 'primary', mode: 'manual', hint: '尚未建立发送任务' },
    student,
    deliveries: Array.isArray(report.deliveries) ? report.deliveries : [],
  }
}

function normalizeDelivery(delivery, report) {
  const contact = delivery.parentContact || delivery.contact || delivery.recipient || {}
  return {
    ...delivery,
    id: delivery.id,
    reportId: firstText(delivery.reportId, report.id),
    studentId: firstText(delivery.studentId, report.studentId),
    report,
    student: report.student,
    channel: CHANNELS[delivery.channel] ? delivery.channel : 'link',
    recipient: {
      name: firstText(contact.displayName, contact.name, '待确认联系人'),
      relation: firstText(contact.relation, contact.relationship, '监护人'),
      phone: firstText(contact.phoneMasked, contact.phone, contact.mobile),
    },
    scope: RECIPIENT_SCOPES[delivery.scope] ? delivery.scope : 'custom',
    mode: SEND_MODES[delivery.mode] ? delivery.mode : 'manual',
    sendState: normalizeDeliveryStatus(delivery.sendState || delivery.status),
    reach: REACH_STATES[delivery.reach] ? delivery.reach : null,
    at: firstText(delivery.scheduledAt, delivery.processedAt, delivery.createdAt, '待发送'),
    retries: Number(delivery.retries || delivery.retryCount || delivery.attemptCount || 0),
    trace: firstText(delivery.trace, delivery.statusMessage, '等待发送处理'),
    fail: firstText(delivery.fail, delivery.failureReason),
    publicUrl: firstText(delivery.publicUrl, delivery.public_url),
    reach: delivery.firstReadAt ? 'read' : delivery.firstOpenedAt ? 'opened' : null,
  }
}

function normalizeDeliveryStatus(value) {
  const valueMap = { sent: 'success', processing: 'sending', retry_scheduled: 'queued' }
  const status = valueMap[value] || value
  return SEND_STATES[status] ? status : 'queued'
}

function normalizeContact(contact, students) {
  return {
    id: contact.id,
    studentId: contact.studentId,
    displayName: firstText(contact.displayName, '未命名联系人'),
    destination: firstText(contact.destination),
    channel: firstText(contact.channel, 'summary_link'),
    student: students.find((student) => student.id === contact.studentId) || null,
  }
}

function toReportsDto(studentsPayload, reportsPayload, contactsPayload = {}, deliveriesPayload = {}) {
  const students = (studentsPayload?.items || []).map(normalizeStudent)
  const reports = (reportsPayload?.items || []).map((report) => normalizeReport(report, students))
  const contacts = (contactsPayload?.items || []).map((contact) => normalizeContact(contact, students))
  const deliveries = (deliveriesPayload?.items || []).map((delivery) => {
    const report = reports.find((item) => item.id === delivery.reportId)
    return report ? normalizeDelivery(delivery, report) : null
  }).filter(Boolean)
  const classes = [...new Map(students.filter((student) => student.classId).map((student) => [student.classId, { id: student.classId, name: student.className || '未命名班级' }])).values()]
  const books = [...new Map(reports.filter((report) => report.bookId).map((report) => [report.bookId, { id: report.bookId, title: report.bookTitle || '未命名书目' }])).values()]
  return { students, reports, contacts, deliveries, classes, books }
}

export default function useReportsData(workspaceId) {
  const api = useMemo(() => createReportsApi(), [])
  const requestSequence = useRef(0)
  const [mutationState, setMutationState] = useState({ status: 'idle', error: null })
  const load = useCallback(async () => {
    if (!workspaceId) return { data: toReportsDto({}, {}), meta: {} }
    const options = { workspaceId }
    const [students, reports, contacts, deliveries] = await Promise.all([
      api.listStudents(options),
      api.listReports(options),
      api.listParentContacts(options),
      api.listDeliveries(options),
    ])
    return { data: toReportsDto(students.data, reports.data, contacts.data, deliveries.data), meta: reports.meta }
  }, [api, workspaceId])
  const resource = useApiResource(load)

  const write = useCallback(async (action, request) => {
    if (!workspaceId) throw new TypeError('当前会话没有可用工作空间')
    requestSequence.current += 1
    const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${requestSequence.current}`
    setMutationState({ status: 'loading', error: null })
    try {
      const result = await request({ workspaceId, idempotencyKey: `reports:${action}:${workspaceId}:${nonce}` })
      setMutationState({ status: 'ready', error: null })
      resource.reload()
      return result.data
    } catch (error) {
      const apiError = asApiError(error)
      setMutationState({ status: 'error', error: apiError })
      throw apiError
    }
  }, [resource.reload, workspaceId])

  const createReport = useCallback((input) => write('create', (options) => api.createReport(input, options)), [api, write])
  const reviewReport = useCallback((reportId, versionId) => write('review', (options) => api.reviewReport(reportId, versionId, options)), [api, write])
  const createParentContact = useCallback((input) => write('contact', (options) => api.createParentContact(input, options)), [api, write])
  const createDelivery = useCallback((reportId, input) => write('delivery', (options) => api.createDelivery(reportId, input, options)), [api, write])
  const processDelivery = useCallback((deliveryId) => write('process', (options) => api.processDelivery(deliveryId, options)), [api, write])
  const getDelivery = useCallback(async (deliveryId) => {
    const response = await api.getDelivery(deliveryId, { workspaceId })
    return response.data
  }, [api, workspaceId])

  return { ...resource, createReport, reviewReport, createParentContact, createDelivery, processDelivery, getDelivery, mutationState }
}
