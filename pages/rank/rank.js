// 排行榜：本月训练时长排名，由 social 云函数聚合（客户端读不到别人的记录）。
// 本页是 social.rankMonth 的唯一调用方，取数与整形都写在这里
const cloud = require('../../utils/cloud.js')
const dateUtil = require('../../utils/date.js')
const account = require('../../utils/account.js')
const throttle = require('../../utils/throttle.js')
const fontBehavior = require('../../utils/font.js').behavior

const RELOAD_INTERVAL = 30000 // 30 秒内重复进入（如从详情页返回）不重复请求

function fetchMonth(month) {
  return cloud.call('social', 'rankMonth', { month: month }).then(function (res) {
    if (!res.ok) return { ok: false }
    const rows = (res.rows || []).map(function (row) {
      return Object.assign({}, row, {
        char: account.charOf(row.nickname),
        noClass: row.rank <= 3 ? 'rank-no-' + row.rank : 'rank-no-n'
      })
    })
    return {
      ok: true,
      month: res.month || month,
      rows: rows,
      me: res.me || { minutes: 0, days: 0, rank: 0 }
    }
  })
}

Page({
  behaviors: [fontBehavior],

  data: {
    monthLabel: '',
    rows: [],
    me: { minutes: 0, days: 0, rank: 0 },
    loaded: false,
    loading: false,
    error: false
  },

  onShow() {
    // 只从已登录的首页进入；异常无登录态时不发需要 openid 的请求
    if (!account.isLoggedIn()) { wx.navigateBack({ fail: function () {} }); return }
    if (!throttle.pass(this, '_lastLoad', RELOAD_INTERVAL)) return
    this.load()
  },

  load() {
    // 手动重试也刷水位，避免连点重试连打云函数
    throttle.touch(this, '_lastLoad')
    const month = dateUtil.monthKey()
    this.setData({ monthLabel: dateUtil.monthLabelOf(month), loading: true, error: false })
    return fetchMonth(month).then((res) => {
      if (!res.ok) {
        throttle.reset(this, '_lastLoad')
        this.setData({ loading: false, loaded: true, error: true })
        return
      }
      this.setData({
        monthLabel: dateUtil.monthLabelOf(res.month),
        rows: res.rows,
        me: res.me,
        loading: false,
        loaded: true,
        error: false
      })
    }).catch((err) => {
      // 不兜住 loading 会永远为 true：页面卡在加载态，且水位已 touch，重试按钮也不出现
      console.warn('[rank] load failed', err)
      throttle.reset(this, '_lastLoad')
      this.setData({ loading: false, loaded: true, error: true })
    })
  },

  onRetry() {
    this.load()
  },

  onAvatarError(e) {
    account.clearAvatarRow(this, 'rows', e.currentTarget.dataset.index)
  },

  // 本页需登录，分享落地页统一指向首页
  onShareAppMessage() {
    return { title: '本月训练排行榜，一起动起来！', path: '/pages/index/index' }
  }
})
