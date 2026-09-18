// 返回箭头 + 标题。全站配色一致（黑字白底），故不做成属性
const device = require('../../utils/device.js')

Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    back: {
      type: Boolean,
      value: true
    }
  },
  data: {
    ios: false,
    // 由 JS 拼好再传，避免 WXML 插值产生空声明告警
    navStyle: '',
    leftStyle: ''
  },
  lifetimes: {
    attached() {
      const rect = device.menuButtonRect()
      const platform = device.deviceInfo().platform
      const winInfo = device.windowInfo()
      // safeArea 可能缺失
      const safeArea = winInfo.safeArea || {}
      // 胶囊左边界到屏幕右侧的距离；左右各留这么宽，标题才在视觉中间
      const left = Math.max(0, (Number(winInfo.windowWidth) || 0) - (Number(rect.left) || 0))
      let navStyle = 'color:#1a1a1a;background:#ffffff;padding-right:' + left + 'px;'
      // 安卓与开发者工具不会自动避开状态栏
      if (platform === 'devtools' || platform === 'android') {
        const top = Number(safeArea.top) || 0
        navStyle += 'height:calc(var(--height) + ' + top + 'px);padding-top:' + top + 'px;'
      }
      this.setData({
        ios: platform !== 'android',
        leftStyle: 'width: ' + left + 'px',
        navStyle: navStyle
      })
    }
  },
  methods: {
    back() {
      wx.navigateBack()
    }
  }
})
