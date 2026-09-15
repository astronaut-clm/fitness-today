const feed = require('../../utils/feed.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')
const avatarView = require('../../utils/avatar.js')

// 超过该时长后重进页面静默刷新首页，顺带更新过期的头像临时链接（约 2 小时）。
const FEED_REFRESH_INTERVAL = 10 * 60 * 1000

Page({
  data: {
    rows: [],
    loaded: false,
    loading: false,
    loadingMore: false,
    hasMore: true,
    error: false,
    showPostDialog: false,
    draft: '',
    draftLen: 0,
    posting: false,
    showDeleteDialog: false,
    deleteTarget: -1,
    showReportDialog: false,
    reportTarget: ''
  },

  onShow() {
    // 铁友圈仅从已登录的首页进入；异常无登录态时直接返回，不发起需要 openid 的请求。
    if (!account.requireLogin()) { wx.navigateBack({ fail: function () {} }); return }
    if (!this.data.loaded) {
      this.load()
      return
    }
    // 已加载过：距上次加载超过阈值才重进刷新，避免频繁切页重复请求。
    const now = Date.now()
    if (this._lastLoad && now - this._lastLoad < FEED_REFRESH_INTERVAL) return
    this.load(true)
  },

  // silent：后台静默刷新，失败时保留原列表，不回退到整页错误态。
  load(silent) {
    if (this.data.loading) return Promise.resolve()
    this._lastLoad = Date.now()
    this.setData({ loading: true, error: false })
    return feed.list(0).then((res) => {
      if (!res || !res.ok) {
        this.setData(silent ? { loading: false } : { loading: false, loaded: true, error: true })
        return
      }
      this.setData({
        rows: res.rows,
        hasMore: res.hasMore,
        loading: false,
        loaded: true,
        error: false
      })
    }).catch(() => {
      this.setData(silent ? { loading: false } : { loading: false, loaded: true, error: true })
    })
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore || !this.data.rows.length) return Promise.resolve()
    const cursor = this.data.rows[this.data.rows.length - 1].createdAt
    this.setData({ loadingMore: true })
    return feed.list(cursor).then((res) => {
      if (!res || !res.ok) {
        this.setData({ loadingMore: false })
        return
      }
      this.setData({
        rows: this.data.rows.concat(res.rows),
        hasMore: res.hasMore,
        loadingMore: false
      })
    }).catch(() => {
      this.setData({ loadingMore: false })
    })
  },

  onRetry() {
    this.load()
  },

  // 头像链接失效时清空该行头像，落到文字头像兜底，避免破图。
  onAvatarError(e) {
    avatarView.clearRow(this, 'rows', e.currentTarget.dataset.index)
  },

  openPost() {
    this.setData({ showPostDialog: true, draft: '', draftLen: 0 })
  },

  closePost() {
    if (this.data.posting) return
    this.setData({ showPostDialog: false })
  },

  onDraftInput(e) {
    const val = String((e.detail && e.detail.value) || '').slice(0, 500)
    this.setData({ draft: val, draftLen: val.length })
  },

  submitPost() {
    if (this.data.posting) return
    const content = String(this.data.draft || '').trim()
    if (!content) {
      toast.show('请先写点什么')
      return
    }
    this.setData({ posting: true })
    feed.create(content).then((res) => {
      this.setData({ posting: false })
      if (!res || !res.ok) {
        const code = (res && res.code) || ''
        if (code === 'risky' || code === 'review') toast.show('内容未通过安全检测，请修改后重试')
        else if (code === 'too_fast') toast.show('发得有点快，歇会儿再发')
        else toast.show('发布失败，请重试')
        return
      }
      this.setData({ showPostDialog: false, draft: '', draftLen: 0 })
      toast.show('发布成功', { success: true })
      this.load()
    }).catch(() => {
      this.setData({ posting: false })
      toast.show('发布失败，请重试')
    })
  },

  // 乐观更新：失败回滚
  onLike(e) {
    const index = e.currentTarget.dataset.index
    const row = this.data.rows[index]
    if (!row) return
    const liked = !row.liked
    const count = Math.max(0, Number(row.likeCount || 0) + (liked ? 1 : -1))
    this.setData({
      ['rows[' + index + '].liked']: liked,
      ['rows[' + index + '].likeCount']: count
    })
    feed.like(row.id).then((res) => {
      if (!res || !res.ok) {
        this.setData({
          ['rows[' + index + '].liked']: row.liked,
          ['rows[' + index + '].likeCount']: row.likeCount
        })
        toast.show('操作失败，请重试')
        return
      }
      this.setData({
        ['rows[' + index + '].liked']: res.liked,
        ['rows[' + index + '].likeCount']: res.likeCount
      })
    }).catch(() => {
      this.setData({
        ['rows[' + index + '].liked']: row.liked,
        ['rows[' + index + '].likeCount']: row.likeCount
      })
      toast.show('操作失败，请重试')
    })
  },

  // 自己的帖子弹删除，别人的弹举报
  onMore(e) {
    const index = e.currentTarget.dataset.index
    const row = this.data.rows[index]
    if (!row) return
    if (row.isMe) this.setData({ showDeleteDialog: true, deleteTarget: index })
    else this.setData({ showReportDialog: true, reportTarget: row.id })
  },

  onCancelDelete() {
    this.setData({ showDeleteDialog: false, deleteTarget: -1 })
  },

  confirmDelete() {
    const index = this.data.deleteTarget
    const row = this.data.rows[index]
    this.setData({ showDeleteDialog: false, deleteTarget: -1 })
    if (!row) return
    feed.remove(row.id).then((res) => {
      if (!res || !res.ok) {
        toast.show((res && res.code === 'forbidden') ? '只能删除自己的动态' : '删除失败，请重试')
        return
      }
      const rows = this.data.rows.slice()
      rows.splice(index, 1)
      this.setData({ rows: rows })
      toast.show('已删除', { success: true })
    }).catch(() => {
      toast.show('删除失败，请重试')
    })
  },

  onCancelReport() {
    this.setData({ showReportDialog: false, reportTarget: '' })
  },

  confirmReport() {
    const targetId = this.data.reportTarget
    this.setData({ showReportDialog: false, reportTarget: '' })
    if (!targetId) return
    feed.report(targetId, '').then((res) => {
      if (!res || !res.ok) {
        toast.show('举报失败，请重试')
        return
      }
      toast.show('已收到举报', { success: true })
    }).catch(() => {
      toast.show('举报失败，请重试')
    })
  },

  noop() {}
})
