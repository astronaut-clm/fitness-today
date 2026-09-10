// custom-tab-bar/index.js —— 8-bit NES 像素风自定义 tabBar
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '主页', icon: 'home' },
      { pagePath: '/pages/checkin/checkin', text: '我的', icon: 'user' }
    ]
  },

  methods: {
    switchTab(e) {
      const url = this.data.list[e.currentTarget.dataset.index].pagePath
      wx.switchTab({ url: url })
    }
  }
})
