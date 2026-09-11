// pages/index/index.js
const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const profile = require('../../utils/profile.js')
const recommend = require('../../utils/recommend.js')
const insights = require('../../utils/insights.js')
const account = require('../../utils/account.js')
const login = require('../../utils/login.js')
const onboarding = require('../../utils/onboarding.js')
const toast = require('../../utils/toast.js')

// 未登录 / 无数据时首页的默认目标统计，供初始 data 与登出清空复用。
const EMPTY_INSIGHT = { weekDays: 0, targetDays: 3, weekMinutes: 0, targetMinutes: 90, dayPercent: 0, minutePercent: 0, coverage: [], dayBar: '', minuteBar: '' }

Page({
  data: {
    dateText: '',
    streak: 0,
    recPlan: null,
    isLogged: false,
    loggedIn: false,
    goalReady: false,
    todaySummary: null,
    insight: EMPTY_INSIGHT,
    loginBusy: false,
    loginFailShow: false
  },

  onShow() {
    // 自定义 tabBar 选中态：WebView 下 getTabBar 同步返回实例
    if (typeof this.getTabBar === 'function') {
      const tabBar = this.getTabBar()
      if (tabBar && tabBar.setData) tabBar.setData({ selected: 0 })
    }
    // 未登录：首页只展示登录入口，不做需要 openid 的拉取与统计，
    // 并清空上次登录时渲染的统计/打卡数据，避免退出后残留旧数据。
    const loggedIn = account.isLoggedIn()
    if (!loggedIn) {
      this.setData({
        loggedIn: false,
        streak: 0,
        recPlan: null,
        isLogged: false,
        goalReady: false,
        todaySummary: null,
        insight: EMPTY_INSIGHT
      })
      return
    }
    this.setData({ loggedIn: true })
    this.refresh()
  },

  refresh(opts) {
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
      recPlan: recommend.pick(records, currentProfile, opts),
      isLogged: todayRecords.length > 0,
      goalReady: profile.completed(currentProfile),
      todaySummary: todaySummary,
      insight: built
    })
  },

  goRecPlan() {
    // 进入计划库挑选任意计划（pick=1），挑中后进入可开始训练的详情页；
    // 推荐计划仍在首页 hero 文案中展示。
    wx.navigateTo({ url: '/pages/plan/plan?pick=1' })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  goRank() {
    wx.navigateTo({ url: '/pages/rank/rank' })
  },

  goFeed() {
    wx.navigateTo({ url: '/pages/feed/feed' })
  },

  goCheckin() {
    wx.switchTab({ url: '/pages/checkin/checkin' })
  },

  // 首页一键登录逻辑（utils/login.js）：
  // 点击「点击登录」按钮选择微信头像即完成登录，昵称默认取 openid 后六位。
  onLoginOneTap(e) {
    if (this.data.loginBusy) return
    const tempUrl = (e.detail && e.detail.avatarUrl) || ''
    if (!tempUrl) return
    this.setData({ loginBusy: true })
    login.loginOneTap(tempUrl).then((res) => {
      if (!res || !res.ok) {
        this.setData({ loginBusy: false })
        if (res && res.code === 'save_error') this.setData({ loginFailShow: true })
        else toast.show('登录失败，请重试')
        return
      }
      // 登录成功：收起加载层并展示首页内容，随后拉回历史记录与偏好；
      // 仅全新账号的首次登录（res.newUser）才引导补全偏好与自定义计划，老用户不打扰。
      this.setData({ loginBusy: false, loggedIn: true })
      // 此刻云端数据（训练记录 / 偏好 / 自定义计划）还没拉回来，本地还是登出时重置过的空状态，
      // 这次刷新只做即时展示、不写当日推荐缓存，避免用不完整数据污染缓存。
      this.refresh({ noCache: true })
      login.syncAfterLogin().then((ok) => {
        // 同步完成后重算并落缓存：此后当天推荐固定，不会因重新登录而改变。
        if (ok) this.refresh()
        if (res.newUser && !onboarding.isDone()) {
          wx.navigateTo({ url: '/pages/onboarding/onboarding' })
        }
      })
    })
  },

  onCloseLoginFail() {
    this.setData({ loginFailShow: false })
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: this.data.isLogged ? '今天已打卡，练得漂亮！' : '今天练了吧？一起动起来！',
      path: '/pages/index/index'
    }
  }
})
