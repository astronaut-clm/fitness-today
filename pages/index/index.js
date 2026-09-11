// pages/index/index.js
const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const profile = require('../../utils/profile.js')
const recommend = require('../../utils/recommend.js')
const insights = require('../../utils/insights.js')
const account = require('../../utils/account.js')

Page({
  data: {
    dateText: '',
    streak: 0,
    recPlan: null,
    isLogged: false,
    goalReady: false,
    todaySummary: null,
    insight: { weekDays: 0, targetDays: 3, weekMinutes: 0, targetMinutes: 90, dayPercent: 0, minutePercent: 0, coverage: [], dayBar: '', minuteBar: '' },
    showLoginDialog: false
  },

  onShow() {
    // 自定义 tabBar 选中态：WebView 下 getTabBar 同步返回实例
    if (typeof this.getTabBar === 'function') {
      const tabBar = this.getTabBar()
      if (tabBar && tabBar.setData) tabBar.setData({ selected: 0 })
    }
    this.refresh()
  },

  refresh() {
    // 一次读取记录快照，统计与当日汇总都从同一份派生，避免重复遍历/排序。
    const records = store.getAllRecords()
    const stats = store.computeStatsFrom(records)
    const currentProfile = profile.get()
    const today = dateUtil.today()
    const now = new Date()
    const todayRecords = records.filter(function (record) {
      return record.date === today
    }).sort(function (a, b) {
      return Number(a.createdAt) - Number(b.createdAt)
    })

    const dateText = (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + dateUtil.WEEK_LABELS[now.getDay()]

    const minutes = todayRecords.reduce(function (total, record) {
      return total + Number(record.actualMinutes || record.duration || 0)
    }, 0)
    const latest = todayRecords[todayRecords.length - 1]
    const todaySummary = todayRecords.length ? {
      count: todayRecords.length,
      minutes: minutes,
      latestName: latest && latest.planName
    } : null

    const built = insights.build(records, currentProfile)
    built.dayBar = 'width:' + Math.max(0, Number(built.dayPercent) || 0) + '%;'
    built.minuteBar = 'width:' + Math.max(0, Number(built.minutePercent) || 0) + '%;'
    this.setData({
      dateText: dateText,
      streak: stats.streak,
      recPlan: recommend.pick(records, currentProfile),
      isLogged: todayRecords.length > 0,
      goalReady: profile.completed(currentProfile),
      todaySummary: todaySummary,
      insight: built
    })
  },

  goRecPlan() {
    // 进入计划库挑选任意计划（pick=1），挑中后进入可开始训练的详情页；
    // 推荐计划仍在首页 hero 文案中展示。
    if (!account.requireLogin()) { this.showLogin(); return }
    wx.navigateTo({ url: '/pages/plan/plan?pick=1' })
  },

  goProfile() {
    if (!account.requireLogin()) { this.showLogin(); return }
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  goRank() {
    if (!account.requireLogin()) { this.showLogin(); return }
    wx.navigateTo({ url: '/pages/rank/rank' })
  },

  goFeed() {
    if (!account.requireLogin()) { this.showLogin(); return }
    wx.navigateTo({ url: '/pages/feed/feed' })
  },

  goCheckin() {
    wx.switchTab({ url: '/pages/checkin/checkin' })
  },

  // 登录引导弹层（页内像素弹窗）
  showLogin() {
    this.setData({ showLoginDialog: true })
  },

  onCancelLogin() {
    this.setData({ showLoginDialog: false })
  },

  onConfirmLogin() {
    this.setData({ showLoginDialog: false })
    wx.switchTab({ url: '/pages/checkin/checkin' })
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: this.data.isLogged ? '今天已打卡，练得漂亮！' : '今天练了吧？一起动起来！',
      path: '/pages/index/index'
    }
  }
})
