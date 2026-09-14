// pages/tutorial-detail/tutorial-detail.js
const actionsData = require('../../data/actions.js')
const levelUtil = require('../../utils/level.js')
const toast = require('../../utils/toast.js')

// 教学指导以动作自带数据为主，未配置的动作回落到这里给出通用建议。
function defaultGuide() {
  return {
    tempo: '发力阶段平稳呼气，还原阶段控制 2 秒。',
    mistakes: ['为了完成次数而借力：降低重量或减少次数', '出现刺痛仍继续：立即停止并评估不适'],
    regression: '减轻重量、缩小动作幅度，优先保证动作稳定。',
    alternative: '可从同部位的相关动作中选择更舒适的替代方案。'
  }
}

Page({
  data: {
    view: null,
    related: []
  },

  onLoad(options) {
    const a = actionsData.getAction(options.id || '')
    if (!a) {
      toast.back('动作不存在', { delay: 800 })
      return
    }

    const related = actionsData.actions
      .filter(function (x) {
        return x.id !== a.id && x.category === a.category
      })
      .slice(0, 3)
      .map(function (x) {
        return {
          id: x.id,
          name: x.name,
          level: x.level,
          lvClass: levelUtil.tagClass(x.level)
        }
      })

    const guide = defaultGuide()
    this.setData({
      view: {
        id: a.id,
        name: a.name,
        category: a.category,
        equipment: a.equipment,
        level: a.level,
        lvClass: levelUtil.tagClass(a.level),
        muscles: (a.muscles || []).join(' · '),
        summary: a.summary,
        keys: a.keys || [],
        steps: a.steps || [],
        caution: a.caution || '',
        tempo: a.tempo || guide.tempo,
        mistakes: a.mistakes || guide.mistakes,
        regression: a.regression || guide.regression,
        alternative: a.alternative || guide.alternative
      },
      related: related
    })
  },

  goAction(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/tutorial-detail/tutorial-detail?id=' + id })
  }
})
