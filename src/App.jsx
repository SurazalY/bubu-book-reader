import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Home from './pages/Home.jsx'

const About = lazy(() => import('./pages/About.jsx'))
const Resources = lazy(() => import('./pages/Resources.jsx'))
const Blog = lazy(() => import('./pages/Blog.jsx'))
const StudentApp = lazy(() => import('./student/StudentApp.jsx'))
const ConsoleApp = lazy(() => import('./console/ConsoleApp.jsx'))

function LegacyReaderRedirect() {
  const { bookId } = useParams()
  return <Navigate to={`/student/books/${bookId}`} replace />
}

function RouteFallback() {
  return <div className="min-h-screen" aria-busy="true" />
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* 主站页面共用顶栏 + 页脚 */}
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Navigate to="/student/shelf" replace />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/about" element={<About />} />
          <Route path="/blog" element={<Blog />} />
        </Route>
        {/* 旧阅读入口只负责跳转，不再进入历史演示数据链 */}
        <Route path="/reader" element={<Navigate to="/student/home" replace />} />
        <Route path="/reader/:bookId" element={<LegacyReaderRedirect />} />
        {/* 学生端与权限端共用一体化入口，均保持独立外壳 */}
        <Route path="/student/*" element={<StudentApp />} />
        <Route path="/console/*" element={<ConsoleApp />} />
      </Routes>
    </Suspense>
  )
}
