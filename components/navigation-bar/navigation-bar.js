// 自定义导航栏：返回箭头 + 标题，文字/背景色由页面传参
Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    background: {
      type: String,
      value: '',
      observer: '_refreshStyle'
    },
    color: {
      type: String,
      value: '',
      observer: '_refreshStyle'
    },
    back: {
      type: Boolean,
      value: true
    }
  },
  data: {
    ios: false,
    // 内联样式统一由 JS 拼装，避免 WXML 插值产生空声明告警
    navStyle: '',
    leftStyle: ''
  },
  lifetimes: {
    attached() {
      const rect = wx.getMenuButtonBoundingClientRect()
      const platform = wx.getDeviceInfo().platform
      const winInfo = wx.getWindowInfo()
      // safeArea 可能缺失，兜底空对象避免解构报错
      const safeArea = winInfo.safeArea || {}
      const left = winInfo.windowWidth - rect.left
      this._geo = {
        left: left,
        top: Number(safeArea.top) || 0,
        needTopArea: platform === 'devtools' || platform === 'android'
      }
      this.setData({
        ios: platform !== 'android',
        leftStyle: 'width: ' + left + 'px'
      })
      this._refreshStyle()
    }
  },
  methods: {
    _refreshStyle() {
      const geo = this._geo
      if (!geo) return // observer 可能早于 attached，几何就绪后再渲染
      const { color = '', background = '' } = this.data
      let s = `color:${color || 'var(--weui-FG-0)'};background:${background || 'transparent'};`
      s += `padding-right:${geo.left}px;`
      if (geo.needTopArea) {
        s += `height:calc(var(--height) + ${geo.top}px);padding-top:${geo.top}px;`
      }
      if (s !== this.data.navStyle) this.setData({ navStyle: s })
    },

    back() {
      wx.navigateBack()
    }
  }
})
