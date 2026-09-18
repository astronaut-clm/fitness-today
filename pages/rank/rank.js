// 排行榜页：本月训练时长排名。数据由 social 云函数聚合（客户端读不到别人的记录），
// 月份按本机时区计算；这一页是 social.rankMonth 的唯一调用方，取数与整形都写在这里
const cloud = require('../../utils/cloud.js')
const dateUtil = require('../../utils/date.js')
const account = require('../../utils/account.js')
const throttle = require('../../utils/throttle.js')
const fontBehavior = require('../../utils/font.js').behavior

// 30 秒内重复进入（如从详情页返回）不重复请求
const RELOAD_INTERVAL = 30000

function monthLabelOf(month) {
  const parts = String(month || '').split('-')
  if (parts.length < 2) return ''
  return dateUtil.monthLabel(parts[0], parts[1])
}

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
    // 排行榜仅从已登录的首页进入；异常无登录态时直接返回，不发起需要 openid 的请求
    if (!account.isLoggedIn()) { wx.navigateBack({ fail: function () {} }); return }
    if (!throttle.pass(this, '_lastLoad', RELOAD_INTERVAL)) return
    this.load()
  },

  load() {
    // 手动重试也刷新节流基准，避免连点重试连打云函数
    throttle.touch(this, '_lastLoad')
    const month = dateUtil.monthKey()
    this.setData({ monthLabel: monthLabelOf(month), loading: true, error: false })
    return fetchMonth(month).then((res) => {
      if (!res.ok) {
        throttle.reset(this, '_lastLoad')
        this.setData({ loading: false, loaded: true, error: true })
        return
      }
      this.setData({
        monthLabel: monthLabelOf(res.month),
        rows: res.rows,
        me: res.me,
        loading: false,
        loaded: true,
        error: false
      })
    }).catch((err) => {
      // 不兜住的话 loading 永远为 true：页面卡在加载态，
      // 且节流基准已被 touch 过，「重新加载」按钮根本不会出现
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

  // 排行榜需登录查看，分享落地页统一指向首页（未登录用户可先完成登录）
  onShareAppMessage() {
    return { title: '本月训练排行榜，一起动起来！', path: '/pages/index/index' }
  }
})
