// 自定义 tabBar 选中态同步：tab 页在 onShow 中调用。
// （custom-tab-bar 的 pageLifetimes.show 不会被触发，只能由页面侧写入）
function sync(page, index) {
  if (typeof page.getTabBar !== 'function') return
  const tabBar = page.getTabBar()
  if (tabBar && tabBar.setData) tabBar.setData({ selected: index })
}

module.exports = { sync: sync }
