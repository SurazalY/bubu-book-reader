import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/ui.jsx'
import MyPostsPanel from '../components/MyPostsPanel.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'

// 我的发布与收藏（规格 §10.6）。
// 页面本身很薄：内容整块复用共读社区的「我的发布」面板，
// 数据也还是 community.mine / community.savedPosts——两处各写一套必然对不上。
export default function MyPosts({ community: injectedCommunity } = {}) {
  const { community: contextCommunity } = useStudentCommunity()
  const community = injectedCommunity ?? contextCommunity
  const navigate = useNavigate()

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHead
        title="我的发布与收藏"
        desc="你写过的每一篇都在这里，包括还在等老师看的和需要改一改的。收藏的同学内容也在下面。"
      >
        <button
          type="button"
          onClick={() => {
            community.startDraft({ scope: 'class' })
            navigate('/student/community/compose')
          }}
          className="student-btn-primary inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-caption font-semibold"
        >
          <Icon name="Plus" className="h-4 w-4" strokeWidth={2.4} />
          写一篇
        </button>
      </PageHead>

      <MyPostsPanel />
    </div>
  )
}
