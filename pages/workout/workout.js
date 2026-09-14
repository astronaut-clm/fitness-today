// pages/workout/workout.js 训练跟练
const plansData = require('../../data/plans.js')
const actionsData = require('../../data/actions.js')
const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const sessionStore = require('../../utils/workout-session.js')
const adjustments = require('../../utils/plan-adjustments.js')
const customPlans = require('../../utils/custom-plans.js')
const toast = require('../../utils/toast.js')
const voice = require('../../utils/voice.js')

function parseSeconds(reps) {
  const m = /^(\d+)\s*秒/.exec(String(reps || '').trim())
  return m ? +m[1] : 0
}

function parseRest(text) {
  const m = /^组间(\d+)\s*秒/.exec(String(text || '').trim())
  return m ? +m[1] : 0
}

// 语音文案：插件音色固定、不支持调速，靠文案与随机化避免反复播报显得机械
const CHEERS = [
  '加油，你可以的！',
  '燃起来，别停下！',
  '坚持住，就快到了！',
  '全力以赴，干就完了！',
  '再来一组，冲！'
]
const FINISH_LINES = [
  '训练完成，你太强了！',
  '全部搞定，太牛了！',
  '今天这波，满分收官！'
]

function pickVoiceLine(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function setVoiceText(group) {
  return group.name + '，' + group.targetText
}

function restVoiceText(seconds) {
  return '休息 ' + seconds + ' 秒，深呼吸，马上继续！'
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
    // 语音开关（本地持久化）；voiceSupported 仅在插件可用时展示
    voiceOn: true,
    voiceSupported: false,
    // 自绘导航状态栏高度（px）
    statusBarHeight: 0,
    // 恢复上次训练弹层
    showResumeConfirm: false,
    resumeDone: 0
  },

  onLoad(options) {
    this.planId = options.id || ''
    // navigationStyle: custom，需自行预留状态栏高度
    const win = wx.getWindowInfo()
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
      total: this.groups.length,
      voiceOn: voice.enabled(),
      voiceSupported: voice.available
    })
    this.warmupVoice()
    this.restoreOrStart()
  },

  onShow() {
    if (this.data.state === 'rest' && this.endAt) {
      this.startInterval()
      // 回前台立即校正，避免最多 1 秒显示延迟
      this.tick()
    }
  },

  onHide() {
    this.stopInterval()
    voice.stop()
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
    voice.destroy()
    if (this.data.state !== 'finished') this.persistSession()
  },

  restoreOrStart() {
    const session = sessionStore.belongsTo(this.planId)
    // 无已完成组则没有可恢复进度，直接从头开始
    if (!session || Number(session.completed || 0) <= 0) {
      sessionStore.clear()
      this.startFresh()
      return
    }
    // 恢复/重开用页内弹层确认
    this._resumeSession = session
    this.setData({
      showResumeConfirm: true,
      resumeDone: Number(session.completed || 0)
    })
  },

  // 继续上次未完成的训练
  onResumeContinue() {
    const session = this._resumeSession
    this.setData({ showResumeConfirm: false })
    this._resumeSession = null
    if (!session) return
    this.restoreSession(session)
  },

  // 放弃上次进度，重新开始
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
    this._countPhase = ''
    this._countValue = 0
    // 恢复后播报当前阶段，保证每组都有语音
    if (state === 'working') {
      this.announceGroup(this.groups[index])
    } else if (restLeft > 0) {
      voice.speak(restVoiceText(restLeft))
    }
    if (state === 'rest') {
      if (restLeft <= 0) this.skipRest()
      else this.startInterval()
    }
  },

  persistSession() {
    if (!this.plan || this.data.state === 'finished') return
    // 恢复弹层未选择时不落盘，避免初始态覆盖已存进度
    if (this.data.showResumeConfirm) return
    // 无已完成组则不保存
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

  // 进入 finished 态时落库为训练记录并清理本地进度
  finalizeWorkout() {
    if (!this.plan) return
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
        adjustmentsSnapshot: adjustments.get(this.planId)
      })
      sessionStore.clear()
    } catch (e) {
      toast.show('保存失败，请重试')
    }
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

  // 页面延迟任务统一登记，onUnload 清理，避免返回后回调误触发
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
      if (!this.endAt) { this.skipRest(); return }
      const remain = this.refreshRemain()
      if (remain <= 0) this.skipRest()
      else this.announceCountdown(remain, 'rest')
      return
    }
    if (this.data.state === 'working' && this.data.running && this.endAt) {
      const remain = this.refreshRemain()
      if (remain <= 0) this.finishSet(false)
      else this.announceCountdown(remain, 'work')
    }
  },

  // 提前合成本次训练用到的语句，避免播报时等网络合成
  warmupVoice() {
    if (!voice.available || !voice.enabled()) return
    const phrases = ['5', '4', '3', '2', '1'].concat(CHEERS).concat(FINISH_LINES)
    const seen = {}
    this.groups.forEach(function (group) {
      const setText = setVoiceText(group)
      if (!seen[setText]) { seen[setText] = 1; phrases.push(setText) }
      const restText = restVoiceText(group.rest || 20)
      if (!seen[restText]) { seen[restText] = 1; phrases.push(restText) }
    })
    voice.warmup(phrases)
  },

  announceGroup(group) {
    if (!group) return
    // 动作名与口号按序合成后一次入队，避免回调乱序导致口号先播
    // interrupt：打断上一阶段残留播报（如休息句/倒数），避免新组播报被拖延
    voice.speakAll([setVoiceText(group), pickVoiceLine(CHEERS)], { interrupt: true })
  },

  // 倒数 5/4/3/2/1：仅最后 5 秒播报，同值不重复。
  // 仅"5"带 interrupt 切断上一阶段残留长句，后续数字排队顺序播，
  // 避免每秒一次抢占（停止+重建音频实例）造成连续卡顿
  announceCountdown(remain, phase) {
    if (remain > 5) { this._countPhase = ''; this._countValue = 0; return }
    if (remain < 1) return
    if (this._countPhase === phase && this._countValue === remain) return
    this._countPhase = phase
    this._countValue = remain
    voice.speak(String(remain), { interrupt: remain === 5 })
  },

  onToggleVoice() {
    const on = !this.data.voiceOn
    voice.setEnabled(on)
    this.setData({ voiceOn: on })
    if (on) voice.speak('语音已开启，准备开练！')
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
    this._countPhase = ''
    this._countValue = 0
    this.announceGroup(group)
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
        costText: this.calcCost()
      })
      voice.speak(pickVoiceLine(FINISH_LINES), { interrupt: true })
      this.vibrate('long')
      this.finalizeWorkout()
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
    this._countPhase = ''
    this._countValue = 0
    // 打断上一组末尾的倒数播报，休息提示立即出声
    voice.speak(restVoiceText(rest), { interrupt: true })
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

  // 顶部返回：与系统右滑返回一致
  onNavBack() {
    if (this.data.state !== 'finished') {
      // 训练中：完成过组则保存进度，否则清空
      if (Number(this.data.completed || 0) > 0) this.persistSession()
      else sessionStore.clear()
    }
    wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages/plan/plan' }) })
  },

  noop() {},
})
