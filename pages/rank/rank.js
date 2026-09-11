// pages/rank/rank.js 排行榜（按月累计训练时长排名）
const rank = require('../../utils/rank.js')
const account = require('../../utils/account.js')

Page({
  data: {
    month: '',
    monthLabel: '',
    rows: [],
    me: { minutes: 0, days: 0, rank: 0 },
    loaded: false,
    loading: false,
    error: false,
    showLoginDialog: false
  },

  onShow() {
    // 未登录不拉取榜单（云端接口需要 openid），引导去「我的」页一键登录。
    if (!account.requireLogin()) {
      if (!this.data.showLoginDialog) this.setData({ showLoginDialog: true })
      return
    }
    // 30 秒内重复进入（如从详情页返回）不重复请求。
    const now = Date.now()
    if (this._lastLoad && now - this._lastLoad < 30000) return
    this.load()
  },

  load() {
    this._lastLoad = Date.now()
    const month = rank.currentMonth()
    this.setData({ month: month, monthLabel: rank.monthLabel(month), loading: true, error: false })
    return rank.fetch(month).then((res) => {
      if (!res || !res.ok) {
        this._lastLoad = 0
        this.setData({ loading: false, loaded: true, error: true })
        return
      }
      this.setData({
        month: res.month,
        monthLabel: rank.monthLabel(res.month),
        rows: res.rows,
        me: res.me,
        loading: false,
        loaded: true,
        error: false
      })
    }).catch(() => {
      this._lastLoad = 0
      this.setData({ loading: false, loaded: true, error: true })
    })
  },

  onRetry() {
    this.load()
  },

  // 头像临时链接失效（或云函数换链失败回退了 cloud://）：清空该行头像，
  // 落到已有的文字头像兜底，避免破图。
  onAvatarError(e) {
    const index = e.currentTarget.dataset.index
    if (index == null) return
    this.setData({ ['rows[' + index + '].avatar']: '' })
  },

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
