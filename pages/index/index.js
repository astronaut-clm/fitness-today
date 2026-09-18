// 首页：连续天数、今日汇总、本周进度、今日推荐计划、一键登录
const records = require('../../utils/records.js')
const dateUtil = require('../../utils/date.js')
const profile = require('../../utils/profile.js')
const recommend = require('../../utils/recommend.js')
const customPlans = require('../../utils/custom-plans.js')
const aiRecommend = require('../../utils/ai/recommend.js')
const aiWeekly = require('../../utils/ai/weekly.js')
const insights = require('../../utils/insights.js')
const account = require('../../utils/account.js')
const login = require('../../utils/login.js')
const toast = require('../../utils/toast.js')
const nav = require('../../utils/nav.js')
const fontBehavior = require('../../utils/font.js').behavior

// 本周练够几次才解锁 AI 周复盘
const WEEKLY_UNLOCK_SESSIONS = 2

Page({
  behaviors: [fontBehavior],

  data: {
    dateText: '',
    streak: 0,
    recPlan: null,
    // loggedIn=账号已登录；今日是否练过看 todaySummary 是否为空
    loggedIn: false,
    goalReady: false,
    todaySummary: null,
    insight: insights.empty(),
    // 周复盘：locked=本周次数不足；loading=生成中；review=复盘内容
    weeklyLocked: true,
    weeklyLoading: false,
    weeklyReview: null,
    loginBusy: false,
    loginFailShow: false
  },

  onShow() {
    nav.sync(this, nav.TAB.index)
    if (!account.isLoggedIn()) {
      this.resetGuestView()
      return
    }
    this.setData({ loggedIn: true })
    this.refresh()
    // 限频、失败重试、账号失效处理都在 login.refreshAccount 里
    login.refreshAccount(this, {
      key: '_lastVerifyAt',
      onGone: () => { if (nav.alive(this)) this.resetGuestView() }
    })
  },

  // 未登录只留一个登录入口：页面内容全部不渲染，tabBar 也不显示（nav.sync 按登录态同步显隐）
  // 不必再调 nav.sync：到这里的路径必经 onShow，那里已经同步过一次
  resetGuestView() {
    // 登出后要清掉重算判据，否则下次 refresh 会误以为「记录没变」而沿用上一账号的结果
    this._records = null
    this._recordsRev = -1
    this._profileRev = -1
    this.setData({
      loggedIn: false,
      streak: 0,
      recPlan: null,
      goalReady: false,
      todaySummary: null,
      insight: insights.empty(),
      weeklyLocked: true,
      weeklyLoading: false,
      weeklyReview: null
    })
  },

  refresh(opts) {
    const currentProfile = profile.get()
    // 记录与偏好都没变 → 沿用上次结果。从子页频繁返回首页时，
    // 这一步能省掉整轮的 getAll + 全表统计 + 整块 setData
    const recordsRev = records.revision()
    const profileRev = Number(currentProfile.updatedAt || 0)
    if (this._records && this._recordsRev === recordsRev && this._profileRev === profileRev) return
    this._recordsRev = recordsRev
    this._profileRev = profileRev
    // 读一次记录，本页几个数字都从这一份算
    const all = records.getAll()
    const stats = records.computeStatsFrom(all)
    // 今日汇总只关心今天这几条：从同一份 all 里过滤，不再全量读一遍 storage
    const today = dateUtil.today()
    const todayRecords = all.filter(function (record) { return record.date === today })

    const minutes = todayRecords.reduce(function (total, record) {
      return total + Number(record.actualMinutes || 0)
    }, 0)
    const todaySummary = todayRecords.length ? {
      count: todayRecords.length,
      minutes: minutes,
      latestName: todayRecords[0].planName
    } : null

    const insightView = insights.build(all, currentProfile)
    this.setData({
      dateText: dateUtil.dayLabel(new Date()),
      streak: stats.streak,
      recPlan: recommend.pick(all, currentProfile, opts),
      goalReady: profile.completed(currentProfile),
      todaySummary: todaySummary,
      insight: insightView
    })
    // 登录后的过渡态（noCache）里云端偏好还没拉回，profile 为空时算出的签名会真打一次模型，
    // 白白吃掉当天额度；这里跳过，等同步完成后的 refresh 再请求 AI
    if (!(opts && opts.noCache)) this.requestAI(all, currentProfile)
    this._records = all
    this.loadWeekly()
  },

  // 周复盘：仅登录可见（未登录在 resetGuestView 清空）；本周练过 ≥2 次解锁
  loadWeekly(force) {
    if (!account.isLoggedIn()) {
      this.setData({ weeklyLocked: true, weeklyLoading: false, weeklyReview: null })
      return
    }
    const all = this._records || records.getAll()
    if (aiWeekly.weekSessions(all) < WEEKLY_UNLOCK_SESSIONS) {
      this.setData({ weeklyLocked: true, weeklyLoading: false, weeklyReview: null })
      return
    }
    if (this._weeklyBusy) return
    this._weeklyBusy = true
    this.setData({ weeklyLocked: false, weeklyLoading: true })
    aiWeekly.fetchWeekly({
      records: all,
      goal: profile.get().goal
    }, { force: !!force }).then((res) => {
      this._weeklyBusy = false
      // 失败：有旧内容保留旧内容，无则结束加载态，下次 onShow 再试（6 小时失败水位限频）
      const patch = { weeklyLoading: false }
      if (res && res.ok) patch.weeklyReview = res.data
      this.setData(patch)
    }).catch((err) => {
      this._weeklyBusy = false
      console.warn('[index] weekly', err)
      this.setData({ weeklyLoading: false })
    })
  },

  onWeeklyRefresh() {
    if (this._weeklyBusy) return
    this.loadWeekly(true)
  },

  // AI 重排：后台进行，不阻塞首屏；结果有效才覆盖推荐卡片，失败保持规则结果
  // 命中缓存时同步返回，登录/同步导致的多次 refresh 不会把已出的 AI 结果冲掉
  requestAI(all, profileData) {
    aiRecommend.fetchPlan(all, profileData).then((res) => {
      if (!res || !res.ok || !res.byAI) return
      const plan = customPlans.resolvePlan(res.planId)
      if (plan && nav.alive(this)) this.setData({ recPlan: recommend.decorate(plan, res.reason) })
    }).catch(() => {})
  },

  goRecPlan() {
    wx.navigateTo({ url: '/pages/plan/plan?pick=1' })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  goRank() {
    wx.navigateTo({ url: '/pages/rank/rank' })
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
      // 登录成功，tabBar 现在该出现了
      nav.sync(this, nav.TAB.index)
      // 云端数据尚未拉回，本地仍为空态：只做即时展示、不写推荐缓存，避免污染
      this.refresh({ noCache: true })
      // 云端同步后台执行，不阻塞引导跳转；完成后回填首页并落推荐缓存
      login.syncAfterLogin().then((ok) => {
        if (ok && nav.alive(this)) this.refresh()
      }).catch(() => {})
      if (res.newUser && !login.onboardingDone()) {
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
      title: this.data.todaySummary ? '今天已打卡，练得漂亮！' : '今天练了吧？一起动起来！',
      path: '/pages/index/index'
    }
  }
})
