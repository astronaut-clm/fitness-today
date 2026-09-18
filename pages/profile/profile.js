// 训练偏好设置（目标/场景/经验/器械/周目标），表单交互复用 components/prefs-form
const profile = require('../../utils/profile.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')
const prefsForm = require('../../components/prefs-form/prefs-form.js')

Page(Object.assign({}, prefsForm, {
  data: {
    goals: [],
    scenes: [],
    experiences: [],
    equipment: [],
    weeklyTargetDays: profile.DEFAULT_WEEKLY_TARGET.days,
    weeklyTargetMinutes: profile.DEFAULT_WEEKLY_TARGET.minutes
  },

  onLoad() {
    this.loadProfile()
    if (account.isLoggedIn()) {
      profile.syncFromCloud().then((res) => {
        if (res && res.ok && res.changed) this.loadProfile()
      })
    }
  },

  loadProfile() {
    this.current = profile.get()
    this.applyCurrent()
  },

  onSave() {
    profile.save(this.current)
    toast.back('偏好已保存', { success: true })
    // 必须接住 pushToCloud，否则会出现「提示已保存、云端没写进去」。
    // 这里用原生 toast：toast.back 已经离开本页，组件级 toast 随页面一起销毁了
    if (account.isLoggedIn()) {
      const fallback = () => wx.showToast({ title: '云端同步失败，已存到本机', icon: 'none' })
      profile.pushToCloud().then((ok) => {
        if (!ok) fallback()
      }).catch(fallback)
    }
  }
}))
