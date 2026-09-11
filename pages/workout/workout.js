// pages/workout/workout.js 训练跟练
const plansData = require('../../data/plans.js')
const actionsData = require('../../data/actions.js')
const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const sessionStore = require('../../utils/workout-session.js')
const adjustments = require('../../utils/plan-adjustments.js')
const customPlans = require('../../utils/custom-plans.js')
const toast = require('../../utils/toast.js')

function parseSeconds(reps) {
  const m = /^(\d+)\s*秒/.exec(String(reps || '').trim())
  return m ? +m[1] : 0
}

function parseRest(text) {
  const m = /^组间(\d+)\s*秒/.exec(String(text || '').trim())
  return m ? +m[1] : 0
}

function buildGroups(plan) {
  const groups = []
  const loop = plan.loop || 1
  const defRest = plan.scene === 'gym' ? 60 : 20
  for (let round = 1; round <= loop; round++) {
    plan.exercises.forEach(function (exercise) {
      const action = actionsData.getAction(exercise.actionId) || {}
      for (let set = 1; set <= (exercise.sets || 1); set++) {
        const seconds = parseSeconds(exercise.reps)
        groups.push({
          actionId: exercise.actionId,
          name: action.name || exercise.actionId,
          category: action.category || '训练',
          equipment: action.equipment || '',
          targetText: exercise.reps || '完成规定次数',
          seconds: seconds,
          kind: seconds > 0 ? 'time' : 'count',
          rest: parseRest(exercise.rest) || defRest,
          round: round,
          roundTotal: loop
        })
      }
    })
  }
  return groups
}

function viewOf(group, index) {
  if (!group) return null
  return {
    setNo: index + 1,
    name: group.name,
    category: group.category,
    equipment: group.equipment,
    targetText: group.targetText,
    kind: group.kind,
    seconds: group.seconds,
    roundLabel: group.roundTotal > 1 ? '第' + group.round + '/' + group.roundTotal + '轮' : ''
  }
}

Page({
  data: {
    loaded: false,
    planName: '',
    sceneName: '',
    total: 0,
    current: 0,
    completed: 0,
    pctStyle: 'width:0%;',
    state: 'working',
    group: null,
    nextGroup: null,
    left: 0,
    running: false,
    timeStarted: false,
    restLeft: 0,
    costText: '',
    skippedGroups: 0,
    showFeedback: false,
    effort: 0,
    isSaving: false,
    effortOptions: [1, 2, 3, 4, 5],
    // 自绘导航：状态栏高度（px），用于顶部留白
    statusBarHeight: 0,
    // 退出确认弹层是否可见
    showExitConfirm: false,
    // 恢复上次训练弹层
    showResumeConfirm: false,
    resumeFinished: false,
    resumeDone: 0
  },

  onLoad(options) {
    this.planId = options.id || ''
    // 全局面板 navigationStyle: custom，需自行预留状态栏高度
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const topInset = (win && (win.statusBarHeight || (win.safeArea && win.safeArea.top))) || 0
    if (topInset) this.setData({ statusBarHeight: topInset })
    const source = customPlans.getById(this.planId) || plansData.getPlan(this.planId)
    if (!source || !source.exercises.length) {
      toast.show('计划不存在')
      this.defer(function () { wx.navigateBack() }, 800)
      return
    }
    this.plan = adjustments.apply(source)
    this.groups = buildGroups(this.plan)
    this.setData({
      loaded: true,
      planName: this.plan.name,
      sceneName: plansData.sceneName(this.plan.scene),
      total: this.groups.length
    })
    this.restoreOrStart()
  },

  onShow() {
    if (this.data.state === 'rest' && this.endAt) {
      this.startInterval()
      // 回到前台立即校正一次，避免最多 1 秒的倒计时显示延迟
      this.tick()
    }
  },

  onHide() {
    this.stopInterval()
    if (this.data.state === 'working' && this.data.running) {
      const remain = this.endAt ? Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000)) : this.data.left
      this.endAt = 0
      this.setData({ running: false, left: remain })
    }
    this.persistSession()
  },

  onUnload() {
    this.stopInterval()
    this.clearTimers()
    if (this.data.state !== 'finished') this.persistSession()
  },

  restoreOrStart() {
    const session = sessionStore.belongsTo(this.planId)
    // 一组都没完成时没有进度可恢复，直接从头开始，不弹「继续上次训练？」。
    // （finished 态表示已完成未保存，仍需提示，故单独排除）
    if (!session || (session.state !== 'finished' && Number(session.completed || 0) <= 0)) {
      sessionStore.clear()
      this.startFresh()
      return
    }
    // 恢复/重开的选择用页内弹层，避免存在未完成训练时页面无响应。
    this._resumeSession = session
    this.setData({
      showResumeConfirm: true,
      resumeFinished: session.state === 'finished',
      resumeDone: Number(session.completed || 0)
    })
  },

  // 继续上次未完成的训练
  onResumeContinue() {
    const session = this._resumeSession
    this.setData({ showResumeConfirm: false })
    this._resumeSession = null
    if (!session || session.state === 'finished') return
    this.restoreSession(session)
  },

  // 放弃上次进度，重新开始
  onResumeRestart() {
    this.setData({ showResumeConfirm: false })
    this._resumeSession = null
    sessionStore.clear()
    this.startFresh()
  },

  // 「上次已完成未保存」时返回保存页：训练完成后必须先保存，不允许直接退出
  onResumeSave() {
    const session = this._resumeSession
    this.setData({ showResumeConfirm: false })
    this._resumeSession = null
    if (!session) return
    this.startTs = Number(session.startedAt || Date.now())
    this.setData({
      current: this.groups.length,
      completed: this.groups.length,
      pctStyle: 'width:100%;',
      state: 'finished',
      running: false,
      skippedGroups: Number(session.skippedGroups || 0),
      costText: session.costText || '',
      showFeedback: true
    })
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
    const state = session.state === 'rest' ? 'rest' : 'working'
    const group = viewOf(this.groups[index], index)
    const next = viewOf(this.groups[index + 1], index + 1)
    const pct = this.groups.length ? Math.round(completed / this.groups.length * 100) : 0
    const restLeft = state === 'rest' && this.endAt ? Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000)) : 0
    this.setData({
      current: index,
      completed: completed,
      pctStyle: 'width:' + pct + '%;',
      state: state,
      group: group,
      nextGroup: next,
      left: Number(session.remainingSeconds || (group && group.seconds) || 0),
      restLeft: restLeft,
      running: false,
      timeStarted: !!session.timeStarted,
      skippedGroups: Number(session.skippedGroups || 0)
    })
    if (state === 'rest') {
      if (restLeft <= 0) this.skipRest()
      else this.startInterval()
    }
  },

  persistSession() {
    if (!this.plan || this.data.state === 'finished') return
    // 恢复弹层尚未选择时不要落盘：此时 data 仍是初始态，覆盖会丢失已存进度。
    if (this.data.showResumeConfirm) return
    // 一组都没完成时无需保存，避免留下无意义的空进度。
    if (Number(this.data.completed || 0) <= 0) return
    sessionStore.save({
      planId: this.planId,
      startedAt: this.startTs || Date.now(),
      current: this.data.current,
      completed: this.data.completed,
      state: this.data.state,
      running: false,
      timeStarted: this.data.timeStarted,
      remainingSeconds: this.data.left,
      restEndsAt: this.data.state === 'rest' ? this.endAt : 0,
      skippedGroups: this.data.skippedGroups,
      adjustments: adjustments.get(this.planId)
    })
  },

  // 进入 finished 态时单独落盘：已完成但未点保存就退出也能被识别，且不会在保存后被 onHide 复活。
  persistFinished() {
    if (!this.plan) return
    sessionStore.save({
      planId: this.planId,
      startedAt: this.startTs || Date.now(),
      current: this.data.current,
      completed: this.data.completed,
      state: 'finished',
      running: false,
      timeStarted: false,
      remainingSeconds: 0,
      restEndsAt: 0,
      skippedGroups: this.data.skippedGroups,
      costText: this.data.costText || '',
      adjustments: adjustments.get(this.planId)
    })
  },

  startInterval() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000)
  },

  stopInterval() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  // 页面内延迟任务统一登记，onUnload 时清理，避免返回后回调再触发多退一层/误跳转。
  defer(fn, ms) {
    if (!this._timers) this._timers = []
    const id = setTimeout(fn, ms)
    this._timers.push(id)
    return id
  },

  clearTimers() {
    if (!this._timers) return
    this._timers.forEach(clearTimeout)
    this._timers = []
  },

  refreshRemain() {
    if (!this.endAt) return 0
    const remain = Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000))
    if (this.data.state === 'rest') this.setData({ restLeft: remain })
    else this.setData({ left: remain })
    return remain
  },

  tick() {
    if (this.data.state === 'rest') {
      if (!this.endAt || this.refreshRemain() <= 0) this.skipRest()
      return
    }
    if (this.data.state === 'working' && this.data.running && this.endAt && this.refreshRemain() <= 0) {
      this.finishSet(false)
    }
  },

  activate(index) {
    const group = this.groups[index]
    if (!group) return
    this.endAt = 0
    const completed = this.data.completed || 0
    const pct = this.groups.length ? Math.round(completed / this.groups.length * 100) : 0
    this.setData({
      state: 'working',
      current: index,
      group: viewOf(group, index),
      nextGroup: viewOf(this.groups[index + 1], index + 1),
      left: group.kind === 'time' ? group.seconds : 0,
      running: false,
      timeStarted: false,
      pctStyle: 'width:' + pct + '%;'
    })
    this.persistSession()
  },

  finishSet(skipped) {
    if (this.data.state !== 'working') return
    this.stopInterval()
    const completed = this.data.current + 1
    const next = this.groups[this.data.current + 1]
    const skippedGroups = this.data.skippedGroups + (skipped ? 1 : 0)
    if (!next || completed >= this.groups.length) {
      this.endAt = 0
      this.setData({
        current: this.groups.length,
        completed: this.groups.length,
        pctStyle: 'width:100%;',
        state: 'finished',
        running: false,
        skippedGroups: skippedGroups,
        costText: this.calcCost(),
        showFeedback: true
      })
      this.vibrate('long')
      this.persistFinished()
      return
    }

    const rest = this.groups[this.data.current].rest || 20
    const pct = Math.round(completed / this.groups.length * 100)
    this.endAt = Date.now() + rest * 1000
    this.setData({
      current: this.data.current + 1,
      completed: completed,
      pctStyle: 'width:' + pct + '%;',
      state: 'rest',
      restLeft: rest,
      group: viewOf(next, this.data.current + 1),
      nextGroup: viewOf(this.groups[this.data.current + 2], this.data.current + 2),
      running: false,
      timeStarted: false,
      skippedGroups: skippedGroups
    })
    this.vibrate('short')
    this.persistSession()
    this.startInterval()
  },

  skipRest() {
    if (this.data.state !== 'rest') return
    this.stopInterval()
    this.endAt = 0
    this.activate(this.data.current)
    this.vibrate('short')
  },

  extendRest() {
    if (this.data.state !== 'rest') return
    this.endAt = (this.endAt || Date.now()) + 15000
    this.setData({ restLeft: Math.max(0, this.data.restLeft) + 15 })
    this.persistSession()
  },

  vibrate(kind) {
    if (kind === 'long' && wx.vibrateLong) wx.vibrateLong({ fail: function () {} })
    if (kind !== 'long' && wx.vibrateShort) wx.vibrateShort({ fail: function () {} })
  },

  calcCost() {
    const seconds = Math.max(0, Math.round((Date.now() - this.startTs) / 1000))
    if (seconds < 60) return seconds + ' 秒'
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return rest ? minutes + ' 分 ' + rest + ' 秒' : minutes + ' 分钟'
  },

  onStartWork() {
    if (this.data.state !== 'working' || this.data.running) return
    const group = this.groups[this.data.current]
    if (!group) return
    let left = this.data.left
    if (!this.data.timeStarted) {
      left = group.seconds
      this.setData({ left: left, timeStarted: true })
    }
    this.endAt = Date.now() + left * 1000
    this.setData({ running: true })
    this.startInterval()
  },

  onPauseWork() {
    if (this.data.state !== 'working') return
    this.stopInterval()
    const remain = this.endAt ? Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000)) : this.data.left
    this.endAt = 0
    this.setData({ running: false, left: remain })
    this.persistSession()
  },

  onCompleteSet() { this.finishSet(false) },
  onSkipSet() { this.finishSet(true) },
  onSkipRest() { this.skipRest() },
  onExtendRest() { this.extendRest() },

  // 顶部返回：训练中打开退出确认弹层；已完成未保存时禁止退出/返回，必须先保存
  onNavBack() {
    if (this.data.state === 'finished') {
      // 训练已完成但尚未保存：不允许返回，避免本次成绩丢失
      if (!this._saved) {
        toast.show('请先保存本次训练')
        return
      }
      wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages/plan/plan' }) })
      return
    }
    // 一组都没完成时没有进度需要保存，直接退出，不弹「退出训练？」。
    if (Number(this.data.completed || 0) <= 0) {
      sessionStore.clear()
      wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages/plan/plan' }) })
      return
    }
    this.setData({ showExitConfirm: true })
    // 弹层显示期间冻结倒计时，避免后台继续走表/自动进入下一组
    this.pauseForDialog()
  },

  onCancelExit() {
    this.setData({ showExitConfirm: false })
    // 继续训练：恢复被打断的倒计时
    this.resumeAfterDialog()
  },

  // 暂停倒计时（休息或计时中），记住是否处于运行态以便恢复
  pauseForDialog() {
    this._pausedRunning = false
    if (this.data.state === 'rest') {
      this.stopInterval()
      if (this.endAt) {
        this.setData({ restLeft: Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000)) })
        this.endAt = 0
      }
      return
    }
    if (this.data.state === 'working' && this.data.running) {
      this._pausedRunning = true
      this.stopInterval()
      const remain = this.endAt ? Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000)) : this.data.left
      this.endAt = 0
      this.setData({ running: false, left: remain })
    }
  },

  // 恢复被暂停的倒计时
  resumeAfterDialog() {
    if (this.data.state === 'rest') {
      if (this.data.restLeft > 0) {
        this.endAt = Date.now() + this.data.restLeft * 1000
        this.startInterval()
      } else {
        this.skipRest()
      }
      return
    }
    if (this._pausedRunning && this.data.state === 'working') {
      const left = this.data.left > 0 ? this.data.left : ((this.groups[this.data.current] || {}).seconds || 0)
      this.endAt = Date.now() + left * 1000
      this.setData({ running: true })
      this.startInterval()
    }
    this._pausedRunning = false
  },

  noop() {},

  onConfirmExit() {
    this.setData({ showExitConfirm: false })
    this.persistSession()
    wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages/plan/plan' }) })
  },

  onChooseEffort(e) {
    this.setData({ effort: Number(e.currentTarget.dataset.value || 0) })
  },

  onFinishCheckin() {
    if (this._saving || this._saved) return
    this._saving = true
    this.setData({ isSaving: true })
    const plan = this.plan
    const actualSeconds = Math.max(0, Math.round((Date.now() - this.startTs) / 1000))
    try {
      store.addRecord({
        date: dateUtil.today(),
        type: 'plan',
        planId: plan.id,
        planName: plan.name,
        scene: plan.scene,
        sceneName: plansData.sceneName(plan.scene),
        duration: plan.duration,
        actualSeconds: actualSeconds,
        actualMinutes: Math.max(1, Math.round(actualSeconds / 60)),
        completedGroups: this.data.completed - this.data.skippedGroups,
        totalGroups: this.data.total,
        skippedGroups: this.data.skippedGroups,
        effort: this.data.effort,
        adjustmentsSnapshot: adjustments.get(this.planId)
      })
      this._saved = true
      sessionStore.clear()
      this.setData({ showFeedback: false, isSaving: false })
      toast.show('训练已保存', { success: true })
      this.defer(function () { wx.switchTab({ url: '/pages/checkin/checkin' }) }, 700)
    } catch (e) {
      this._saving = false
      this.setData({ isSaving: false })
      toast.show('保存失败，请重试')
    }
  }
})
