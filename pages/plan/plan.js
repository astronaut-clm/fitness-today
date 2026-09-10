// pages/plan/plan.js
const plansData = require('../../data/plans.js')
const levelUtil = require('../../utils/level.js')

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

Page({
  data: {
    sceneTabs: sceneTabs,
    levelTabs: levelTabs,
    scene: 'home',
    level: '',
    list: [],
    // 挑选模式：从首页「开始训练计划」进入，选中计划即可开始训练
    pick: false
  },

  onLoad(options) {
    // 从首页「开始训练计划」进入时（pick=1）允许直接开始训练；默认仅供浏览。
    this.pick = !!(options && options.pick === '1')
    this.setData({ pick: this.pick })
    this.applyFilter()
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

  applyFilter() {
    const list = plansData.listByScene(this.data.scene)
      .filter((p) => {
        return !this.data.level || p.level === this.data.level
      })
      .map((p) => {
        const rounds = p.loop || 1
        return {
          id: p.id,
          name: p.name,
          sceneName: plansData.sceneName(p.scene),
          level: p.level,
          lvClass: levelUtil.tagClass(p.level),
          duration: p.duration,
          calories: p.calories,
          tags: p.tags,
          summary: p.summary,
          exCount: p.exercises.length * rounds,
          roundsText: rounds > 1 ? rounds + ' 轮循环' : '单轮完成'
        }
      })
    this.setData({ list: list })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    // 计划库默认仅用于浏览：进入只读详情页。
    // 从首页「开始训练计划」进入的 pick 模式下，进入可开始训练的详情页。
    wx.navigateTo({ url: '/pages/plan-detail/plan-detail?id=' + id + (this.pick ? '' : '&readonly=1') })
  }
})
