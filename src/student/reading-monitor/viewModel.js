export function readerPageForResolvedLocation({ resolution, locationKey, savedPosition } = {}) {
  if (!resolution?.ok) return 1
  if (savedPosition?.locationKey === locationKey
    && Number.isSafeInteger(savedPosition.pageNo)
    && savedPosition.pageNo >= 1) {
    return savedPosition.pageNo
  }
  return resolution.pageNo
}

export function reconcileFlipBootstrap({ expectedLeaf, reportedLeaf, pending } = {}) {
  if (!Number.isSafeInteger(expectedLeaf) || expectedLeaf < 0) throw new TypeError('期望书页索引无效')
  if (!Number.isSafeInteger(reportedLeaf) || reportedLeaf < 0) throw new TypeError('翻页组件书页索引无效')
  if (pending && reportedLeaf !== expectedLeaf) {
    return Object.freeze({ accept: false, correctionLeaf: expectedLeaf, pending: true })
  }
  return Object.freeze({ accept: true, correctionLeaf: null, pending: false })
}
