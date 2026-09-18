// 动作详情页：步骤要点、常见错误、演示视频
const actionsData = require('../../databases/actions.js')
const config = require('../../utils/config.js')
const toast = require('../../utils/toast.js')
const fontBehavior = require('../../utils/font.js').behavior

// 动作演示视频地址：<ACTION_VIDEO_PREFIX><id>.mp4，前缀留空则返回 ''，页面不展示演示卡
function actionVideo(id) {
  if (!id || !config.ACTION_VIDEO_PREFIX) return ''
  return config.ACTION_VIDEO_PREFIX + id + '.mp4'
}

function defaultGuide() {
  return {
    tempo: '发力阶段平稳呼气，还原阶段控制 2 秒。',
    mistakes: ['为了完成次数而借力：降低重量或减少次数', '出现刺痛仍继续：立即停止并评估不适']
  }
}

Page({
  behaviors: [fontBehavior],

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
          level: x.level
        }
      })

    const guide = defaultGuide()
    // 演示动画：video 有值即展示 <video> 循环播放（见 wxml 的动作演示卡），为空则整卡不渲染
    const videoUrl = actionVideo(a.id)
    this.setData({
      view: {
        id: a.id,
        name: a.name,
        video: videoUrl,
        category: a.category,
        equipment: a.equipment,
        level: a.level,
        muscles: (a.muscles || []).join(' · '),
        steps: a.steps || [],
        caution: a.caution || '',
        tempo: a.tempo || guide.tempo,
        mistakes: a.mistakes || guide.mistakes
      },
      related: related
    })
  },

  onVideoError() {
    // 视频加载失败：清空 video，wxml 据此隐藏演示卡，避免露出破图
    this.setData({ 'view.video': '' })
  },

  goAction(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/tutorial-detail/tutorial-detail?id=' + id })
  },

  onShareAppMessage() {
    const view = this.data.view
    if (!view) return { title: '动作要领一看就会', path: '/pages/index/index' }
    return {
      title: view.name + '：' + view.category + '动作要领',
      path: '/pages/tutorial-detail/tutorial-detail?id=' + view.id
    }
  },

  onShareTimeline() {
    const view = this.data.view
    if (!view) return { title: '动作要领一看就会' }
    return {
      title: view.name + '：' + view.category + '动作要领',
      query: 'id=' + view.id
    }
  }
})
