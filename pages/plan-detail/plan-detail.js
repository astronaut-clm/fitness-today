// pages/plan-detail/plan-detail.js
const plansData = require('../../data/plans.js')
const actionsData = require('../../data/actions.js')
const adjustments = require('../../utils/plan-adjustments.js')
const sessionStore = require('../../utils/workout-session.js')
const account = require('../../utils/account.js')
const levelUtil = require('../../utils/level.js')
const toast = require('../../utils/toast.js')

Page({
  data: {
    plan: null,
    items: [],
    hasActiveSession: false,
    hasAdjustments: false,
    // 只读模式：从计划库进入，仅供查看，不提供开始训练/调整组数入口。
    readonly: false,
    // 已有其它计划的未完成训练时，切换到本计划的确认弹层
    showSwitchConfirm: false,
    switchActiveName: '',
    // 登录引导弹层（页内像素弹窗）
    showLoginDialog: false
  },

  onLoad(options) {
    this.planId = options.id || ''
    this.readonly = options.readonly === '1'
    this.setData({ readonly: this.readonly })
    this.loadPlan()
  },

  onShow() {
    this.refreshStatus()
    this.syncAdjustments()
  },

  // 打开计划详情时与云端收敛个人计划调整，避免另一台设备改过的组数丢失。
  syncAdjustments() {
    if (!account.isLoggedIn()) return
    adjustments.syncFromCloud().then((res) => {
      if (res && res.ok && res.changed) {
        this.loadPlan()
        this.refreshStatus()
      }
    })
  },

  loadPlan() {
    const source = plansData.getPlan(this.planId)
    if (!source) {
      toast.back('计划不存在', { delay: 800 })
      return
    }
    const p = adjustments.apply(source)

    const rounds = p.loop || 1
    const items = p.exercises.map(function (ex) {
      const a = actionsData.getAction(ex.actionId) || {}
      return {
        actionId: ex.actionId,
        name: a.name || '未知动作',
        category: a.category || '',
        equipment: a.equipment || '',
        muscles: (a.muscles || []).join(' · '),
        sets: ex.sets,
        reps: ex.reps,
        rest: ex.rest || '',
        canReduce: Number(ex.sets || 0) > 1,
        canIncrease: Number(ex.sets || 0) < 9
      }
    })

    this.setData({
      plan: {
        id: p.id,
        name: p.name,
        scene: p.scene,
        sceneName: plansData.sceneName(p.scene),
        level: p.level,
        lvClass: levelUtil.tagClass(p.level),
        duration: p.duration,
        calories: p.calories,
        summary: p.summary,
        notice: p.notice,
        tags: p.tags,
        roundsText: rounds > 1 ? '整组动作循环完成 ' + rounds + ' 轮' : '单轮完成所有动作',
        exTotal: items.length * rounds
      },
      items: items
    })
  },

  refreshStatus() {
    const active = sessionStore.belongsTo(this.planId)
    const adjustment = adjustments.get(this.planId)
    const source = plansData.getPlan(this.planId)
    const hasAdjustments = !!(adjustment.exercises && Object.keys(adjustment.exercises).some(function (actionId) {
      const patch = adjustment.exercises[actionId] || {}
      const original = source && (source.exercises || []).filter(function (exercise) { return exercise.actionId === actionId })[0]
      return original && Object.keys(patch).some(function (key) { return patch[key] !== original[key] })
    }))
    // 已「完成未保存」的 finished 会话不占入口按钮（进入跟练页后再提示重新开始）；
    // 一组都没完成的会话同样不算进度，按钮显示「开始训练」。
    const activeDone = Number((active && active.completed) || 0)
    this.setData({
      hasActiveSession: !!(active && active.state !== 'finished' && activeDone > 0),
      hasAdjustments: hasAdjustments
    })
  },

  goAction(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/tutorial-detail/tutorial-detail?id=' + id })
  },

  // 进入跟练页，逐组完成训练
  onWorkout() {
    if (!this.planId) return
    if (this.readonly) return
    if (!account.requireLogin()) { this.setData({ showLoginDialog: true }); return }
    const active = sessionStore.get()
    if (active && active.planId !== this.planId) {
      // 其它计划一组都没完成时没有进度可丢，直接清掉，不再弹确认。
      if (Number(active.completed || 0) <= 0) {
        sessionStore.clear()
      } else {
        const activePlan = plansData.getPlan(active.planId)
        // 存在其它计划的未完成训练时弹页内确认层，避免点击「开始训练」无响应。
        this.setData({
          showSwitchConfirm: true,
          switchActiveName: (activePlan && activePlan.name) || active.planId
        })
        return
      }
    }
    wx.navigateTo({ url: '/pages/workout/workout?id=' + this.planId })
  },

  onCancelSwitch() {
    this.setData({ showSwitchConfirm: false })
  },

  onConfirmSwitch() {
    this.setData({ showSwitchConfirm: false })
    sessionStore.clear()
    wx.navigateTo({ url: '/pages/workout/workout?id=' + this.planId })
  },

  onCancelLogin() {
    this.setData({ showLoginDialog: false })
  },

  onConfirmLogin() {
    this.setData({ showLoginDialog: false })
    wx.switchTab({ url: '/pages/checkin/checkin' })
  },

  onRestoreDefault() {
    adjustments.clear(this.planId)
    this.loadPlan()
    this.refreshStatus()
    if (account.isLoggedIn()) adjustments.pushToCloud()
    toast.show('已恢复默认计划')
  },

  onAdjustArea() {},

  noop() {},

  onAdjustSet(e) {
    const actionId = e.currentTarget.dataset.id
    const delta = Number(e.currentTarget.dataset.delta || 0)
    const current = (this.data.items || []).filter(function (item) { return item.actionId === actionId })[0]
    if (!current || !delta) return
    const sets = Math.max(1, Math.min(9, Number(current.sets || 1) + delta))
    if (sets === Number(current.sets || 1)) return
    adjustments.setExercise(this.planId, actionId, { sets: sets })
    this.loadPlan()
    this.refreshStatus()
    // 已登录时同步个人调整，换设备可恢复；连点合并推送，避免每次都发云函数请求。
    this.pushAdjustments()
  },

  // 合并 500ms 内的连续调整，只推一次云端。
  pushAdjustments() {
    if (!account.isLoggedIn()) return
    if (this._pushTimer) clearTimeout(this._pushTimer)
    this._pushTimer = setTimeout(() => {
      this._pushTimer = null
      adjustments.pushToCloud()
    }, 500)
  },

  onUnload() {
    // 离开页面时把未推送的调整补发，避免防抖窗口内的改动丢失。
    if (this._pushTimer) {
      clearTimeout(this._pushTimer)
      this._pushTimer = null
      if (account.isLoggedIn()) adjustments.pushToCloud()
    }
  }
})
