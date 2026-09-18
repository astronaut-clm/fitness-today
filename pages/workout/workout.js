// 训练进行页：只管「第几组、在练还是在歇、还剩几秒」；播报见 workout/voice，收尾见 workout/finish
const plansData = require('../../databases/plans.js')
const sessionStore = require('../../utils/workout/session.js')
const adjustments = require('../../utils/plan-adjustments.js')
const customPlans = require('../../utils/custom-plans.js')
const groupsOf = require('../../utils/workout/groups.js')
const workoutVoice = require('../../utils/workout/voice.js')
const finish = require('../../utils/workout/finish.js')
const toast = require('../../utils/toast.js')
const device = require('../../utils/device.js')
const nav = require('../../utils/nav.js')

const REST_EXTEND_SECONDS = 15 // 「再歇一会」单次追加秒数
const STATE = sessionStore.STATE

Page({
  data: {
    loaded: false,
    planName: '',
    sceneName: '',
    total: 0,
    completed: 0,
    pctStyle: 'width:0%;',
    state: STATE.working,
    group: null,
    nextGroup: null,
    workLeft: 0,
    running: false,
    timeStarted: false,
    restLeft: 0,
    costText: '',
    skippedGroups: 0,
    // voiceSupported 仅在插件可用时展示
    voiceOn: true,
    voiceSupported: false,
    statusBarHeight: 0,
    showResumeConfirm: false,
    resumeDone: 0,
    doneTitle: '',
    doneCheer: '',
    doneStats: []
  },

  onLoad(options) {
    // 分享路径可直接打开本页；未登录时记录无法同步
    if (!nav.requireLogin()) return
    this.planId = options.id || ''
    const source = customPlans.resolvePlan(this.planId)
    if (!source || !source.exercises.length) {
      toast.back('计划不存在')
      return
    }
    // current 只在 JS 内部用（wxml 渲染用 group.setNo），挂实例省一次 setData
    this.current = 0
    this.plan = adjustments.apply(source)
    this.groups = groupsOf.build(this.plan)
    this.speaker = workoutVoice.create(this.groups)
    wx.setKeepScreenOn({ keepScreenOn: true, fail: function () {} })
    const win = device.windowInfo() // navigationStyle: custom，状态栏高度要自己留
    this.setData({
      loaded: true,
      planName: this.plan.name,
      sceneName: plansData.sceneName(this.plan.scene),
      total: this.groups.length,
      statusBarHeight: (win && (win.statusBarHeight || (win.safeArea && win.safeArea.top))) || 0,
      voiceOn: this.speaker.enabled(),
      voiceSupported: this.speaker.available
    })
    this.speaker.prepare()
    this.restoreOrStart()
  },

  onShow() {
    if (this.data.state === STATE.rest && this.endAt) {
      this.startInterval()
      this.tick() // 回前台立即校正，否则最多滞后 1 秒
    }
  },

  onHide() {
    if (!this.plan) return // 计划没加载成功，没什么要收拾的
    this.stopInterval()
    this.speaker.stop()
    if (this.data.state === STATE.working && this.data.running) this.holdWork()
    this.persistSession()
  },

  onUnload() {
    wx.setKeepScreenOn({ keepScreenOn: false, fail: function () {} })
    if (!this.plan) return
    this.stopInterval()
    // 必须 dispose 而非 stop：stop 只停当前这句，已排定的抢占定时器仍会在页面销毁后漏出一句
    this.speaker.dispose()
    if (this.data.state !== STATE.finished) this.persistSession()
  },

  // 下标越界返回 null，wxml 用 wx:if 兜住
  viewAt(index) {
    return groupsOf.viewOf(this.groups[index], index)
  },

  pctStyleOf(completed) {
    const total = this.groups.length
    return 'width:' + (total ? Math.round(completed / total * 100) : 0) + '%;'
  },

  // ---- 断点续训 ----

  restoreOrStart() {
    const session = sessionStore.resumableFor(this.planId)
    if (!session) {
      sessionStore.clear()
      this.startFresh()
      return
    }
    this._resumeSession = session
    this.setData({
      showResumeConfirm: true,
      resumeDone: Number(session.completed || 0)
    })
  },

  onResumeContinue() {
    const session = this._resumeSession
    this.setData({ showResumeConfirm: false })
    this._resumeSession = null
    if (!session) return
    this.restoreSession(session)
  },

  onResumeRestart() {
    this.setData({ showResumeConfirm: false })
    this._resumeSession = null
    sessionStore.clear()
    this.startFresh()
  },

  startFresh() {
    this.startTs = Date.now()
    this.endAt = 0
    this.activate(0)
  },

  restoreSession(session) {
    this.startTs = Number(session.startedAt || Date.now())
    this.endAt = Number(session.restEndsAt || 0)
    const index = Math.min(Math.max(0, Number(session.current || 0)), this.groups.length - 1)
    const completed = Math.min(Number(session.completed || 0), this.groups.length)
    const state = session.state === STATE.rest ? STATE.rest : STATE.working
    const view = this.viewAt(index)
    const restLeft = state === STATE.rest ? this.remainingSeconds(0) : 0
    this.current = index
    this.setData({
      completed: completed,
      pctStyle: this.pctStyleOf(completed),
      state: state,
      group: view,
      nextGroup: this.viewAt(index + 1),
      workLeft: Number(session.remainingSeconds || (view && view.seconds) || 0),
      restLeft: restLeft,
      running: false,
      timeStarted: !!session.timeStarted,
      skippedGroups: Number(session.skippedGroups || 0)
    })
    if (state === STATE.working) {
      this.speaker.group(this.groups[index])
      return
    }
    // 休息态下 current 已指向即将开始的组
    if (restLeft <= 0) {
      this.skipRest()
      return
    }
    this.speaker.rest(restLeft, this.groups[index] && this.groups[index].name)
    this.startInterval()
  },

  persistSession() {
    if (!this.plan || this.data.state === STATE.finished) return
    if (this.data.showResumeConfirm) return // 未选择恢复方式时不落盘，别用初始态覆盖已存进度
    if (Number(this.data.completed || 0) <= 0) return
    sessionStore.save({
      planId: this.planId,
      startedAt: this.startTs || Date.now(),
      current: this.current,
      completed: this.data.completed,
      state: this.data.state,
      timeStarted: this.data.timeStarted,
      remainingSeconds: this.data.workLeft,
      restEndsAt: this.data.state === STATE.rest ? this.endAt : 0,
      skippedGroups: this.data.skippedGroups
    })
  },

  // ---- 计时 ----

  startInterval() {
    this.stopInterval()
    this.scheduleTick()
  },

  // 不用 setInterval：相位漂移会让读秒每拍滞后近 1 秒。改为对齐 endAt 整秒边界的 setTimeout 链
  scheduleTick() {
    const delay = this.endAt ? Math.max(30, (this.endAt - Date.now()) % 1000 || 1000) : 1000
    this.timer = setTimeout(() => {
      this.timer = null
      this.tick()
      // tick 内可能已重设 timer（finishSet/skipRest），此时不重复挂链
      if (this.timer === null && this.endAt &&
        (this.data.state === STATE.rest || (this.data.state === STATE.working && this.data.running))) {
        this.scheduleTick()
      }
    }, delay)
  },

  stopInterval() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  },

  // 一律由 endAt 反算，不做自减：后台挂起与相位漂移都会累积误差
  remainingSeconds(fallback) {
    if (!this.endAt) return fallback || 0
    return Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000))
  },

  refreshRemain() {
    if (!this.endAt) return 0
    const remain = this.remainingSeconds(0)
    if (this.data.state === STATE.rest) this.setData({ restLeft: remain })
    else this.setData({ workLeft: remain })
    return remain
  },

  tick() {
    if (this.data.state === STATE.rest) {
      if (!this.endAt) { this.skipRest(); return }
      if (this.refreshRemain() <= 0) this.skipRest()
      return
    }
    if (this.data.state !== STATE.working || !this.data.running || !this.endAt) return
    if (this.refreshRemain() <= 0) this.finishSet(false)
  },

  // ---- 按组推进 ----

  // 切到第 index 组的准备态，等用户点「开始」才计时
  activate(index) {
    const group = this.groups[index]
    if (!group) return
    this.endAt = 0
    this.current = index
    this.setData({
      state: STATE.working,
      group: this.viewAt(index),
      nextGroup: this.viewAt(index + 1),
      workLeft: group.mode === 'time' ? group.seconds : 0,
      running: false,
      timeStarted: false,
      pctStyle: this.pctStyleOf(this.data.completed || 0)
    })
    this.speaker.group(group)
    this.persistSession()
  },

  // 一组结束：还有下一组就进休息，没有就收尾
  finishSet(skipped) {
    if (this.data.state !== STATE.working) return
    this.stopInterval()
    const completed = this.current + 1
    const next = this.groups[completed]
    const skippedGroups = this.data.skippedGroups + (skipped ? 1 : 0)
    if (!next) {
      this.finishWorkout(skippedGroups)
      return
    }
    const rest = this.groups[this.current].rest
    this.endAt = Date.now() + rest * 1000
    this.current = completed
    this.setData({
      completed: completed,
      pctStyle: this.pctStyleOf(completed),
      state: STATE.rest,
      restLeft: rest,
      group: this.viewAt(this.current),
      nextGroup: this.viewAt(this.current + 1),
      running: false,
      timeStarted: false,
      skippedGroups: skippedGroups
    })
    this.speaker.rest(rest, next.name)
    this.vibrate('short')
    this.persistSession()
    this.startInterval()
  },

  // 最后一组结束：先落库再算完成页（统计要含刚落库的这条）
  finishWorkout(skippedGroups) {
    this.endAt = 0
    this.current = this.groups.length
    const seconds = Math.max(0, Math.round((Date.now() - this.startTs) / 1000))
    const summary = {
      planName: this.plan.name,
      total: this.groups.length,
      skipped: skippedGroups,
      seconds: seconds,
      costText: finish.costText(seconds)
    }
    this.setData({
      completed: this.groups.length,
      pctStyle: this.pctStyleOf(this.groups.length),
      state: STATE.finished,
      running: false,
      skippedGroups: skippedGroups,
      costText: summary.costText
    })
    this.speaker.finish()
    this.vibrate('long')
    finish.save(this.plan, summary)
    const feedback = finish.feedback(summary)
    this.setData(feedback)
    this.speaker.say(feedback.doneCheer) // 非抢占，排在收官播报之后
  },

  skipRest() {
    if (this.data.state !== STATE.rest) return
    this.stopInterval()
    this.endAt = 0
    this.activate(this.current)
    this.vibrate('short')
  },

  extendRest() {
    if (this.data.state !== STATE.rest) return
    this.endAt = (this.endAt || Date.now()) + REST_EXTEND_SECONDS * 1000
    this.refreshRemain() // 显示值也从 endAt 反算，避免 1 秒偏差
    this.persistSession()
  },

  onStartWork() {
    if (this.data.state !== STATE.working || this.data.running) return
    const group = this.groups[this.current]
    if (!group) return
    let left = this.data.workLeft
    if (!this.data.timeStarted) {
      left = group.seconds
      this.setData({ workLeft: left, timeStarted: true })
    }
    this.endAt = Date.now() + left * 1000
    this.setData({ running: true })
    this.startInterval()
  },

  // 暂停：把剩余秒数固化进 workLeft，再次开始从该值续计
  holdWork() {
    const remain = this.remainingSeconds(this.data.workLeft)
    this.endAt = 0
    this.setData({ running: false, workLeft: remain })
  },

  onPauseWork() {
    if (this.data.state !== STATE.working) return
    this.stopInterval()
    this.holdWork()
    this.persistSession()
  },

  onCompleteSet() { this.finishSet(false) },
  onSkipSet() { this.finishSet(true) },

  vibrate(kind) {
    if (kind === 'long' && wx.vibrateLong) wx.vibrateLong({ fail: function () {} })
    if (kind !== 'long' && wx.vibrateShort) wx.vibrateShort({ fail: function () {} })
  },

  onToggleVoice() {
    const on = !this.data.voiceOn
    this.speaker.setEnabled(on)
    this.setData({ voiceOn: on })
    if (on) this.speaker.say('语音已开启，准备开练！')
  },

  onNavBack() {
    if (this.data.state !== STATE.finished) {
      if (Number(this.data.completed || 0) > 0) this.persistSession()
      else sessionStore.clear()
    }
    wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages/plan/plan' }) })
  }
})
