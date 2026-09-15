const profile = require('../../utils/profile.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')
const prefsForm = require('../../utils/prefs-form.js')

Page(Object.assign({}, prefsForm, {
  data: {
    goals: [],
    scenes: [],
    experiences: [],
    equipment: [],
    weeklyTargetDays: 3,
    weeklyTargetMinutes: 90
  },

  onLoad() {
    this.loadProfile()
    // 已登录：先与云端收敛一次偏好，换机 / 他端改过时自动拉取并刷新表单。
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
    // 已登录时同步云端，换设备可恢复。
    if (account.isLoggedIn()) profile.pushToCloud()
    toast.back('偏好已保存', { success: true })
  }
}))
