const profile = require('../../utils/profile.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')

Page({
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

  toggleValue(key, value) {
    const values = (this.current[key] || []).slice()
    const index = values.indexOf(value)
    if (index >= 0) values.splice(index, 1)
    else values.push(value)
    this.current[key] = values
    this.applyCurrent()
  },

  applyCurrent() {
    this.setData(profile.buildView(this.current))
  },

  onChooseGoal(e) {
    this.current.goal = e.currentTarget.dataset.value
    this.applyCurrent()
  },

  onToggleScene(e) { this.toggleValue('scenes', e.currentTarget.dataset.value) },
  onChooseExperience(e) {
    this.current.experience = e.currentTarget.dataset.value
    this.applyCurrent()
  },
  onToggleEquipment(e) { this.toggleValue('equipment', e.currentTarget.dataset.value) },

  onDaysChange(e) {
    this.current.weeklyTargetDays = Number(e.detail.value)
    this.setData({ weeklyTargetDays: this.current.weeklyTargetDays })
  },

  onWeekMinutesChange(e) {
    this.current.weeklyTargetMinutes = Number(e.detail.value)
    this.setData({ weeklyTargetMinutes: this.current.weeklyTargetMinutes })
  },

  onSave() {
    profile.save(this.current)
    // 已登录时同步云端，换设备可恢复。
    if (account.isLoggedIn()) profile.pushToCloud()
    toast.back('配置已保存', { success: true })
  }
})
