import { Navigate, Route, Routes } from 'react-router-dom'
import { StudentProvider } from './state/StudentContext.jsx'
import Backdrop from './components/Backdrop.jsx'
import StudentShell from './components/StudentShell.jsx'
import Home from './pages/Home.jsx'
import Shelf from './pages/Shelf.jsx'
import Me from './pages/Me.jsx'
import AccountSettings from './pages/settings/AccountSettings.jsx'
import Login from './pages/Login.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import Register from './pages/Register.jsx'
import Onboarding from './pages/Onboarding.jsx'
import Reader from './pages/Reader.jsx'
import BookDetail from './pages/BookDetail.jsx'
import Lists from './pages/Lists.jsx'
import ListDetail from './pages/ListDetail.jsx'
import Footprint from './pages/Footprint.jsx'
import Highlights from './pages/Highlights.jsx'
import Notes from './pages/Notes.jsx'
import Usage from './pages/Usage.jsx'
import TeacherHub from './pages/TeacherHub.jsx'
import MyPosts from './pages/MyPosts.jsx'
import Level from './pages/Level.jsx'
import Ranking from './pages/Ranking.jsx'
import Community from './pages/Community.jsx'
import Compose from './pages/Compose.jsx'
import PostDetail from './pages/PostDetail.jsx'
import { StudentCommunityProvider } from './community/CommunityRuntimeContext.jsx'

export default function StudentApp() {
  return (
    <div className="student-root">
      <Backdrop />
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="register" element={<Register />} />
        <Route path="register/:token" element={<Register />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="*" element={<StudentRuntime />} />
      </Routes>
    </div>
  )
}

function StudentRuntime() {
  return (
    <StudentProvider>
      <StudentCommunityProvider>
        <Routes>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="reader/:bookId" element={<Reader />} />
          <Route path="books/:bookId" element={<FullPage><BookDetail /></FullPage>} />
          <Route path="community/compose" element={<FullPage><Compose /></FullPage>} />
          <Route path="community/:postId" element={<FullPage><PostDetail /></FullPage>} />
          <Route path="me/settings" element={<FullPage><AccountSettings /></FullPage>} />
          <Route element={<StudentShell />}>
            <Route path="home" element={<Home />} />
            <Route path="shelf" element={<Shelf />} />
            <Route path="community" element={<Community />} />
            <Route path="me" element={<Me />} />
            <Route path="me/footprint" element={<Footprint />} />
            <Route path="me/highlights" element={<Highlights />} />
            <Route path="me/notes" element={<Notes />} />
            <Route path="me/level" element={<Level />} />
            <Route path="me/usage" element={<Usage />} />
            <Route path="me/teacher" element={<TeacherHub />} />
            <Route path="me/posts" element={<MyPosts />} />
            <Route path="home/ranking" element={<Ranking />} />
            <Route path="lists" element={<Lists />} />
            <Route path="lists/:listId" element={<ListDetail />} />
            <Route path="*" element={<StudentUnavailablePage />} />
          </Route>
        </Routes>
      </StudentCommunityProvider>
    </StudentProvider>
  )
}

function FullPage({ children }) {
  return (
    <div className="student-scroll relative z-10 h-screen overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[1180px] flex-col px-8 py-7">{children}</div>
    </div>
  )
}

function StudentUnavailablePage() {
  return (
    <section className="student-enter flex min-h-full items-center justify-center pb-20">
      <div className="student-glass w-full max-w-[620px] rounded-2xl border border-white/70 bg-white/86 px-7 py-8 text-center backdrop-blur-xl">
        <p className="text-caption font-semibold text-brand-700">该页面尚未接入真实 API</p>
        <p className="mt-2 text-caption leading-relaxed text-ink-500">保留原有导航与视觉骨架，未显示任何过渡业务内容。</p>
      </div>
    </section>
  )
}
