// tab 清单、选中态与显隐同步、未登录门禁。tab 页在 onShow 里调用。
// selected / hidden 一律由页面主动写入——组件自己感知不到「当前是哪个 tab 页」，
// 指望它更新会出现选中态滞后或错页
const account = require('./account.js')

// custom-tab-bar 直接渲染这一份，页面用 TAB.xxx 取下标，不写 0/1/2 魔法数字。
// app.json 的 tabBar.list 是平台强制要的另一份（不支持 icon），改动时两处都要动
const TABS = [
  { pagePath: '/pages/index/index', text: '主页', icon: 'home' },
  { pagePath: '/pages/library/library', text: '动作库', icon: 'dumbbell' },
  { pagePath: '/pages/checkin/checkin', text: '我的', icon: 'user' }
]

const TAB = { index: 0, library: 1, checkin: 2 }

// 顺带同步显隐：未登录整条不渲染（不用 wx.hideTabBar 的原因见 custom-tab-bar/index.js）
function sync(page, index) {
  if (typeof page.getTabBar !== 'function') return
  const tabBar = page.getTabBar()
  if (tabBar && tabBar.setData) tabBar.setData({ selected: index, hidden: !account.isLoggedIn() })
}

// 非 tab 页在 onLoad/onShow 开头调用，返回 false 表示不该继续渲染。
// tabBar 已隐藏还要这道门：分享路径、恢复上次退出页、开发者工具都能直接打开页面
function requireLogin() {
  if (account.isLoggedIn()) return true
  wx.switchTab({ url: '/pages/index/index', fail: function () { wx.reLaunch({ url: '/pages/index/index' }) } })
  return false
}

// tab 页入口：先过门禁再同步。返回 false 时调用方应立即 return，此时不动 tabBar
function enter(page, index) {
  if (!requireLogin()) return false
  sync(page, index)
  return true
}

// 是否仍在栈顶。异步回调返回时常常已经跳走，此时 setData 会写到已离开的页面上
function alive(page) {
  try {
    const pages = getCurrentPages()
    return pages.length > 0 && pages[pages.length - 1] === page
  } catch (e) {
    return true
  }
}

module.exports = {
  TABS: TABS,
  TAB: TAB,
  sync: sync,
  enter: enter,
  requireLogin: requireLogin,
  alive: alive
}
