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
      // 显示隐藏的时候opacity动画效果
      type: Boolean,
      value: true,
      observer: '_refreshStyle'
    },
    show: {
      // 显示隐藏导航，隐藏的时候navigation-bar的高度占位还在
      type: Boolean,
      value: true,
      observer: '_refreshStyle'
    },
    // back为true的时候，返回的页面深度
    delta: {
      type: Number,
      value: 1
    },
  },
  data: {
    ios: false,
    // 完整内联样式由 JS 统一拼装，避免 WXML 内多段插值产生空声明/解析告警
    navStyle: '',
    leftStyle: ''
  },
  lifetimes: {
    attached() {
      const rect = wx.getMenuButtonBoundingClientRect()
      // 新 API 在老基础库中不存在，需先判断再调用，直接调用会抛错而非返回 undefined
      const devInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
      const platform = devInfo.platform
      const isAndroid = platform === 'android'
      const isDevtools = platform === 'devtools'
      const winInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      // safeArea 在个别环境下可能缺失或为 null，兜底为空对象避免解构报错
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
    // 依据属性与胶囊按钮几何信息拼装导航栏完整内联样式
    _refreshStyle() {
      const geo = this._geo
      if (!geo) return // 属性 observer 可能早于 attached 触发，几何信息就绪后再渲染
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

    // 返回首页（switchTab 会清掉非 tabBar 页面栈）
    home() {
      wx.switchTab({
        url: '/pages/index/index'
      })
      this.triggerEvent('home', {}, {})
    }
  },
})
