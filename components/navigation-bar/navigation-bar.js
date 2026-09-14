Component({
  options: {
    multipleSlots: true
  },
  properties: {
    extClass: {
      type: String,
      value: ''
    },
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
    },
    loading: {
      type: Boolean,
      value: false
    },
    homeButton: {
      type: Boolean,
      value: false,
    },
    animated: {
      type: Boolean,
      value: true,
      observer: '_refreshStyle'
    },
    show: {
      // 隐藏时仍占位
      type: Boolean,
      value: true,
      observer: '_refreshStyle'
    },
    delta: {
      type: Number,
      value: 1
    },
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
      const devInfo = wx.getDeviceInfo()
      const platform = devInfo.platform
      const isAndroid = platform === 'android'
      const isDevtools = platform === 'devtools'
      const winInfo = wx.getWindowInfo()
      // safeArea 可能缺失，兜底空对象避免解构报错
      const safeArea = winInfo.safeArea || {}
      const windowWidth = winInfo.windowWidth
      const top = Number(safeArea.top) || 0
      const left = windowWidth - rect.left
      this._geo = { left, top, needTopArea: isDevtools || isAndroid }
      this.setData({
        ios: !isAndroid,
        leftStyle: `width: ${left}px`
      })
      this._refreshStyle()
    },
  },
  methods: {
    _refreshStyle() {
      const geo = this._geo
      if (!geo) return // observer 可能早于 attached，几何就绪后再渲染
      const { color = '', background = '', show = true, animated = true } = this.data
      let s = `color:${color || 'var(--weui-FG-0)'};background:${background || 'transparent'};`
      s += `padding-right:${geo.left}px;`
      if (geo.needTopArea) {
        s += `height:calc(var(--height) + ${geo.top}px);padding-top:${geo.top}px;`
      }
      if (animated) {
        s += `opacity:${show ? '1' : '0'};transition:opacity 0.5s;`
      } else if (!show) {
        s += 'display:none;'
      }
      if (s !== this.data.navStyle) this.setData({ navStyle: s })
    },
    back() {
      const data = this.data
      if (data.delta) {
        wx.navigateBack({
          delta: data.delta
        })
      }
      this.triggerEvent('back', { delta: data.delta }, {})
    },

    // switchTab 会清除非 tabBar 页栈
    home() {
      wx.switchTab({
        url: '/pages/index/index'
      })
      this.triggerEvent('home', {}, {})
    }
  },
})
