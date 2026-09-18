// 动作详情页：步骤要点、常见错误、演示视频
const actionsData = require('../../databases/actions.js')
const videoCache = require('../../utils/video-cache.js')
const toast = require('../../utils/toast.js')

function defaultGuide() {
  return {
    tempo: '发力阶段平稳呼气，还原阶段控制 2 秒。',
    mistakes: ['为了完成次数而借力：降低重量或减少次数', '出现刺痛仍继续：立即停止并评估不适']
  }
}

Page({
  data: {
    view: null,
    videoSrc: '',
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
          level: x.level
        }
      })

    const guide = defaultGuide()
    this.setData({
      view: {
        id: a.id,
        name: a.name,
        video: videoCache.urlOf(a.id),
        category: a.category,
        equipment: a.equipment,
        level: a.level,
        muscles: (a.muscles || []).join(' · '),
        steps: a.steps || [],
        caution: a.caution || '',
        tempo: a.tempo || guide.tempo,
        mistakes: a.mistakes || guide.mistakes
      },
      videoSrc: videoCache.peek(a.id),
      related: related
    })

    // 拿到本地路径才渲染 <video>：等待期间显示占位，避免原生黑底
    const id = a.id
    videoCache.resolveById(id).then((src) => {
      if (!src || this._unloaded) return
      this.setData({ videoSrc: src })
    })
  },

  onUnload() {
    this._unloaded = true
  },

  onVideoError() {
    // 清空 video，wxml 据此隐藏演示卡，避免露出破图
    this.setData({ 'view.video': '' })
  },

  goAction(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    videoCache.prefetch(id)
    wx.navigateTo({ url: '/pages/tutorial-detail/tutorial-detail?id=' + id })
  },

  // 分享只在主页开放：本页不声明 onShareAppMessage/OnShareTimeline，右上角转发入口自动不出现
})
