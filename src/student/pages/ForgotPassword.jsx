import { Link } from 'react-router-dom'
import { GlassPanel } from '../components/Glass.jsx'
import { BrandMark, DiamondRule } from '../components/BrandMark.jsx'

export default function ForgotPassword() {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
      <GlassPanel
        tone="crystal"
        sheen
        className="student-crystal-card student-enter w-[620px] max-w-full rounded-[40px] px-12 py-11"
      >
        <div className="flex justify-center">
          <BrandMark size={30} textClass="text-h2" />
        </div>
        <h1 className="mt-7 text-center font-serif text-[40px] font-bold leading-tight text-ink-900 tracking-[0.16em]">
          忘记密码
        </h1>
        <DiamondRule className="mt-4" />
        <p className="mt-8 text-center text-title leading-relaxed text-ink-700">
          请找班主任重置密码，老师会把新密码告诉你
        </p>
        <Link
          to="/student/login"
          className="student-primary-btn mt-9 flex h-16 w-full items-center justify-center rounded-[24px] text-title font-semibold text-white"
        >
          返回登录
        </Link>
      </GlassPanel>
    </div>
  )
}
