import { useCallback, useRef, useState } from 'react'

import { PagePanel } from '../components/PagePanel.jsx'
import ReadingStatisticsView, {
  ReadingStatisticsToolbar,
} from '../components/reading-monitor/ReadingStatisticsView.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'
import useReadingStatistics from '../state/useReadingStatistics.js'

export default function ClassOverview() {
  const { workspace } = useConsole()
  const statistics = useReadingStatistics(workspace?.id)
  const showScopeSwitcher = workspace && workspace.scopeType === 'school'
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const returnFocusRef = useRef(null)

  const handleOpenStudent = useCallback((student, trigger) => {
    returnFocusRef.current = trigger
    setSelectedStudentId(student.studentId)
  }, [])

  const handleCloseStudent = useCallback(() => {
    setSelectedStudentId(null)
  }, [])

  const handleClassChange = useCallback((classId) => {
    setSelectedStudentId(null)
    statistics.onClassChange(classId)
  }, [statistics.onClassChange])

  const handleStatDateChange = useCallback((nextDate) => {
    setSelectedStudentId(null)
    statistics.onStatDateChange(nextDate)
  }, [statistics.onStatDateChange])

  const handleScopeLevelChange = useCallback((nextLevel) => {
    setSelectedStudentId(null)
    statistics.onScopeLevelChange(nextLevel)
  }, [statistics.onScopeLevelChange])

  const handleSelectedGradeChange = useCallback((nextGrade) => {
    setSelectedStudentId(null)
    statistics.onSelectedGradeChange(nextGrade)
  }, [statistics.onSelectedGradeChange])

  return (
    <PagePanel
      title="班级阅读统计"
      desc="展示今日有效阅读、打卡与阅读行为汇总；姓名排序只用于查找，不构成学生竞争性比较。"
      className="min-w-0 max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:left-[76px] max-md:z-40 max-md:h-screen max-md:overflow-hidden max-md:rounded-none"
      bodyClassName="min-w-0 !px-4 sm:!px-6 max-md:overflow-y-auto"
    >
      <div className="mb-4 min-w-0">
        <ReadingStatisticsToolbar
          showScopeSwitcher={showScopeSwitcher}
          scopeLevel={statistics.scopeLevel}
          selectedGrade={statistics.selectedGrade}
          gradeOptions={statistics.gradeOptions}
          onScopeLevelChange={handleScopeLevelChange}
          onSelectedGradeChange={handleSelectedGradeChange}
          classOptions={statistics.classOptions}
          selectedClassId={statistics.selectedClassId}
          statDate={statistics.statDate}
          onClassChange={handleClassChange}
          onStatDateChange={handleStatDateChange}
          onRefresh={statistics.onRefresh}
          refreshDisabled={statistics.scopeResource.status === 'loading' || statistics.isRefreshing}
        />
      </div>
      <ReadingStatisticsView
        resource={statistics.scopeResource}
        keyword={keyword}
        filter={filter}
        onKeywordChange={setKeyword}
        onFilterChange={setFilter}
        selectedStudentId={selectedStudentId}
        onOpenStudent={handleOpenStudent}
        onCloseStudent={handleCloseStudent}
        returnFocusRef={returnFocusRef}
        onRetry={statistics.onRetry}
      />
    </PagePanel>
  )
}
