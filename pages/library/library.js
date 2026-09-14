const actionsData = require('../../data/actions.js')
const levelUtil = require('../../utils/level.js')

Page({
  data: {
    cats: ['全部'].concat(actionsData.categories),
    cat: '全部',
    keyword: '',
    list: []
  },

  onLoad() {
    this.compute()
  },

  onShow() {
    // 自定义 tabBar 选中态：动作库为第 2 个 tab（index 1）
    if (typeof this.getTabBar === 'function') {
      const tabBar = this.getTabBar()
      if (tabBar && tabBar.setData) tabBar.setData({ selected: 1 })
    }
  },

  onCatTap(e) {
    const cat = e.currentTarget.dataset.cat
    this.setData({ cat: cat })
    this.compute()
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.compute()
  },

  onClearSearch() {
    this.setData({ keyword: '' })
    this.compute()
  },

  compute() {
    const cat = this.data.cat
    const kw = this.data.keyword.trim().toLowerCase()

    const list = actionsData.actions.filter(function (a) {
      if (cat !== '全部' && a.category !== cat) return false
      if (!kw) return true
      const text = (a.name + a.category + a.equipment + (a.muscles || []).join('')).toLowerCase()
      return text.indexOf(kw) > -1
    }).map(function (a) {
      return {
        id: a.id,
        name: a.name,
        category: a.category,
        equipment: a.equipment,
        level: a.level,
        lvClass: levelUtil.tagClass(a.level),
        muscles: (a.muscles || []).join(' · '),
        key: a.steps && a.steps[0] ? a.steps[0].key : ''
      }
    })

    this.setData({ list: list })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/tutorial-detail/tutorial-detail?id=' + id })
  }
})
