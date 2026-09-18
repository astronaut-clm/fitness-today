// 偏好表单共用交互：profile 与 onboarding 两页复用。
// 用法：Page(Object.assign({}, prefsForm, { ...页面自身配置 }))，页面需持有 this.current（当前偏好对象）。
const profile = require('../../utils/profile.js')

module.exports = {
  applyCurrent() {
    this.setData(profile.buildView(this.current))
  },

  toggleValue(key, value) {
    const values = (this.current[key] || []).slice()
    const index = values.indexOf(value)
    if (index >= 0) values.splice(index, 1)
    else values.push(value)
    this.current[key] = values
    this.applyCurrent()
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

  onMinutesChange(e) {
    this.current.weeklyTargetMinutes = Number(e.detail.value)
    this.setData({ weeklyTargetMinutes: this.current.weeklyTargetMinutes })
  }
}
