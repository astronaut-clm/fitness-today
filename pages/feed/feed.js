// pages/feed/feed.js 铁友圈（跨用户动态）
const feed = require('../../utils/feed.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')

Page({
  data: {
    rows: [],
    loaded: false,
    loading: false,
    loadingMore: false,
    hasMore: true,
    error: false,
    showLoginDialog: false,
    showPostDialog: false,
    draft: '',
    draftLen: 0,
    posting: false,
    showDeleteDialog: false,
    deleteTarget: -1,
    showReportDialog: false,
    reportTarget: '',
    // 评论半屏面板
    showComments: false,
    commentPostId: '',
    commentPostIndex: -1,
    comments: [],
    commentsLoaded: false,
    commentsLoading: false,
    commentsLoadingMore: false,
    commentsHasMore: true,
    commentTotal: 0,
    commentDraft: '',
    commentDraftLen: 0,
    commentSending: false,
    showCommentDelete: false,
    commentDeleteId: ''
  },

  onShow() {
    // 未登录不拉取（云端接口需要 openid），引导去「我的」页一键登录。
    if (!account.requireLogin()) {
      if (!this.data.showLoginDialog) this.setData({ showLoginDialog: true })
      return
    }
    if (!this.data.loaded) this.load()
  },

  load() {
    if (this.data.loading) return Promise.resolve()
    this.setData({ loading: true, error: false })
    return feed.list(0).then((res) => {
      if (!res || !res.ok) {
        this.setData({ loading: false, loaded: true, error: true })
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
      this.setData({ loading: false, loaded: true, error: true })
    })
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore || !this.data.rows.length) return
    const cursor = this.data.rows[this.data.rows.length - 1].createdAt
    this.setData({ loadingMore: true })
    feed.list(cursor).then((res) => {
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

  // ---- 发布 ----
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

  // ---- 点赞（乐观更新，失败回滚） ----
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

  // ---- 更多：自己的帖子弹删除，别人的弹举报 ----
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
    const postId = this.data.reportTarget
    this.setData({ showReportDialog: false, reportTarget: '' })
    if (!postId) return
    feed.report(postId, '').then((res) => {
      if (!res || !res.ok) {
        toast.show('举报失败，请重试')
        return
      }
      toast.show('已收到举报', { success: true })
    }).catch(() => {
      toast.show('举报失败，请重试')
    })
  },

  // ---- 评论半屏面板 ----
  openComments(e) {
    const index = e.currentTarget.dataset.index
    const row = this.data.rows[index]
    if (!row) return
    this.setData({
      showComments: true,
      commentPostId: row.id,
      commentPostIndex: index,
      comments: [],
      commentsLoaded: false,
      commentsLoading: false,
      commentsLoadingMore: false,
      commentsHasMore: true,
      commentTotal: Number(row.commentCount) || 0,
      commentDraft: '',
      commentDraftLen: 0
    })
    this.loadComments()
  },

  closeComments() {
    if (this.data.commentSending) return
    this.setData({
      showComments: false,
      commentPostId: '',
      commentPostIndex: -1,
      comments: [],
      commentsLoaded: false
    })
  },

  loadComments() {
    if (this.data.commentsLoading) return
    const postId = this.data.commentPostId
    if (!postId) return
    this.setData({ commentsLoading: true })
    feed.comments(postId, 0).then((res) => {
      // 切帖/关面板后到达的旧请求直接丢弃
      if (this.data.commentPostId !== postId) return
      if (!res || !res.ok) {
        this.setData({ commentsLoading: false, commentsLoaded: true })
        toast.show('评论加载失败')
        return
      }
      this.setData({
        comments: res.rows,
        commentsHasMore: res.hasMore,
        commentsLoading: false,
        commentsLoaded: true
      })
    }).catch(() => {
      this.setData({ commentsLoading: false, commentsLoaded: true })
      toast.show('评论加载失败')
    })
  },

  loadMoreComments() {
    if (this.data.commentsLoading || this.data.commentsLoadingMore || !this.data.commentsHasMore || !this.data.comments.length) return
    const postId = this.data.commentPostId
    const cursor = this.data.comments[this.data.comments.length - 1].createdAt
    this.setData({ commentsLoadingMore: true })
    feed.comments(postId, cursor).then((res) => {
      if (this.data.commentPostId !== postId) return
      if (!res || !res.ok) {
        this.setData({ commentsLoadingMore: false })
        return
      }
      this.setData({
        comments: this.data.comments.concat(res.rows),
        commentsHasMore: res.hasMore,
        commentsLoadingMore: false
      })
    }).catch(() => {
      this.setData({ commentsLoadingMore: false })
    })
  },

  onCommentInput(e) {
    const val = String((e.detail && e.detail.value) || '').slice(0, 200)
    this.setData({ commentDraft: val, commentDraftLen: val.length })
  },

  submitComment() {
    if (this.data.commentSending) return
    const content = String(this.data.commentDraft || '').trim()
    if (!content) {
      toast.show('先写点什么吧')
      return
    }
    const postId = this.data.commentPostId
    if (!postId) return
    this.setData({ commentSending: true })
    feed.comment(postId, content).then((res) => {
      this.setData({ commentSending: false })
      if (!res || !res.ok) {
        const code = (res && res.code) || ''
        if (code === 'risky' || code === 'review') toast.show('内容未通过安全检测，请修改后重试')
        else if (code === 'too_fast') toast.show('评论太快啦，歇会儿再发')
        else if (code === 'not_found') toast.show('动态已不存在')
        else toast.show('评论失败，请重试')
        return
      }
      this.setData({ commentDraft: '', commentDraftLen: 0 })
      this.loadComments()
      this.bumpCommentCount(1)
    }).catch(() => {
      this.setData({ commentSending: false })
      toast.show('评论失败，请重试')
    })
  },

  // 同步列表里对应帖子的评论数（+1 / -1）
  bumpCommentCount(delta) {
    const index = this.data.commentPostIndex
    if (index < 0) return
    const row = this.data.rows[index]
    if (!row) return
    const next = Math.max(0, (Number(row.commentCount) || 0) + delta)
    this.setData({
      ['rows[' + index + '].commentCount']: next,
      commentTotal: Math.max(0, this.data.commentTotal + delta)
    })
  },

  onDeleteCommentTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this.setData({ showCommentDelete: true, commentDeleteId: id })
  },

  onCancelCommentDelete() {
    this.setData({ showCommentDelete: false, commentDeleteId: '' })
  },

  confirmCommentDelete() {
    const id = this.data.commentDeleteId
    this.setData({ showCommentDelete: false, commentDeleteId: '' })
    if (!id) return
    feed.removeComment(id).then((res) => {
      if (!res || !res.ok) {
        toast.show((res && res.code === 'forbidden') ? '只能删除自己的评论' : '删除失败，请重试')
        return
      }
      this.setData({ comments: this.data.comments.filter((c) => c.id !== id) })
      this.bumpCommentCount(-1)
      toast.show('已删除', { success: true })
    }).catch(() => {
      toast.show('删除失败，请重试')
    })
  },

  // 登录引导弹层
  onCancelLogin() {
    this.setData({ showLoginDialog: false })
    wx.navigateBack({ fail: function () {} })
  },

  onConfirmLogin() {
    this.setData({ showLoginDialog: false })
    wx.switchTab({ url: '/pages/checkin/checkin' })
  },

  noop() {}
})
