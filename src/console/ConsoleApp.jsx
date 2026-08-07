import { Navigate, Route, Routes } from 'react-router-dom'
import Backdrop from './components/Backdrop.jsx'
import { ConsoleProvider } from './state/ConsoleContext.jsx'
import ConsoleShell from './components/shell/ConsoleShell.jsx'
import Home from './pages/Home.jsx'
import Login from './pages/Login.jsx'
import ParentSend from './pages/reports/ParentSend.jsx'
import ReportCenter from './pages/reports/ReportCenter.jsx'
import ReportDetail from './pages/reports/ReportDetail.jsx'
import SafetyDetail from './pages/safety/SafetyDetail.jsx'
import ArrangeList from './pages/teaching/ArrangeList.jsx'
import ArrangeDetail from './pages/teaching/ArrangeDetail.jsx'
import TeacherReader from './pages/teaching/TeacherReader.jsx'
import BookLibrary from './pages/teaching/BookLibrary.jsx'
import BookDetail from './pages/teaching/BookDetail.jsx'
import Community from './pages/Community.jsx'
import ClassOverview from './pages/ClassOverview.jsx'
import EyeCare from './pages/classes/EyeCare.jsx'
import StudentDetail from './pages/accounts/StudentDetail.jsx'
import StudentDirectory from './pages/accounts/StudentDirectory.jsx'
import Privacy from './pages/usage/Privacy.jsx'
import Sessions from './pages/usage/Sessions.jsx'
import UsageOverview from './pages/usage/UsageOverview.jsx'
import Templates from './pages/reports/Templates.jsx'
import { PagePanel } from './components/PagePanel.jsx'
import { EmptyState } from './components/Controls.jsx'
import useStage4ConsoleData from './state/useStage4ConsoleData.js'
import { useConsole } from './state/ConsoleContext.jsx'
import PlatformAudit from './pages/PlatformAudit.jsx'

export default function ConsoleApp() {
  return (
    <div className="console-root">
      <Backdrop />
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="*" element={<ConsoleRuntime />} />
      </Routes>
    </div>
  )
}

function ConsoleRuntime() {
  return (
    <ConsoleProvider>
      <Routes>
        <Route element={<ConsoleShell />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<ConsoleHome />} />
          <Route path="platform/audit" element={<PlatformAuditRoute />} />
          <Route path="teaching/arrangements" element={<ArrangeList />} />
          <Route path="teaching/arrangements/:planId" element={<ArrangeDetail />} />
          <Route path="teaching/books" element={<BookLibrary />} />
          <Route path="teaching/books/:bookId" element={<BookDetail />} />
          <Route path="teaching" element={<Navigate to="/console/teaching/arrangements" replace />} />
          <Route path="teaching/reader/:bookId" element={<TeacherReader />} />
          <Route path="community" element={<Community />} />
          <Route path="classes/overview" element={<ClassOverview />} />
          <Route path="classes/eyecare" element={<EyeCare />} />
          <Route path="accounts/students" element={<StudentDirectory />} />
          <Route path="accounts/students/:studentId" element={<StudentDetail />} />
          <Route path="classes" element={<Navigate to="/console/classes/overview" replace />} />
          <Route path="usage/overview" element={<UsageOverview />} />
          <Route path="usage/sessions" element={<Sessions />} />
          <Route path="usage/privacy" element={<Privacy />} />
          <Route path="usage" element={<Navigate to="/console/usage/overview" replace />} />
          <Route path="reports" element={<ReportCenter />} />
          <Route path="reports/parents" element={<ParentSend />} />
          <Route path="reports/templates" element={<Templates />} />
          <Route path="reports/:reportId" element={<ReportDetail />} />
          <Route path="safety/:eventId" element={<SafetyDetail />} />
          <Route path="safety" element={<SafetyIndex />} />
          <Route path="*" element={<ConsoleUnavailablePage />} />
        </Route>
      </Routes>
    </ConsoleProvider>
  )
}

function ConsoleHome() {
  const { workspace } = useConsole()
  if (workspace?.scopeType === 'platform') return <Navigate to="/console/platform/audit" replace />
  return <Home />
}

function PlatformAuditRoute() {
  const { canAccessPath } = useConsole()
  if (!canAccessPath('/console/platform/audit')) {
    return (
      <PagePanel title="平台审计" desc="平台运维审计仅向平台工作空间开放">
        <EmptyState icon="ShieldCheck" title="当前工作空间无权访问平台审计" desc="请切换到平台运维工作空间后再查看审计记录。" />
      </PagePanel>
    )
  }
  return <PlatformAudit />
}

function SafetyIndex() {
  const { workspace } = useConsole()
  const resource = useStage4ConsoleData('safetyList', { workspaceId: workspace?.id })
  const firstEvent = resource.data?.items?.[0]
  const permissionDenied = resource.error?.code === 'PERMISSION_DENIED'
  if (firstEvent?.id) return <Navigate to={`/console/safety/${firstEvent.id}`} replace />
  return (
    <PagePanel title="安全事件" desc="当前范围内的真实安全事件">
      <EmptyState
        icon="ShieldCheck"
        title={resource.status === 'loading' ? '正在读取安全事件' : permissionDenied ? '当前身份无权查看安全事件' : '当前范围没有安全事件'}
        desc={permissionDenied ? '该账号未进入当前事件通知链，或已因涉事回避被排除。' : resource.error?.message || '安全事件只从后端真实接口读取。'}
      />
    </PagePanel>
  )
}

function ConsoleUnavailablePage() {
  return (
    <PagePanel title="页面尚未接入" desc="该模块保留在原权限端壳内，但尚无可用的真实 API 数据。">
      <EmptyState icon="CloudOff" title="暂不展示过渡业务内容" desc="请回到已接入的首页或安全详情。" />
    </PagePanel>
  )
}
