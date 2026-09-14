Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '主页', icon: 'home' },
      { pagePath: '/pages/library/library', text: '动作库', icon: 'dumbbell' },
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
