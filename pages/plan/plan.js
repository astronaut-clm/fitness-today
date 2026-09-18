// 计划列表页：按场景（居家/健身房）+ 难度筛选，标出今日推荐与进行中的训练
const plansData = require('../../databases/plans.js')
const customPlans = require('../../utils/custom-plans.js')
const records = require('../../utils/records.js')
const dateUtil = require('../../utils/date.js')
const recommend = require('../../utils/recommend.js')
const aiRecommend = require('../../utils/ai/recommend.js')
const profile = require('../../utils/profile.js')
const sessionStore = require('../../utils/workout/session.js')
const nav = require('../../utils/nav.js')
const fontBehavior = require('../../utils/font.js').behavior

// 场景与难度档位都从 databases/plans.js 派生
const sceneTabs = plansData.scenes.map(function (scene) {
  return { value: scene.value, name: scene.name + '计划' }
})

// 只列该场景真有计划的档位：内置计划没有「高级」，全列出来点进去必然是空列表
function levelTabsFor(scene) {
  const available = {}
  plansData.listByScene(scene).forEach(function (plan) { available[plan.level] = true })
  return [{ value: '', name: '全部' }].concat(
    plansData.LEVELS.filter(function (level) { return available[level] })
      .map(function (level) { return { value: level, name: level } })
  )
}

function isKnownScene(scene) {
  return plansData.SCENES.indexOf(scene) >= 0
}

function toCard(p, done, recId, activeId) {
  const rounds = p.loop || 1
  return {
    id: p.id,
    name: p.name,
    level: p.level,
    tags: p.tags || [],
    summary: p.summary,
    custom: !!p.custom,
    recommended: !!recId && p.id === recId,
    continuing: !!activeId && p.id === activeId,
    exCount: (p.exercises || []).length * rounds,
    roundsText: rounds > 1 ? rounds + ' 轮循环' : '单轮完成',
    doneCount: Number(done || 0)
  }
}

Page({
  behaviors: [fontBehavior],

  data: {
    sceneTabs: sceneTabs,
    levelTabs: levelTabsFor(plansData.SCENES[0]),
    scene: plansData.SCENES[0],
    level: '',
    list: [],
    pick: false // 挑选模式：从首页进入，选中即开始训练
  },

  onLoad(options) {
    // 分享路径/恢复上次退出页都可能直接打开本页；也避免无登录态下请求 AI
    if (!nav.requireLogin()) return
    this.setData({ pick: !!(options && options.pick === '1') })
    // 与首页 hero 对齐：推荐不在默认场景时先切过去，避免两处不一致
    const recPlan = recommend.pick(records.getAll(), profile.get())
    if (recPlan && isKnownScene(recPlan.scene) && recPlan.scene !== this.data.scene) {
      this.switchScene(recPlan.scene)
    }
    this.applyFilter()
    this.resolveAiPick(true)
  },

  onShow() {
    if (!nav.requireLogin()) return
    // 从自定义计划编辑页返回要刷新
    this.applyFilter()
    this.syncCustomPlans()
    this.resolveAiPick(false)
  },

  // 云端同步与 AI 结果常在很短时间内先后到达，合并同一 tick 的多次重算，省掉连续整表 setData
  scheduleFilter() {
    if (this._filterQueued) return
    this._filterQueued = true
    Promise.resolve().then(() => {
      this._filterQueued = false
      this.applyFilter()
    })
  },

  // 与首页 hero 同源（同日同签名命中缓存），失败保持规则结果。
  // allowSceneSwitch 只在首次进入为 true，后续 onShow 不抢场景，免得覆盖用户手动切换
  resolveAiPick(allowSceneSwitch) {
    aiRecommend.fetchPlan(records.getAll(), profile.get()).then((res) => {
      if (!res || !res.ok || !res.byAI) return
      const plan = customPlans.resolvePlan(res.planId)
      if (!plan || !nav.alive(this)) return // 结果可能迟到，此时用户已离开
      this._aiPlan = plan
      if (allowSceneSwitch && isKnownScene(plan.scene) && plan.scene !== this.data.scene) {
        this.switchScene(plan.scene)
      }
      this.scheduleFilter()
    }).catch(() => {})
  },

  // 与云端收敛偏好与自定义计划，让换机/他端改动可见
  syncCustomPlans() {
    return profile.syncPull(this, {
      key: '_lastCustomSyncAt',
      onChange: () => this.scheduleFilter()
    })
  },

  // 各场景的难度档位不同，选中项在新场景不存在时退回「全部」，否则会停在空列表上
  switchScene(scene) {
    const levelTabs = levelTabsFor(scene)
    const stillThere = levelTabs.some(function (tab) { return tab.value === this.data.level }, this)
    this.setData({
      scene: scene,
      levelTabs: levelTabs,
      level: stillThere ? this.data.level : ''
    })
  },

  onSceneTap(e) {
    const scene = e.currentTarget.dataset.scene
    if (scene === this.data.scene) return
    this.switchScene(scene)
    this.applyFilter()
  },

  onLevelTap(e) {
    const level = e.currentTarget.dataset.level
    this.setData({ level: level })
    this.applyFilter()
  },

  // 按场景 + 难度筛列表，顺带标上「今日推荐」「继续训练」「今日已练 N 次」
  applyFilter() {
    // 读一次，今日次数与推荐打分都从这一份算
    const all = records.getAll()
    const today = dateUtil.today()
    const counts = {}
    all.forEach(function (record) {
      if (record.date === today && record.planId) counts[record.planId] = (counts[record.planId] || 0) + 1
    })
    // AI 重排已出结果时优先，否则规则打分
    const recPlan = this._aiPlan || recommend.pick(all, profile.get())
    const recId = recPlan && recPlan.id
    const active = sessionStore.get()
    const activeId = sessionStore.isResumable(active) ? active.planId : ''
    // 自定义计划固定置顶且不参与难度筛选，保证随时可见
    const custom = customPlans.listByScene(this.data.scene).map((p) => toCard(p, counts[p.id], recId, activeId))
    const builtin = plansData.listByScene(this.data.scene)
      .filter((p) => {
        return !this.data.level || p.level === this.data.level
      })
      .map((p) => toCard(p, counts[p.id], recId, activeId))
    const list = custom.concat(builtin)
    // 今日推荐置顶，作为当天训练的主入口
    if (recId) {
      const recIndex = list.findIndex(function (card) { return card.id === recId })
      if (recIndex > 0) list.unshift(list.splice(recIndex, 1)[0])
    }
    this.setData({ list: list })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/plan-detail/plan-detail?id=' + id + (this.data.pick ? '' : '&readonly=1') })
  }
})
