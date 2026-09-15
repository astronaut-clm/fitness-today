const rank = require('../../utils/rank.js')
const account = require('../../utils/account.js')
const avatarView = require('../../utils/avatar.js')

Page({
  data: {
    monthLabel: '',
    rows: [],
    me: { minutes: 0, days: 0, rank: 0 },
    loaded: false,
    loading: false,
    error: false
  },

  onShow() {
    // 排行榜仅从已登录的首页进入；异常无登录态时直接返回，不发起需要 openid 的请求。
    if (!account.requireLogin()) { wx.navigateBack({ fail: function () {} }); return }
    // 30 秒内重复进入（如从详情页返回）不重复请求。
    const now = Date.now()
    if (this._lastLoad && now - this._lastLoad < 30000) return
    this.load()
  },

  load() {
    this._lastLoad = Date.now()
    const month = rank.currentMonth()
    this.setData({ monthLabel: rank.monthLabel(month), loading: true, error: false })
    return rank.fetch(month).then((res) => {
      if (!res || !res.ok) {
        this._lastLoad = 0
        this.setData({ loading: false, loaded: true, error: true })
        return
      }
      this.setData({
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

  // 头像链接失效时清空该行头像，落到文字头像兜底，避免破图。
  onAvatarError(e) {
    avatarView.clearRow(this, 'rows', e.currentTarget.dataset.index)
  }
})
