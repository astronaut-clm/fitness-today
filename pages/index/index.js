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
const videoCache = require('../../utils/video-cache.js')

const WEEKLY_UNLOCK_SESSIONS = 2 // 本周练够几次才解锁 AI 周复盘

Page({
  data: {
    dateText: '',
    streak: 0,
    recPlan: null,
    // 今日练过没有看 todaySummary 是否为空，与 loggedIn 无关
    loggedIn: false,
    goalReady: false,
    todaySummary: null,
    insight: insights.empty(),
    // weeklyLocked=本周次数不足；weeklyStale=展示的是上周那份（本周还没到周日 08:00）
    weeklyLocked: true,
    weeklyLoading: false,
    weeklyReview: null,
    weeklyStale: false,
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
    login.refreshAccount(this, {
      key: '_lastVerifyAt',
      onGone: () => { if (nav.alive(this)) this.resetGuestView() }
    })
  },

  // 未登录只留登录入口，页面内容与 tabBar 都不渲染。
  // 不必再调 nav.sync：到这里必经 onShow，那里已同步过
  resetGuestView() {
    // 必须清掉重算判据，否则下次 refresh 会以为「记录没变」而沿用上个账号的结果
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
      weeklyReview: null,
      weeklyStale: false
    })
  },

  refresh(opts) {
    const currentProfile = profile.get()
    // 记录与偏好都没变就沿用上次结果，省掉整轮 getAll + 全表统计 + setData
    const recordsRev = records.revision()
    const profileRev = Number(currentProfile.updatedAt || 0)
    if (this._records && this._recordsRev === recordsRev && this._profileRev === profileRev) return
    this._recordsRev = recordsRev
    this._profileRev = profileRev
    // 读一次，本页几个数字都从这一份算
    const all = records.getAll()
    const stats = records.computeStatsFrom(all)
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
    // noCache 是登录后的过渡态：偏好还没拉回，此时的签名会白打一次模型吃掉当天额度
    if (!(opts && opts.noCache)) this.requestAI(all, currentProfile)
    this._records = all
    this.loadWeekly()
  },

  // 仅登录可见，本周练过 ≥2 次才解锁；本周日 08:00 出一份，不支持手动换。
  // 没到点时 fetchWeekly 直接回 not_due，不发请求、不烧额度
  loadWeekly() {
    if (!account.isLoggedIn()) {
      this.setData({ weeklyLocked: true, weeklyLoading: false, weeklyReview: null, weeklyStale: false })
      return
    }
    const all = this._records || records.getAll()
    if (aiWeekly.weekSessions(all) < WEEKLY_UNLOCK_SESSIONS) {
      this.setData({ weeklyLocked: true, weeklyLoading: false, weeklyReview: null, weeklyStale: false })
      return
    }
    if (this._weeklyBusy) return
    this._weeklyBusy = true
    // 没到点就不会发请求，别闪一下「正在复盘」
    this.setData({ weeklyLocked: false, weeklyLoading: aiWeekly.due() })
    aiWeekly.fetchWeekly({
      records: all,
      goal: profile.get().goal
    }).then((res) => {
      this._weeklyBusy = false
      // 失败时有旧内容就留着，下次 onShow 再试（1 小时失败水位）
      const patch = { weeklyLoading: false }
      if (res && res.ok) {
        patch.weeklyReview = res.data
        // 缓存不是本周的，说明还在展示上周日的那份
        patch.weeklyStale = !!res.week && res.week !== dateUtil.weekStart()
      }
      this.setData(patch)
    }).catch((err) => {
      this._weeklyBusy = false
      console.warn('[index] weekly', err)
      this.setData({ weeklyLoading: false })
    })
  },

  // 后台进行不阻塞首屏；结果有效才覆盖卡片，失败保持规则结果
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

  // 选择微信头像即完成登录，昵称默认取 openid 后六位
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
      nav.sync(this, nav.TAB.index) // tabBar 现在该出现了
      // 云端数据还没拉回，只做即时展示、不写推荐缓存
      this.refresh({ noCache: true })
      // 同步放后台，不阻塞引导跳转
      login.syncAfterLogin().then((ok) => {
        if (ok && nav.alive(this)) this.refresh()
      }).catch(() => {}).then(() => {
        // 同步跑完再拉视频，别抢登录流程的带宽；此后进动作详情都是本地秒播
        videoCache.warmup()
      })
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
