// utils/toast.js 页内像素提示（替代原生 wx.showToast，以使用像素字体）
// 用法：toast.show('已保存', { success: true })
const registry = []

function register(comp) {
  if (registry.indexOf(comp) < 0) registry.push(comp)
}

function unregister(comp) {
  const i = registry.indexOf(comp)
  if (i >= 0) registry.splice(i, 1)
}

// 取栈顶页面的组件实例，避免提示出现在非当前页
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
  // 当前页未挂载 px-toast 时退回原生提示
  wx.showToast({ title: text, icon: (opts && opts.success) ? 'success' : 'none' })
}

// 提示后延时返回上一页；若期间已跳转则不再返回，避免多退一层
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
