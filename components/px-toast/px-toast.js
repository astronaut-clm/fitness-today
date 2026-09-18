// 页内提示，由 utils/toast.js 驱动
const toast = require('../../utils/toast.js')

Component({
  data: {
    show: false,
    text: '',
    success: false
  },

  lifetimes: {
    attached() {
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
    // toast.js 只挑栈顶页的实例来调，这里不用再判断
    play(text, opts) {
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
