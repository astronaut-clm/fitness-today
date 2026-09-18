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

// 场景与难度档位都从 databases/plans.js 派生，页面不再自带一份清单
const sceneTabs = plansData.scenes.map(function (scene) {
  return { value: scene.value, name: scene.name + '计划' }
})

// 难度筛选只列出该场景真的有计划的档位：内置计划目前没有「高级」，
// 若照 LEVELS 全列出来，点进去必然是空列表——这种筛选项不该出现
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
    // 挑选模式：从首页「开始今日训练」进入，选中计划即可开始训练
    pick: false
  },

  onLoad(options) {
    // 非 tab 页可被分享路径/上次退出页面直接打开；未登录时先去首页登录，
    // 同时也避免在无登录态下请求 AI 重排
    if (!nav.requireLogin()) return
    this.setData({ pick: !!(options && options.pick === '1') })
    // 与首页 hero 对齐：推荐计划不在默认场景时，先切到它所在的场景，避免两处展示不一致
    const recPlan = recommend.pick(records.getAll(), profile.get())
    if (recPlan && isKnownScene(recPlan.scene) && recPlan.scene !== this.data.scene) {
      this.switchScene(recPlan.scene)
    }
    this.applyFilter()
    this.resolveAiPick(true)
  },

  onShow() {
    if (!nav.requireLogin()) return
    // 从自定义计划编辑页返回时刷新，保证新建/修改/删除即时生效。
    this.applyFilter()
    this.syncCustomPlans()
    this.resolveAiPick(false)
  },

  // 列表渲染合并：云端同步与 AI 结果常在很短时间内先后到达，
  // 各自立刻重算会连着打几次整表 setData；同一 tick 的多次请求合并成一次
  scheduleFilter() {
    if (this._filterQueued) return
    this._filterQueued = true
    Promise.resolve().then(() => {
      this._filterQueued = false
      this.applyFilter()
    })
  },

  // AI 重排：与首页 hero 同源（同日同签名命中缓存）；失败保持规则结果。
  // allowSceneSwitch 仅首次进入为 true：允许切到 AI 计划所在场景；后续 onShow 不抢场景，避免覆盖用户手动切换
  resolveAiPick(allowSceneSwitch) {
    aiRecommend.fetchPlan(records.getAll(), profile.get()).then((res) => {
      if (!res || !res.ok || !res.byAI) return
      const plan = customPlans.resolvePlan(res.planId)
      // 结果可能迟到：期间用户已离开本页，不必再重算列表
      if (!plan || !nav.alive(this)) return
      this._aiPlan = plan
      if (allowSceneSwitch && isKnownScene(plan.scene) && plan.scene !== this.data.scene) {
        this.switchScene(plan.scene)
      }
      this.scheduleFilter()
    }).catch(() => {})
  },

  // 已登录时与云端收敛偏好与自定义计划，换机/他端改动可见；限频与失败重试见 utils/profile.js 的 syncPull
  syncCustomPlans(force) {
    return profile.syncPull(this, {
      key: '_lastCustomSyncAt',
      force: !!force,
      onChange: () => this.scheduleFilter()
    })
  },

  // 切场景：难度筛选项随场景变（各场景有的档位不同），
  // 当前选中的档位在新场景里不存在时退回「全部」，否则会停在一个空列表上
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

  // 按当前场景 + 难度筛出计划列表，顺带标上「今日推荐」「继续训练」「今日已练 N 次」
  applyFilter() {
    // 全量读一次：今日次数统计与推荐打分都从这一份 records 算
    const all = records.getAll()
    const today = dateUtil.today()
    const counts = {}
    all.forEach(function (record) {
      if (record.date === today && record.planId) counts[record.planId] = (counts[record.planId] || 0) + 1
    })
    // 当日推荐计划：与首页 hero 同源（AI 重排已出结果时优先，否则规则打分）
    const recPlan = this._aiPlan || recommend.pick(all, profile.get())
    const recId = recPlan && recPlan.id
    // 进行中的训练：判据收在 sessionStore.isResumable，与计划详情页、训练页共用一份
    const active = sessionStore.get()
    const activeId = sessionStore.isResumable(active) ? active.planId : ''
    // 自定义计划固定展示在对应场景最上方，不参与难度筛选，保证用户随时可见。
    const custom = customPlans.listByScene(this.data.scene).map((p) => toCard(p, counts[p.id], recId, activeId))
    const builtin = plansData.listByScene(this.data.scene)
      .filter((p) => {
        return !this.data.level || p.level === this.data.level
      })
      .map((p) => toCard(p, counts[p.id], recId, activeId))
    const list = custom.concat(builtin)
    // 今日推荐置顶：作为当天训练的主入口（推荐不在当前场景时无需处理）
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
