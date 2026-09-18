// 底部导航。未登录时整条不渲染，新用户只看到首页的登录入口。
// wx.hideTabBar / showTabBar 对自定义 tabBar 不管用（藏不掉，再 show 还会多出一条），
// 所以可见性由自己用 wx:if 控制：data 取启动时的登录态 → attached 再读一次 → 切页时由 nav.sync 更新。
// tab 清单来自 utils/nav.js，页面的选中态下标与这里的渲染顺序天然一致
const account = require('../utils/account.js')
const font = require('../utils/font.js')
const nav = require('../utils/nav.js')

Component({
  data: {
    hidden: !account.isLoggedIn(),
    selected: 0,
    // 不在 page-meta 作用域内，得自己跟随字体开关
    fontStyle: font.pageStyle(),
    list: nav.TABS
  },

  attached() {
    this.setData({ hidden: !account.isLoggedIn(), fontStyle: font.pageStyle() })
  },

  pageLifetimes: {
    show() {
      this.setData({ fontStyle: font.pageStyle() })
    }
  },

  methods: {
    switchTab(e) {
      const item = this.data.list[Number(e.currentTarget.dataset.index)]
      // 越界时静默返回，别让 TypeError 打断 tabBar 交互
      if (!item) return
      wx.switchTab({
        url: item.pagePath,
        fail: function (err) { console.warn('[tabbar] switchTab failed', item.pagePath, err) }
      })
    }
  }
})
