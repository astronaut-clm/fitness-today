// 计划详情页：动作清单 + 个人调整（组数/次数），从这里开始训练
const actionsData = require('../../databases/actions.js')
const adjustments = require('../../utils/plan-adjustments.js')
const customPlans = require('../../utils/custom-plans.js')
const exerciseItem = require('../../utils/exercise-item.js')
const sessionStore = require('../../utils/workout/session.js')
const toast = require('../../utils/toast.js')
const fontBehavior = require('../../utils/font.js').behavior

// 先查自定义，再回落内置计划库
const resolvePlan = customPlans.resolvePlan

Page({
  behaviors: [fontBehavior],

  data: {
    plan: null,
    items: [],
    hasActiveSession: false,
    hasAdjustments: false,
    readonly: false, // 从计划库进入时只供查看，不给开始训练/调整组数入口
    showSwitchConfirm: false,
    switchActiveName: ''
  },

  onLoad(options) {
    this.planId = options.id || ''
    this.readonly = options.readonly === '1'
    this.setData({ readonly: this.readonly })
    this.loadPlan()
  },

  onShow() {
    this.refreshStatus()
  },

  loadPlan() {
    const source = resolvePlan(this.planId)
    if (!source) {
      toast.back('计划不存在', { delay: 800 })
      return
    }
    const p = adjustments.apply(source)

    const rounds = p.loop || 1
    const items = p.exercises.map(function (ex) {
      const a = actionsData.getAction(ex.actionId) || {}
      const sets = Number(ex.sets || 0)
      return {
        actionId: ex.actionId,
        name: a.name || '未知动作',
        sets: ex.sets,
        targetText: exerciseItem.of(ex).text,
        rest: ex.rest || '',
        canReduce: sets > exerciseItem.MIN_SETS,
        canIncrease: sets < exerciseItem.MAX_SETS
      }
    })

    this.setData({
      plan: {
        name: p.name,
        duration: p.duration,
        calories: p.calories,
        summary: p.summary,
        notice: p.notice,
        roundsText: rounds > 1 ? '整组动作循环完成 ' + rounds + ' 轮' : '单轮完成所有动作',
        exTotal: items.length * rounds
      },
      items: items
    })
  },

  // 原始动作先建索引，避免逐个补丁线性查找
  computeHasAdjustments() {
    const patches = adjustments.get(this.planId).exercises
    if (!patches) return false
    const source = resolvePlan(this.planId)
    if (!source) return false
    const originals = {}
    ;(source.exercises || []).forEach(function (exercise) { originals[exercise.actionId] = exercise })
    return Object.keys(patches).some(function (actionId) {
      const original = originals[actionId]
      const sets = Number((patches[actionId] || {}).sets || 0)
      return !!original && sets > 0 && sets !== Number(original.sets || 0)
    })
  },

  refreshStatus() {
    this.setData({
      // 判据收在 sessionStore.isResumable，与列表页、训练页共用
      hasActiveSession: !!sessionStore.resumableFor(this.planId),
      hasAdjustments: this.computeHasAdjustments()
    })
  },

  goAction(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/tutorial-detail/tutorial-detail?id=' + id })
  },

  onWorkout() {
    if (!this.planId) return
    if (this.readonly) return
    const active = sessionStore.get()
    if (active && active.planId !== this.planId) {
      // 没有进度可丢就直接清掉，不弹确认
      if (!sessionStore.isResumable(active)) {
        sessionStore.clear()
      } else {
        const activePlan = resolvePlan(active.planId)
        // 别让「开始训练」点了没反应
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

  onRestoreDefault() {
    adjustments.clear(this.planId)
    this.loadPlan()
    this.refreshStatus()
  },

  noop() {},

  onAdjustSet(e) {
    const actionId = e.currentTarget.dataset.id
    const delta = Number(e.currentTarget.dataset.delta || 0)
    const current = (this.data.items || []).find(function (item) { return item.actionId === actionId })
    if (!current || !delta) return
    const sets = exerciseItem.clampSets(Number(current.sets || 1) + delta)
    if (sets === Number(current.sets || 1)) return
    adjustments.setSets(this.planId, actionId, sets)
    this.loadPlan()
    this.refreshStatus()
  },

  onShareAppMessage() {
    const plan = this.data.plan
    if (!plan) return { title: '一起来训练吧！', path: '/pages/index/index' }
    return {
      title: plan.name + '：' + plan.duration + ' 分钟 · 约 ' + plan.calories + ' kcal',
      path: '/pages/plan-detail/plan-detail?id=' + this.planId
    }
  },

  onShareTimeline() {
    const plan = this.data.plan
    if (!plan) return { title: '一起来训练吧！' }
    return {
      title: plan.name + '：' + plan.duration + ' 分钟',
      query: 'id=' + this.planId
    }
  }
})
