const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const profile = require('../../utils/profile.js')
const recommend = require('../../utils/recommend.js')
const aiRecommend = require('../../utils/ai-recommend.js')
const insights = require('../../utils/insights.js')
const account = require('../../utils/account.js')
const login = require('../../utils/login.js')
const onboarding = require('../../utils/onboarding.js')
const toast = require('../../utils/toast.js')
const tab = require('../../utils/tab.js')

// 未登录/无数据时的默认目标统计
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
    tab.sync(this, 0)
    if (!account.isLoggedIn()) {
      this.resetGuestView()
      return
    }
    this.setData({ loggedIn: true })
    this.refresh()
    this.verifyAccount()
  },

  // 未登录视图：只展示登录入口，并清空上次登录残留的统计/打卡数据
  resetGuestView() {
    this.setData({
      loggedIn: false,
      streak: 0,
      recPlan: null,
      isLogged: false,
      goalReady: false,
      todaySummary: null,
      insight: EMPTY_INSIGHT
    })
  },

  // 云端账号校验：文档被清除（清库/删号）时清理本地数据并切回未登录视图
  verifyAccount() {
    const now = Date.now()
    if (this._lastVerifyAt && now - this._lastVerifyAt < 15000) return
    this._lastVerifyAt = now
    account.fetchProfile().then((res) => {
      if (res && res.code === 'no_account') {
        login.resetLocalData()
        this.resetGuestView()
        return
      }
      // 无法判定账号状态时保留登录态，下次 onShow 重试
      if (!res || !res.ok) this._lastVerifyAt = 0
    })
  },

  refresh(opts) {
    // 一次读取记录快照，统计与当日汇总都从同一份派生
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
      return total + Number(record.actualMinutes || 0)
    }, 0)
    const latest = todayRecords[todayRecords.length - 1]
    const todaySummary = todayRecords.length ? {
      count: todayRecords.length,
      minutes: minutes,
      latestName: latest && latest.planName
    } : null

    const insightView = insights.build(records, currentProfile)
    insightView.dayBar = 'width:' + Math.max(0, Number(insightView.dayPercent) || 0) + '%;'
    insightView.minuteBar = 'width:' + Math.max(0, Number(insightView.minutePercent) || 0) + '%;'
    this.setData({
      dateText: dateText,
      streak: stats.streak,
      recPlan: recommend.pick(records, currentProfile, opts),
      isLogged: todayRecords.length > 0,
      goalReady: profile.completed(currentProfile),
      todaySummary: todaySummary,
      insight: insightView
    })
    this.requestAI(records, currentProfile)
  },

  // AI 重排：后台进行，不阻塞首屏；结果有效才覆盖推荐卡片，失败保持规则结果
  // 命中缓存时同步返回，登录/同步导致的多次 refresh 不会把已出的 AI 结果冲掉
  requestAI(records, profileData) {
    aiRecommend.fetchPlan(records, profileData).then((res) => {
      if (!res.ok || !res.byAI) return
      const plan = recommend.findById(res.planId)
      if (plan) this.setData({ recPlan: recommend.decorate(plan, res.reason) })
    })
  },

  goRecPlan() {
    // 进入计划库挑选计划（pick=1），挑中后进入详情页
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

  // 一键登录：选择微信头像即完成登录，昵称默认取 openid 后六位
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
      this.setData({ loginBusy: false, loggedIn: true })
      // 云端数据尚未拉回，本地仍为空态：只做即时展示、不写推荐缓存，避免污染
      this.refresh({ noCache: true })
      // 云端同步后台执行，不阻塞引导跳转；完成后回填首页并落推荐缓存
      login.syncAfterLogin().then((ok) => {
        if (ok) this.refresh()
      })
      // 仅全新账号首次登录才引导补全资料
      if (res.newUser && !onboarding.isDone()) {
        wx.navigateTo({ url: '/pages/onboarding/onboarding' })
      }
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
