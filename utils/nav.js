// tabBar 相关：tab 清单、选中态与显隐同步、未登录时的门禁。tab 页在 onShow 中调用。
// selected / hidden 一律由页面主动写入：tabBar 组件无法可靠感知「当前是哪个 tab 页」，
// 指望它自己更新会出现选中态滞后或错页
const account = require('./account.js')

// tab 清单：custom-tab-bar 直接渲染这一份，页面用 TAB.xxx 取自己的下标，
// 不再在组件里抄一遍路径与文案、在页面里写 0/1/2 这种魔法数字。
// app.json 的 tabBar.list 是平台强制要的另一份（不支持 icon 字段），改动时两处都要动
const TABS = [
  { pagePath: '/pages/index/index', text: '主页', icon: 'home' },
  { pagePath: '/pages/library/library', text: '动作库', icon: 'dumbbell' },
  { pagePath: '/pages/checkin/checkin', text: '我的', icon: 'user' }
]

const TAB = { index: 0, library: 1, checkin: 2 }

// 顺带同步显隐：未登录整条 tabBar 不渲染（为什么不用 wx.hideTabBar 见 custom-tab-bar/index.js）
function sync(page, index) {
  if (typeof page.getTabBar !== 'function') return
  const tabBar = page.getTabBar()
  if (tabBar && tabBar.setData) tabBar.setData({ selected: index, hidden: !account.isLoggedIn() })
}

// 供非 tab 页（plan / custom-plan / workout）在 onLoad/onShow 开头调用，返回 false 表示不该继续渲染；
// tabBar 已隐藏还要这道门，是因为页面仍可能被直接打开：分享路径、小程序恢复到上次退出的页面、开发者工具
function requireLogin() {
  if (account.isLoggedIn()) return true
  wx.switchTab({ url: '/pages/index/index', fail: function () {} })
  return false
}

// tab 页统一入口：先过登录门禁，再同步 tabBar。
// 返回 false 表示未登录，调用方应立即 return；此时不动 tabBar，保持上一次的状态
function enter(page, index) {
  if (!requireLogin()) return false
  sync(page, index)
  return true
}

// 页面是否仍在栈顶。异步回调返回时常常已经跳走（switchTab / navigateBack），
// 此时再 setData 会写到已离开的页面上：控制台告警，还白算一轮
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
