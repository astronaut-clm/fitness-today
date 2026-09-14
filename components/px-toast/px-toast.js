// components/px-toast 页内像素提示（由 utils/toast.js 驱动，以支持像素字体）
const toast = require('../../utils/toast.js')

Component({
  data: {
    show: false,
    text: '',
    success: false
  },

  lifetimes: {
    attached() {
      // 记录所属页面，供 toast 匹配栈顶页
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
      // 仅栈顶页实例响应，避免多页重复弹提示
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
