// 动作库列表页：按部位/器械筛选与搜索
const actionsData = require('../../databases/actions.js')
const nav = require('../../utils/nav.js')
const fontBehavior = require('../../utils/font.js').behavior

// 视图字段与搜索文本预算一次，避免每次筛选重复 join
const ACTIONS = actionsData.actions.map(function (a) {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    equipment: a.equipment,
    level: a.level,
    muscles: (a.muscles || []).join(' · '),
    key: a.steps && a.steps[0] ? a.steps[0].key : '',
    searchText: (a.name + a.category + a.equipment + (a.muscles || []).join('')).toLowerCase()
  }
})

Page({
  behaviors: [fontBehavior],

  data: {
    cats: ['全部'].concat(actionsData.categories),
    cat: '全部',
    keyword: '',
    list: []
  },

  onLoad() {
    // 门禁必须在 onLoad：「恢复上次退出页」会直接打开本页，放 onShow 会先渲染完整列表再被踢走
    if (!nav.requireLogin()) return
    this.applyFilter()
  },

  onShow() {
    nav.enter(this, nav.TAB.library)
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer)
  },

  onCatTap(e) {
    this.setData({ cat: e.currentTarget.dataset.cat })
    this.applyFilter()
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => this.applyFilter(), 200)
  },

  onClearSearch() {
    this.setData({ keyword: '' })
    this.applyFilter()
  },

  applyFilter() {
    const cat = this.data.cat
    const kw = this.data.keyword.trim().toLowerCase()
    const list = []
    ACTIONS.forEach(function (a) {
      if (cat !== '全部' && a.category !== cat) return
      if (kw && a.searchText.indexOf(kw) < 0) return
      list.push({
        id: a.id,
        name: a.name,
        category: a.category,
        equipment: a.equipment,
        level: a.level,
        muscles: a.muscles,
        key: a.key
      })
    })
    this.setData({ list: list })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/tutorial-detail/tutorial-detail?id=' + id })
  }
})
