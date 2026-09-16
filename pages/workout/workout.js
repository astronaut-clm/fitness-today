const plansData = require('../../data/plans.js')
const actionsData = require('../../data/actions.js')
const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const sessionStore = require('../../utils/workout-session.js')
const adjustments = require('../../utils/plan-adjustments.js')
const customPlans = require('../../utils/custom-plans.js')
const insights = require('../../utils/insights.js')
const account = require('../../utils/account.js')
const feed = require('../../utils/feed.js')
const toast = require('../../utils/toast.js')
const voice = require('../../utils/voice.js')
const profileStore = require('../../utils/profile.js')
const aiReview = require('../../utils/ai-review.js')
const aiCheers = require('../../utils/ai-cheers.js')

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

// 完成页文案：按完成度分档随机取一句，避免每次都一样
const PRAISE = {
  perfect: [
    '完美通关，太强了！',
    '满分开局，收工！',
    '一组不落，教科书级别！',
    '今天这场，无可挑剔！'
  ],
  partial: [
    '尽力了，就是满分！',
    '完成就好，明天继续！',
    '能坚持到现在，已经赢了！'
  ]
}

const CHEER_LINES = [
  '今天的汗水，都会在明天还给你。',
  '不用和谁比，你赢过了想躺下的自己。',
  '每一次坚持，身体都记得。',
  '练完这一场，今天就算赢了。',
  '你已经比开始的自己更强一点了。',
  '慢慢来，比较快，明天见。'
]

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function setVoiceText(group) {
  return group.name + '，' + group.targetText
}

// 休息播报预告下一组动作名，更像教练带练；无下一组时退化为通用句
function restVoiceText(seconds, nextName) {
  if (nextName) return '休息 ' + seconds + ' 秒，深呼吸，接下来是 ' + nextName
  return '休息 ' + seconds + ' 秒，深呼吸，马上继续！'
}

function buildGroups(plan) {
  const groups = []
  const loop = plan.loop || 1
  const defRest = plan.scene === 'gym' ? 60 : 20
  for (let round = 1; round <= loop; round++) {
    plan.exercises.forEach(function (exercise) {
      const action = actionsData.getAction(exercise.actionId) || {}
      const seconds = customPlans.parseSeconds(exercise.reps, 0)
      const rest = parseRest(exercise.rest) || defRest
      for (let set = 1; set <= (exercise.sets || 1); set++) {
        groups.push({
          name: action.name || exercise.actionId,
          category: action.category || '训练',
          equipment: action.equipment || '',
          targetText: exercise.reps || '完成规定次数',
          seconds: seconds,
          kind: seconds > 0 ? 'time' : 'count',
          rest: rest,
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
    completed: 0,
    pctStyle: 'width:0%;',
    state: 'working',
    group: null,
    nextGroup: null,
    workLeft: 0,
    running: false,
    timeStarted: false,
    restLeft: 0,
    costText: '',
    skippedGroups: 0,
    // 语音开关（本地持久化）；voiceSupported 仅在插件可用时展示
    voiceOn: true,
    voiceSupported: false,
    statusBarHeight: 0,
    showResumeConfirm: false,
    resumeDone: 0,
    doneTitle: '',
    doneCheer: '',
    doneComment: '',
    doneCommentLive: false,
    doneStats: [],
    canShareFeed: false,
    feedPosted: false,
    feedPosting: false
  },

  onLoad(options) {
    this.planId = options.id || ''
    // 当前组下标仅 JS 内部使用（wxml 渲染用 group.setNo），挂实例避免无谓的 setData 开销
    this.current = 0
    // 跟练期间保持屏幕常亮，避免倒计时中断
    wx.setKeepScreenOn({ keepScreenOn: true, fail: function () {} })
    // navigationStyle: custom，需自行预留状态栏高度
    const win = wx.getWindowInfo()
    const topInset = (win && (win.statusBarHeight || (win.safeArea && win.safeArea.top))) || 0
    if (topInset) this.setData({ statusBarHeight: topInset })
    const source = customPlans.resolvePlan(this.planId)
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
    this.loadAiCheers()
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
      const remain = this.endAt ? Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000)) : this.data.workLeft
      this.endAt = 0
      this.setData({ running: false, workLeft: remain })
    }
    this.persistSession()
  },

  onUnload() {
    this.stopInterval()
    this.clearTimers()
    voice.stop()
    // 退出跟练页后恢复系统默认息屏策略
    wx.setKeepScreenOn({ keepScreenOn: false, fail: function () {} })
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
    const state = session.state === 'rest' ? 'rest' : 'working'
    const group = viewOf(this.groups[index], index)
    const next = viewOf(this.groups[index + 1], index + 1)
    const pct = this.groups.length ? Math.round(completed / this.groups.length * 100) : 0
    const restLeft = state === 'rest' && this.endAt ? Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000)) : 0
    this.current = index
    this.setData({
      completed: completed,
      pctStyle: 'width:' + pct + '%;',
      state: state,
      group: group,
      nextGroup: next,
      workLeft: Number(session.remainingSeconds || (group && group.seconds) || 0),
      restLeft: restLeft,
      running: false,
      timeStarted: !!session.timeStarted,
      skippedGroups: Number(session.skippedGroups || 0)
    })
    this._countPhase = ''
    this._countValue = 0
    this._cheerStage = 0
    // 恢复后播报当前阶段，保证每组都有语音
    if (state === 'working') {
      this.announceGroup(this.groups[index])
    } else if (restLeft > 0) {
      const nextGroup = this.groups[index]
      voice.speak(restVoiceText(restLeft, nextGroup && nextGroup.name))
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
    if (Number(this.data.completed || 0) <= 0) return
    sessionStore.save({
      planId: this.planId,
      startedAt: this.startTs || Date.now(),
      current: this.current,
      completed: this.data.completed,
      state: this.data.state,
      timeStarted: this.data.timeStarted,
      remainingSeconds: this.data.workLeft,
      restEndsAt: this.data.state === 'rest' ? this.endAt : 0,
      skippedGroups: this.data.skippedGroups
    })
  },

  // 进入 finished 态时落库为训练记录并清理本地进度
  finalizeWorkout() {
    if (!this.plan) return null
    const plan = this.plan
    const actualSeconds = Math.max(0, Math.round((Date.now() - this.startTs) / 1000))
    try {
      const saved = store.addRecord({
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
        skippedGroups: this.data.skippedGroups
      })
      sessionStore.clear()
      return saved
    } catch (e) {
      toast.show('保存失败，请重试')
      return null
    }
  },

  // 完成页文案与统计（基于刚落库的记录）；records 由调用方一次读取，与 AI 点评共用同一快照
  buildFinishFeedback(records) {
    const total = this.data.total || 1
    const skipped = this.data.skippedGroups || 0
    const done = Math.max(0, total - skipped)
    const stats = store.computeStatsFrom(records)
    const insight = insights.build(records)

    const titles = skipped === 0 ? PRAISE.perfect : PRAISE.partial

    return {
      doneTitle: pickOne(titles),
      doneCheer: pickOne(CHEER_LINES),
      doneStats: [
        { label: '完成组数', value: done + '/' + total },
        { label: '用时', value: this.data.costText },
        { label: '连续打卡', value: stats.streak + ' 天' },
        { label: '本周训练', value: insight.weekDays + ' 次' }
      ],
      canShareFeed: account.isLoggedIn(),
      feedPosted: false
    }
  },

  // 训练后 AI 点评：流式逐字打出，失败静默（完成页保留默认文案）
  loadAiReview(record, skippedGroups, records) {
    if (!record || !record.id) return
    const total = this.data.total || 0
    const apply = (patch) => {
      // 页面已离开完成态（返回/重开）则不再写入
      if (this.data.state === 'finished') this.setData(patch)
    }
    // 卡片立即出现（占位文案），不等模型首个字，掩盖思考延迟
    apply({ doneComment: '', doneCommentLive: true })
    aiReview.streamReview({
      recordId: record.id,
      planName: this.data.planName,
      done: Math.max(0, total - (skippedGroups || 0)),
      total: total,
      skipped: skippedGroups || 0,
      costText: this.data.costText,
      goal: profileStore.get().goal,
      records: records
    }, (text) => {
      apply({ doneComment: text, doneCommentLive: true })
    }).then((res) => {
      // 失败则收起占位卡片，完成页保持默认文案
      if (res && res.ok) {
        apply({ doneComment: res.text, doneCommentLive: false })
        // 点评成稿后播报：排在结束语之后出声（非抢占）；语音关闭/插件不可用时静默跳过
        if (this.data.state === 'finished' && voice.available && voice.enabled()) {
          voice.speak(res.text)
        }
      } else {
        apply({ doneComment: '', doneCommentLive: false })
      }
    })
  },

  onShareToFeed() {
    if (this.data.feedPosting) return
    const done = Math.max(0, (this.data.total || 0) - (this.data.skippedGroups || 0))
    const text = '今天完成《' + this.data.planName + '》，' + done + '/' + this.data.total + ' 组，用时 ' + this.data.costText + '。' + this.data.doneCheer
    // 点击立即进入发布中状态：云函数含内容安全检测，返回需要一定时间
    this.setData({ feedPosting: true })
    feed.create(text).then((res) => {
      this.setData({ feedPosting: false })
      if (!res || !res.ok) {
        toast.show(feed.createErrorText(res && res.code))
        return
      }
      this.setData({ feedPosted: true })
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
    else this.setData({ workLeft: remain })
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
      if (remain <= 0) { this.finishSet(false); return }
      this.announceCountdown(remain, 'work')
      // 计时组分阶段鼓励：≥30 秒组在 2/3、1/3 处各一句，20~29 秒组中点一句；
      // 鼓励点天然避开最后 5 秒倒数区，短组不插话避免吵
      const group = this.groups[this.current]
      if (group && group.kind === 'time' && group.seconds >= 20) {
        const total = group.seconds
        const points = total >= 30
          ? [Math.floor(total * 2 / 3), Math.floor(total / 3)]
          : [Math.floor(total / 2)]
        const stage = this._cheerStage || 0
        if (stage < points.length && remain <= points[stage]) {
          this._cheerStage = stage + 1
          voice.speak(this.pickCheer())
        }
      }
    }
  },

  // 提前合成本次训练用到的语句，避免播报时等网络合成
  warmupVoice() {
    if (!voice.available || !voice.enabled()) return
    const phrases = ['5', '4', '3', '2', '1'].concat(CHEERS).concat(FINISH_LINES)
    const seen = {}
    this.groups.forEach(function (group, idx) {
      const setText = setVoiceText(group)
      if (!seen[setText]) { seen[setText] = 1; phrases.push(setText) }
      const next = this.groups[idx + 1]
      const restText = restVoiceText(group.rest || 20, next && next.name)
      if (!seen[restText]) { seen[restText] = 1; phrases.push(restText) }
    }, this)
    voice.warmup(phrases)
  },

  // 进入页面即后台生成个性化鼓励语：就绪后混入播报池并预合成，失败则全程用固定池
  loadAiCheers() {
    this._cheers = CHEERS
    this._cheerBag = null
    if (!voice.available || !voice.enabled()) return
    aiCheers.fetch({
      planId: this.planId,
      planName: this.plan.name,
      records: store.getAllRecords(),
      goal: profileStore.get().goal,
      groups: this.groups.length
    }).then((res) => {
      if (!res || !res.ok) return
      this._cheers = res.lines.concat(CHEERS)
      this._cheerBag = null // 换池重洗
      voice.warmup(res.lines)
    })
  },

  // 洗牌抽袋：每句抽完才重新洗牌，保证生成的文案都能被听到，且短期不重样
  pickCheer() {
    const pool = this._cheers || CHEERS
    if (!this._cheerBag || !this._cheerBag.length) {
      const bag = pool.slice()
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const t = bag[i]; bag[i] = bag[j]; bag[j] = t
      }
      // 新袋首句避免与上袋末句相同
      if (this._lastCheer && bag.length > 1 && bag[bag.length - 1] === this._lastCheer) {
        const t = bag[0]; bag[0] = bag[bag.length - 1]; bag[bag.length - 1] = t
      }
      this._cheerBag = bag
    }
    const line = this._cheerBag.pop()
    this._lastCheer = line
    return line
  },

  announceGroup(group) {
    if (!group) return
    // 动作名与口号按序合成后一次入队，避免回调乱序导致口号先播
    // interrupt：打断上一阶段残留播报（如休息句/倒数），避免新组播报被拖延
    voice.speakAll([setVoiceText(group), this.pickCheer()], { interrupt: true })
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
    this.current = index
    const completed = this.data.completed || 0
    const pct = this.groups.length ? Math.round(completed / this.groups.length * 100) : 0
    this.setData({
      state: 'working',
      group: viewOf(group, index),
      nextGroup: viewOf(this.groups[index + 1], index + 1),
      workLeft: group.kind === 'time' ? group.seconds : 0,
      running: false,
      timeStarted: false,
      pctStyle: 'width:' + pct + '%;'
    })
    this._countPhase = ''
    this._countValue = 0
    this._cheerStage = 0
    this.announceGroup(group)
    this.persistSession()
  },

  finishSet(skipped) {
    if (this.data.state !== 'working') return
    this.stopInterval()
    const completed = this.current + 1
    const next = this.groups[this.current + 1]
    const skippedGroups = this.data.skippedGroups + (skipped ? 1 : 0)
    if (!next || completed >= this.groups.length) {
      this.endAt = 0
      this.current = this.groups.length
      this.setData({
        completed: this.groups.length,
        pctStyle: 'width:100%;',
        state: 'finished',
        running: false,
        skippedGroups: skippedGroups,
        costText: this.calcCost()
      })
      voice.speak(pickOne(FINISH_LINES), { interrupt: true })
      this.vibrate('long')
      const saved = this.finalizeWorkout()
      // 一次全量读取，完成页统计与 AI 点评共用同一快照
      const records = store.getAllRecords()
      this.setData(this.buildFinishFeedback(records))
      this.loadAiReview(saved, skippedGroups, records)
      return
    }

    const rest = this.groups[this.current].rest || 20
    const pct = Math.round(completed / this.groups.length * 100)
    this.endAt = Date.now() + rest * 1000
    this.current = this.current + 1
    this.setData({
      completed: completed,
      pctStyle: 'width:' + pct + '%;',
      state: 'rest',
      restLeft: rest,
      group: viewOf(next, this.current),
      nextGroup: viewOf(this.groups[this.current + 1], this.current + 1),
      running: false,
      timeStarted: false,
      skippedGroups: skippedGroups
    })
    this._countPhase = ''
    this._countValue = 0
    this._cheerStage = 0
    // 打断上一组末尾的倒数播报，休息提示立即出声
    voice.speak(restVoiceText(rest, next && next.name), { interrupt: true })
    this.vibrate('short')
    this.persistSession()
    this.startInterval()
  },

  skipRest() {
    if (this.data.state !== 'rest') return
    this.stopInterval()
    this.endAt = 0
    this.activate(this.current)
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

  onPauseWork() {
    if (this.data.state !== 'working') return
    this.stopInterval()
    const remain = this.endAt ? Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000)) : this.data.workLeft
    this.endAt = 0
    this.setData({ running: false, workLeft: remain })
    this.persistSession()
  },

  onCompleteSet() { this.finishSet(false) },
  onSkipSet() { this.finishSet(true) },

  onNavBack() {
    if (this.data.state !== 'finished') {
      // 训练中：完成过组则保存进度，否则清空
      if (Number(this.data.completed || 0) > 0) this.persistSession()
      else sessionStore.clear()
    }
    wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages/plan/plan' }) })
  }
})
