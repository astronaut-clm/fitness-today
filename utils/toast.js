// utils/toast.js 页内像素提示（替代原生 wx.showToast）
// 原生 wx.showToast 由微信客户端渲染，无法使用 wx.loadFontFace 注册的像素字体；
// 这里改为驱动页内 <px-toast> 组件绘制，保证字体与整体像素风一致。
// 用法：const toast = require('../../utils/toast.js'); toast.show('已保存', { success: true })
const registry = []

function register(comp) {
  if (registry.indexOf(comp) < 0) registry.push(comp)
}

function unregister(comp) {
  const i = registry.indexOf(comp)
  if (i >= 0) registry.splice(i, 1)
}

// 取当前栈顶页面挂载的组件实例，保证提示只出现在用户正在看的页面
function currentComponent() {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  for (let i = registry.length - 1; i >= 0; i--) {
    if (registry[i]._page === current) return registry[i]
  }
  return null
}

function show(text, opts) {
  const comp = currentComponent()
  if (comp) {
    comp.play(text, opts)
    return
  }
  // 兜底：当前页未挂载 <px-toast> 时退回原生提示，避免提示丢失
  wx.showToast({ title: text, icon: (opts && opts.success) ? 'success' : 'none' })
}

// 提示后延时返回上一页：仅当触发时仍停留在原页面才返回，
// 避免用户已手动返回/跳转后定时器再触发，导致多退一层。
function back(text, opts) {
  show(text, opts)
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  const delay = (opts && opts.delay) || 600
  setTimeout(function () {
    const now = getCurrentPages()
    if (now[now.length - 1] !== current) return
    wx.navigateBack({ fail: function () {} })
  }, delay)
}

module.exports = { register: register, unregister: unregister, show: show, back: back }
