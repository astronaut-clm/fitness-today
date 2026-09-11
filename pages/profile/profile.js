// pages/profile/profile.js
const profile = require('../../utils/profile.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')

const goals = [
  { value: 'fat_loss', name: '减脂塑形', desc: '优先安排轻量高效训练' },
  { value: 'muscle_gain', name: '增肌增重', desc: '优先安排力量训练' }
]
const scenes = [
  { value: 'home', name: '居家' },
  { value: 'gym', name: '健身房' }
]
const experiences = ['初级', '中级', '高级']
const equipment = [
  { value: 'none', name: '徒手' },
  { value: 'dumbbell', name: '哑铃' },
  { value: 'gym', name: '健身房器械' }
]

function selectedMap(values) {
  const map = {}
  ;(values || []).forEach(function (value) { map[value] = true })
  return map
}

function withSelected(list, values) {
  const selected = selectedMap(values)
  return list.map(function (item) {
    return Object.assign({}, item, { selected: !!selected[item.value] })
  })
}

Page({
  data: {
    goals: goals,
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
    const current = profile.get()
    this.current = current
    this.setData({
      goals: goals.map(function (item) { return Object.assign({}, item, { selected: current.goal === item.value }) }),
      scenes: withSelected(scenes, current.scenes),
      experiences: experiences.map(function (name) { return { name: name, selected: name === current.experience } }),
      equipment: withSelected(equipment, current.equipment),
      weeklyTargetDays: current.weeklyTargetDays,
      weeklyTargetMinutes: current.weeklyTargetMinutes
    })
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
    this.setData({
      goals: goals.map((item) => Object.assign({}, item, { selected: this.current.goal === item.value })),
      scenes: withSelected(scenes, this.current.scenes),
      experiences: experiences.map((name) => ({ name: name, selected: name === this.current.experience })),
      equipment: withSelected(equipment, this.current.equipment),
      weeklyTargetDays: this.current.weeklyTargetDays,
      weeklyTargetMinutes: this.current.weeklyTargetMinutes
    })
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
