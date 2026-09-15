// 举报审核（仅管理员）：服务端已按被举报动态聚合，可删除内容或忽略举报。
const feed = require('../../utils/feed.js')
const toast = require('../../utils/toast.js')

Page({
  data: {
    rows: [],
    loaded: false,
    loading: false,
    error: false,
    errorTip: '',
    myOpenid: '',
    showConfirm: false,
    confirmOp: '',
    confirmIndex: -1,
    confirmTitle: ''
  },

  onShow() {
    this.load()
  },

  load() {
    if (this.data.loading) return
    this.setData({ loading: true, error: false, errorTip: '' })
    feed.adminReportList().then((res) => {
      if (!res || !res.ok) {
        const tip = res && res.code === 'forbidden' ? '当前账号不是管理员' : '加载失败，请重试'
        // 无权限时把自己的 openid 显示出来，方便加进管理员白名单。
        this.setData({
          loading: false,
          loaded: true,
          error: true,
          errorTip: tip,
          myOpenid: (res && res.openid) || '',
          rows: []
        })
        return
      }
      // WXML 不能调用数组方法，举报人文本在这里拼好
      const rows = (res.rows || []).map(function (row) {
        return Object.assign({}, row, { reportersText: (row.reporters || []).join('、') })
      })
      this.setData({ rows: rows, loading: false, loaded: true, error: false })
    })
  },

  onRetry() {
    this.load()
  },

  onDeleteTap(e) {
    this.openConfirm('delete', e.currentTarget.dataset.index)
  },

  onIgnoreTap(e) {
    this.openConfirm('ignore', e.currentTarget.dataset.index)
  },

  openConfirm(op, index) {
    const row = this.data.rows[index]
    if (!row) return
    this.setData({
      showConfirm: true,
      confirmOp: op,
      confirmIndex: index,
      confirmTitle: op === 'delete' ? '删除这条动态？' : '忽略这些举报？'
    })
  },

  onCancelConfirm() {
    this.setData({ showConfirm: false, confirmOp: '', confirmIndex: -1 })
  },

  // 处理完直接从列表移除：无论删除还是忽略，服务端都已把该对象的举报结案。
  confirmAction() {
    const index = this.data.confirmIndex
    const op = this.data.confirmOp
    const row = this.data.rows[index]
    this.setData({ showConfirm: false, confirmOp: '', confirmIndex: -1 })
    if (!row) return
    feed.adminReportResolve(row.targetId, op).then((res) => {
      if (!res || !res.ok) {
        toast.show(res && res.code === 'forbidden' ? '当前账号不是管理员' : '操作失败，请重试')
        return
      }
      const rows = this.data.rows.slice()
      rows.splice(index, 1)
      this.setData({ rows: rows })
      toast.show(op === 'delete' ? '已删除' : '已忽略', { success: true })
    }).catch(() => {
      toast.show('操作失败，请重试')
    })
  },

  noop() {}
})
