import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { createStudentApi } from '../../api/student.js'
import { useApiResource } from '../../api/useApiResource.js'
import { formatIsoTime } from '../../console/pages/accounts/identityUi.js'
import { GlassPanel } from '../components/Glass.jsx'
import { BrandMark, DiamondRule } from '../components/BrandMark.jsx'

const studentApi = createStudentApi()

export default function Onboarding() {
  const load = useCallback(async () => {
    const response = await studentApi.getOnboardingMe()
    return { data: response.data, meta: response.meta }
  }, [])
  const resource = useApiResource(load)
  const requests = resource.data?.enrollmentRequests || []
  const pending = requests.find((item) => item.status === 'pending')
  const rejected = !pending && requests.some((item) => item.status === 'rejected')
  const latestRejected = [...requests].reverse().find((item) => item.status === 'rejected')

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
      <GlassPanel tone="crystal" sheen className="student-crystal-card student-enter w-[620px] max-w-full rounded-[40px] px-12 py-11">
        <div className="flex justify-center">
          <BrandMark size={30} textClass="text-h2" />
        </div>
        <h1 className="mt-7 text-center font-serif text-[32px] font-bold text-ink-900">等待入班审批</h1>
        <DiamondRule className="mt-4" />

        {resource.status === 'error' ? (
          <p className="mt-8 text-center text-caption text-[#D0492F]">{resource.error?.message || '无法读取入班状态'}</p>
        ) : pending ? (
          <div className="mt-8 space-y-2 text-center text-caption text-ink-600">
            <p>你的入班申请正在等待老师审批，批准前不能进入学生端。</p>
            <p>申请时间：{formatIsoTime(pending.requestedAt)}</p>
            <p>班级编号：{pending.classId}</p>
          </div>
        ) : rejected ? (
          <div className="mt-8 space-y-2 text-center text-caption text-ink-600">
            <p>上次申请未通过，可以重新选择预制班级再次申请。</p>
            {latestRejected?.requestedAt && <p>上次申请时间：{formatIsoTime(latestRejected.requestedAt)}</p>}
            <p>请使用学校发放的注册链接重新选班。登录后的可选班级目录由服务端公开 token 目录提供，本页不另造班级名单。</p>
          </div>
        ) : (
          <p className="mt-8 text-center text-caption text-ink-500">
            {resource.status === 'loading' ? '正在读取入班状态。' : '当前没有待审申请。批准后请重新登录进入学生端。'}
          </p>
        )}

        <Link to="/student/login" className="mt-8 block text-center text-caption text-ink-500">返回登录</Link>
      </GlassPanel>
    </div>
  )
}
