const plansData = require('../../data/plans.js')
const customPlans = require('../../utils/custom-plans.js')
const store = require('../../utils/store.js')
const account = require('../../utils/account.js')
const dateUtil = require('../../utils/date.js')
const levelUtil = require('../../utils/level.js')
const recommend = require('../../utils/recommend.js')
const profile = require('../../utils/profile.js')
const sessionStore = require('../../utils/workout-session.js')

const sceneTabs = [
  { value: 'home', name: '居家计划' },
  { value: 'gym', name: '健身房计划' }
]

const levelTabs = [
  { value: '', name: '全部' },
  { value: '初级', name: '初级' },
  { value: '中级', name: '中级' },
  { value: '高级', name: '高级' }
]

// 把内置/自定义计划统一转成列表卡片数据。activeId 为进行中的计划 id，用于展示「继续训练」。
function toCard(p, done, recId, activeId) {
  const rounds = p.loop || 1
  return {
    id: p.id,
    name: p.name,
    sceneName: plansData.sceneName(p.scene),
    level: p.level,
    lvClass: levelUtil.tagClass(p.level),
    duration: p.duration,
    calories: p.calories,
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
  data: {
    sceneTabs: sceneTabs,
    levelTabs: levelTabs,
    scene: 'home',
    level: '',
    list: [],
    // 挑选模式：从首页「开始今日训练」进入，选中计划即可开始训练
    pick: false
  },

  onLoad(options) {
    // 从首页「开始今日训练」进入时（pick=1）允许直接开始训练；默认仅供浏览。
    this.pick = !!(options && options.pick === '1')
    this.setData({ pick: this.pick })
    // 与首页 hero 对齐：推荐计划不在默认场景时定位过去，避免两处展示不一致。
    // 记录快照供推荐与列表统计共用，避免重复全量读取。
    const allRecords = store.getAllRecords()
    const recPlan = recommend.pick(allRecords, profile.get())
    if (recPlan && (recPlan.scene === 'home' || recPlan.scene === 'gym') && recPlan.scene !== this.data.scene) {
      this.setData({ scene: recPlan.scene })
    }
    this.applyFilter(allRecords)
  },

  onShow() {
    // 从自定义计划编辑页返回时刷新，保证新建/修改/删除即时生效。
    this.applyFilter()
    this.syncCustomPlans()
  },

  // 已登录时与云端收敛自定义计划，换机/他端改动可见；30 秒内只拉一次，避免频繁切页重复请求。
  syncCustomPlans(force) {
    if (!account.isLoggedIn()) return
    const now = Date.now()
    if (!force && this._lastCustomSyncAt && now - this._lastCustomSyncAt < 30000) return
    this._lastCustomSyncAt = now
    customPlans.syncFromCloud().then((res) => {
      if (res && res.ok && res.changed) this.applyFilter()
      if (!res || !res.ok) this._lastCustomSyncAt = 0
    }).catch(() => { this._lastCustomSyncAt = 0 })
  },

  onSceneTap(e) {
    const scene = e.currentTarget.dataset.scene
    this.setData({ scene: scene })
    this.applyFilter()
  },

  onLevelTap(e) {
    const level = e.currentTarget.dataset.level
    this.setData({ level: level })
    this.applyFilter()
  },

  // records：可选记录快照。传入时复用同一份，避免调用方已读取后此处再次全量读取。
  applyFilter(records) {
    const allRecords = records || store.getAllRecords()
    // 统计每个计划今天的完成次数（只算当天记录，隔天自动清零）。
    const today = dateUtil.today()
    const counts = {}
    allRecords.forEach((record) => {
      if (!record.planId || record.date !== today) return
      counts[record.planId] = (counts[record.planId] || 0) + 1
    })
    // 当日推荐计划：与首页 hero 同一套推荐算法，在列表里打「今日推荐」标签便于识别。
    const recPlan = recommend.pick(allRecords, profile.get())
    const recId = recPlan && recPlan.id
    // 进行中的训练：与计划详情页同一判断（未完成且至少完成一组），用于展示「继续训练」入口。
    const active = sessionStore.get()
    const activeDone = Number((active && active.completed) || 0)
    const activeId = active && active.state !== 'finished' && activeDone > 0 ? active.planId : ''
    // 自定义计划固定展示在对应场景最上方，不参与难度筛选，保证用户随时可见。
    const custom = customPlans.listByScene(this.data.scene).map((p) => toCard(p, counts[p.id], recId, activeId))
    const builtin = plansData.listByScene(this.data.scene)
      .filter((p) => {
        return !this.data.level || p.level === this.data.level
      })
      .map((p) => toCard(p, counts[p.id], recId, activeId))
    this.setData({ list: custom.concat(builtin) })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    // 默认仅浏览（只读详情）；首页「开始今日训练」的 pick 模式才可开始训练。
    wx.navigateTo({ url: '/pages/plan-detail/plan-detail?id=' + id + (this.pick ? '' : '&readonly=1') })
  }
})
