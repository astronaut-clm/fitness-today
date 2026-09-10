// components/px-toast/px-toast.js 页内像素提示
// 原生 wx.showToast 由微信客户端渲染，无法使用 wx.loadFontFace 注册的像素字体；
// 本组件由 utils/toast.js 统一驱动，在页内绘制以保证字体与整体一致。
const toast = require('../../utils/toast.js')

Component({
  data: {
    show: false,
    text: '',
    success: false
  },

  lifetimes: {
    attached() {
      // 记录所属页面，供 utils/toast.js 匹配栈顶页面，避免提示出现在非当前页
      const pages = getCurrentPages()
      this._page = pages[pages.length - 1]
      toast.register(this)
    },
    detached() {
      if (this._timer) clearTimeout(this._timer)
      toast.unregister(this)
    }
  },

  methods: {
    play(text, opts) {
      // 仅栈顶页面的实例响应，多页叠加时不会重复弹提示
      const pages = getCurrentPages()
      if (pages[pages.length - 1] !== this._page) return
      if (this._timer) clearTimeout(this._timer)
      this.setData({ show: true, text: text, success: !!(opts && opts.success) })
      const duration = (opts && opts.duration) || 1800
      this._timer = setTimeout(() => {
        this._timer = null
        this.setData({ show: false })
      }, duration)
    }
  }
})
