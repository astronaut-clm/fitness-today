// 页内提示，替代 wx.showToast 以便统一文案样式
const registry = []

function register(comp) {
  if (registry.indexOf(comp) < 0) registry.push(comp)
}

function unregister(comp) {
  const i = registry.indexOf(comp)
  if (i >= 0) registry.splice(i, 1)
}

// 只取栈顶页的实例，避免提示出现在非当前页
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
  // 当前页没挂 px-toast 就退回原生
  wx.showToast({ title: text, icon: (opts && opts.success) ? 'success' : 'none' })
}

// 提示后延时返回上一页；期间已跳走就不再返回，避免多退一层
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
