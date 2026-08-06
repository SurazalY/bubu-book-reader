import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, Field, IconBtn, StatusTag, SubHead } from '../../components/Controls.jsx'
import { Modal } from '../../components/Overlay.jsx'
import BookFlip from '../../components/BookFlip.jsx'
import { getPages, IMPORT_CANDIDATES } from '../../data/fixtures/books.js'

// 书目导入：选文件 →（纯文本先确认信息）→ 阅读器式预览 → 上传。
// 交付说明的关键点：预览必须是和学生端一样的翻页阅读器，能翻页也能跳页；
// 底部固定「上一步 / 取消 / 主操作」，纯文本必须先确认书名作者与分章方式。

const KIND_ICON = { epub: 'BookOpen', txt: 'FileText', pdf: 'FileType2' }

const STEPS = [
  { key: 'pick', label: '选择文件' },
  { key: 'edit', label: '确认信息' },
  { key: 'preview', label: '预览正文' },
  { key: 'done', label: '上传' },
]

export default function BookImport() {
  const navigate = useNavigate()
  const [step, setStep] = useState('pick')
  const [file, setFile] = useState(null)
  const [meta, setMeta] = useState(null)
  const [page, setPage] = useState(1)
  const [doneOpen, setDoneOpen] = useState(false)

  // 预览页按确认后的章数重新分页：改了分章方式，预览跟着变
  const pages = useMemo(() => getPages({ chapters: meta?.chapters || 10 }, 10), [meta?.chapters])

  const pick = (f) => {
    setFile(f)
    setMeta({
      title: f.parsed.title,
      author: f.parsed.author === '（未识别）' ? '' : f.parsed.author,
      chapters: f.parsed.chapters || 8,
      grade: '三年级',
      genre: 'story',
      splitBy: f.needEdit ? 'blank-line' : 'origin',
    })
    setPage(1)
    setStep(f.needEdit ? 'edit' : 'preview')
  }

  const activeIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <PagePanel
      title="导入书目"
      desc="导入后先进入「审核中」，审核通过才上架到学生端；解析异常的地方会在预览里标出来。"
      toolbar={
        <Btn icon="ArrowLeft" onClick={() => navigate('/console/teaching/books')}>
          返回书库
        </Btn>
      }
    >
      <ol className="flex items-center gap-1.5 mb-4">
        {STEPS.filter((s) => s.key !== 'edit' || file?.needEdit).map((s, i, arr) => {
          const idx = STEPS.findIndex((x) => x.key === s.key)
          const state = idx < activeIndex ? 'done' : idx === activeIndex ? 'now' : 'todo'
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className={cx(
                  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] border',
                  state === 'now'
                    ? 'bg-brand-50 border-brand-200 text-brand-700 font-medium'
                    : state === 'done'
                      ? 'bg-success-50 border-success-100 text-success-700'
                      : 'bg-white/60 border-ink-200 text-ink-400',
                )}
              >
                {state === 'done' ? (
                  <Icon name="Check" className="w-3.5 h-3.5" strokeWidth={2.4} />
                ) : (
                  <span className="tabular-nums">{i + 1}</span>
                )}
                {s.label}
              </span>
              {i < arr.length - 1 && <Icon name="ChevronRight" className="w-3.5 h-3.5 text-ink-300" />}
            </li>
          )
        })}
      </ol>

      {step === 'pick' && <PickStep onPick={pick} />}

      {step === 'edit' && (
        <EditStep
          file={file}
          meta={meta}
          setMeta={setMeta}
          onBack={() => setStep('pick')}
          onNext={() => setStep('preview')}
          onCancel={() => navigate('/console/teaching/books')}
        />
      )}

      {step === 'preview' && (
        <PreviewStep
          file={file}
          meta={meta}
          pages={pages}
          page={page}
          setPage={setPage}
          onBack={() => setStep(file?.needEdit ? 'edit' : 'pick')}
          onCancel={() => navigate('/console/teaching/books')}
          onUpload={() => setDoneOpen(true)}
        />
      )}

      <Modal
        open={doneOpen}
        onClose={() => setDoneOpen(false)}
        icon="CircleCheck"
        title="已提交导入"
        desc="演示环境不会真正上传文件。"
        width="max-w-[460px]"
        footer={
          <>
            <Btn onClick={() => setDoneOpen(false)}>继续导入</Btn>
            <Btn tone="primary" onClick={() => navigate('/console/teaching/books')}>
              回到书库
            </Btn>
          </>
        }
      >
        <div className="space-y-2 text-[13px] text-ink-700">
          <p className="flex items-center gap-2">
            《{meta?.title}》已提交，状态为
            <StatusTag tone="warning">审核中</StatusTag>
          </p>
          <p className="text-[12.5px] text-ink-500 leading-relaxed">
            审核期间学生端看不到这本书；通过后自动上架，并给导入人发一条站内通知。
          </p>
        </div>
      </Modal>
    </PagePanel>
  )
}

function PickStep({ onPick }) {
  return (
    <div>
      <div className="rounded-xl border border-dashed border-ink-200 bg-white/55 px-6 py-8 text-center">
        <Icon name="Upload" className="w-7 h-7 text-ink-400 mx-auto" strokeWidth={1.6} />
        <p className="text-[13.5px] font-medium text-ink-700 mt-2.5">把文件拖到这里，或从下面的待导入列表选一个</p>
        <p className="text-[12px] text-ink-500 mt-1.5">
          支持 EPUB / TXT / PDF，单个文件不超过 50 MB；演示环境不接受真实文件，请直接选下面的样例。
        </p>
      </div>

      <SubHead icon="FolderOpen" title="待导入文件（样例）" className="mt-4" />
      <ul className="space-y-2">
        {IMPORT_CANDIDATES.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onPick(f)}
              className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-ink-150 bg-white/65 hover:border-brand-200 hover:bg-white transition text-left"
            >
              <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                <Icon name={KIND_ICON[f.kind]} className="w-[18px] h-[18px]" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-ink-900 truncate">{f.name}</span>
                  <span className="text-[11px] text-ink-400 shrink-0">{f.size}</span>
                  {f.needEdit && <StatusTag tone="warning">需要先确认信息</StatusTag>}
                </div>
                <p className="text-[11.5px] text-ink-500 mt-0.5 truncate">
                  解析结果：{f.parsed.title} · {f.parsed.author} ·{' '}
                  {f.parsed.chapters ? `${f.parsed.chapters} 章 / ${f.parsed.pages} 页` : '未识别章节'} · {f.parsed.words}
                </p>
                {f.warnings.map((w) => (
                  <p key={w} className="text-[11.5px] text-warning-700 mt-1 flex items-start gap-1.5">
                    <Icon name="TriangleAlert" className="w-3.5 h-3.5 mt-px shrink-0" />
                    {w}
                  </p>
                ))}
              </div>
              <Icon name="ChevronRight" className="w-4 h-4 text-ink-300 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EditStep({ file, meta, setMeta, onBack, onNext, onCancel }) {
  const set = (k) => (e) => setMeta((m) => ({ ...m, [k]: e.target.value }))
  const canNext = meta.title.trim() && meta.author.trim()

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-warning-50/80 border border-warning-100 mb-3.5">
        <Icon name="FileText" className="w-4 h-4 mt-px text-warning-600 shrink-0" strokeWidth={1.9} />
        <p className="text-[12.5px] text-ink-700">
          <span className="font-medium">{file.name}</span> 是纯文本，没有章节结构。先确认书名、作者与分章方式，再进入预览。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3">
        <label className="block">
          <span className="block text-[12px] text-ink-600 mb-1.5">书名（必填）</span>
          <input value={meta.title} onChange={set('title')} className="console-input" />
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-600 mb-1.5">作者（必填）</span>
          <input
            value={meta.author}
            onChange={set('author')}
            placeholder="文件里没识别到，请手动填写"
            className="console-input"
          />
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-600 mb-1.5">分章方式</span>
          <select value={meta.splitBy} onChange={set('splitBy')} className="console-input">
            <option value="blank-line">按空行分章</option>
            <option value="chapter-word">按「第 N 章」关键词分章</option>
            <option value="fixed">按固定字数分章</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-600 mb-1.5">预计章数</span>
          <input
            type="number"
            min={1}
            max={40}
            value={meta.chapters}
            onChange={(e) => setMeta((m) => ({ ...m, chapters: Number(e.target.value) || 1 }))}
            className="console-input"
          />
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-600 mb-1.5">适用年级</span>
          <select value={meta.grade} onChange={set('grade')} className="console-input">
            {['三年级', '四年级', '五年级', '六年级'].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-600 mb-1.5">分类</span>
          <select value={meta.genre} onChange={set('genre')} className="console-input">
            <option value="story">儿童文学</option>
            <option value="science">科普百科</option>
            <option value="classic">名著节选</option>
            <option value="poem">诗歌散文</option>
          </select>
        </label>
      </div>

      <StepFooter
        onBack={onBack}
        onCancel={onCancel}
        hint={canNext ? '预览里可以逐页确认分章效果' : '书名与作者填完才能进入预览'}
        primary={
          <Btn tone="primary" iconRight="ArrowRight" disabled={!canNext} onClick={onNext}>
            下一步：预览正文
          </Btn>
        }
      />
    </div>
  )
}

function PreviewStep({ file, meta, pages, page, setPage, onBack, onCancel, onUpload }) {
  const [jump, setJump] = useState('')
  const total = pages.length

  const go = () => {
    const n = Number(jump)
    if (n >= 1 && n <= total) setPage(n)
    setJump('')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_236px] gap-4 flex-1 min-h-0">
        <GlassCard className="p-3 flex flex-col min-h-0">
          <div className="flex items-center gap-2 pb-2.5 border-b border-ink-150/70">
            <Icon name="BookOpen" className="w-4 h-4 text-[#3E9E8F]" strokeWidth={1.9} />
            <span className="text-[13px] font-semibold text-ink-800 truncate">{meta.title} · 正文预览</span>
            <div className="flex-1" />
            <span className="text-[11.5px] text-ink-500 tabular-nums">
              第 {page} / {total} 页
            </span>
          </div>

          <BookFlip pages={pages} page={page} onPageChange={setPage} className="flex-1 py-2" minHeight={340} />

          <div className="flex items-center gap-2 pt-2.5 border-t border-ink-150/70">
            <IconBtn icon="ChevronLeft" title="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)} />
            <IconBtn icon="ChevronRight" title="下一页" disabled={page >= total} onClick={() => setPage(page + 1)} />
            <div className="flex-1" />
            <span className="text-[11.5px] text-ink-500">跳到第</span>
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              placeholder={String(page)}
              aria-label="跳到指定页"
              className="w-12 h-7 px-2 rounded-md border border-ink-200 bg-white/85 text-[12px] text-center tabular-nums outline-none focus:border-brand-300"
            />
            <span className="text-[11.5px] text-ink-500">页</span>
            <Btn size="sm" onClick={go} disabled={!jump}>
              跳转
            </Btn>
          </div>
        </GlassCard>

        <aside className="xl:border-l xl:border-ink-150/70 xl:pl-4 min-w-0">
          <SubHead icon="ListChecks" title="解析结果" />
          <Field label="文件">{file.name}</Field>
          <Field label="书名">{meta.title}</Field>
          <Field label="作者">{meta.author || '未填写'}</Field>
          <Field label="章数">{meta.chapters} 章</Field>
          <Field label="预览页">{total} 页</Field>
          <Field label="适用年级">{meta.grade}</Field>

          {file.warnings.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {file.warnings.map((w) => (
                <p key={w} className="text-[11.5px] text-warning-700 flex items-start gap-1.5">
                  <Icon name="TriangleAlert" className="w-3.5 h-3.5 mt-px shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}

          <p className="text-[11.5px] text-ink-500 leading-relaxed mt-3 pt-3 border-t border-ink-150/70">
            预览用的就是学生端同一套翻页阅读器：可以拖角翻页、点箭头翻页，也能直接跳到指定页确认分章位置。
          </p>
        </aside>
      </div>

      <StepFooter
        onBack={onBack}
        onCancel={onCancel}
        hint="上传后状态为「审核中」，通过后才在学生端出现"
        primary={
          <Btn tone="primary" icon="Upload" onClick={onUpload}>
            上传
          </Btn>
        }
      />
    </div>
  )
}

// 底部固定三按钮：上一步 / 取消 / 主操作，位置在每个步骤都一致
function StepFooter({ onBack, onCancel, primary, hint }) {
  return (
    <div className="mt-4 pt-3 border-t border-ink-150/70 flex items-center gap-2">
      <Btn icon="ArrowLeft" onClick={onBack}>
        上一步
      </Btn>
      <Btn tone="ghost" onClick={onCancel}>
        取消
      </Btn>
      <div className="flex-1" />
      {hint && <span className="text-[11.5px] text-ink-500">{hint}</span>}
      {primary}
    </div>
  )
}
