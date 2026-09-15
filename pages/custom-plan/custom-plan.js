const actionsData = require('../../data/actions.js')
const customPlans = require('../../utils/custom-plans.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')

// 新加入动作的默认目标：时长类动作给秒数，其余给次数。
function defaultReps(action) {
  if (!action) return '12次'
  if (action.category === '有氧') return '30秒'
  if (action.id === 'plank' || action.id === 'wall_sit') return '30秒'
  return '12次'
}

Page({
  data: {
    scene: 'home',
    name: '',
    cats: ['全部'].concat(actionsData.categories),
    cat: '全部',
    picker: [],
    selected: [],
    hasSaved: false,
    showDeleteConfirm: false
  },

  onLoad(options) {
    const scene = options && options.scene === 'gym' ? 'gym' : 'home'
    this.loadScene(scene)
  },

  loadScene(scene) {
    const existing = customPlans.get(scene)
    const selected = existing ? existing.exercises.map(function (ex) {
      const action = actionsData.getAction(ex.actionId) || {}
      return {
        actionId: ex.actionId,
        name: action.name || ex.actionId,
        category: action.category || '',
        equipment: action.equipment || '',
        level: action.level || '初级',
        sets: ex.sets,
        reps: ex.reps
      }
    }) : []
  this.setData({
      scene: scene,
      name: existing ? existing.name : customPlans.defaultName(scene),
      selected: selected,
      hasSaved: !!existing,
      showDeleteConfirm: false
    })
    this.buildPicker()
  },

  buildPicker() {
    const cat = this.data.cat
    const chosen = {}
    this.data.selected.forEach(function (item) { chosen[item.actionId] = true })
    const picker = actionsData.actions.filter(function (action) {
      return cat === '全部' || action.category === cat
    }).map(function (action) {
      return {
        id: action.id,
        name: action.name,
        category: action.category,
        equipment: action.equipment,
        level: action.level,
        muscles: (action.muscles || []).join(' · '),
        checked: !!chosen[action.id]
      }
    })
    this.setData({ picker: picker })
  },

  onScene(e) {
    const scene = e.currentTarget.dataset.scene
    if (scene === this.data.scene) return
    this.loadScene(scene)
  },

  onName(e) {
    this.setData({ name: (e.detail && e.detail.value) || '' })
  },

  onCat(e) {
    this.setData({ cat: e.currentTarget.dataset.cat })
    this.buildPicker()
  },

  // 点击动作库条目：未选加入，已选移除
  onToggleAction(e) {
    const actionId = e.currentTarget.dataset.id
    const index = this.data.selected.map(function (item) { return item.actionId }).indexOf(actionId)
    if (index >= 0) {
      const selected = this.data.selected.slice()
      selected.splice(index, 1)
      this.setData({ selected: selected })
    } else {
      const action = actionsData.getAction(actionId)
      const selected = this.data.selected.concat([{
        actionId: actionId,
        name: action.name,
        category: action.category,
        equipment: action.equipment,
        level: action.level,
        sets: 3,
        reps: defaultReps(action)
      }])
      this.setData({ selected: selected })
    }
    this.buildPicker()
  },

  onRemoveAction(e) {
    const index = Number(e.currentTarget.dataset.index)
    const selected = this.data.selected.slice()
    if (index < 0 || index >= selected.length) return
    selected.splice(index, 1)
    this.setData({ selected: selected })
    this.buildPicker()
  },

  onSets(e) {
    const index = Number(e.currentTarget.dataset.index)
    const delta = Number(e.currentTarget.dataset.delta || 0)
    const selected = this.data.selected.slice()
    const item = selected[index]
    if (!item || !delta) return
    const sets = Math.max(1, Math.min(9, Number(item.sets || 1) + delta))
    if (sets === item.sets) return
    selected[index] = Object.assign({}, item, { sets: sets })
    this.setData({ selected: selected })
  },

  onReps(e) {
    const index = Number(e.currentTarget.dataset.index)
    const selected = this.data.selected.slice()
    if (!selected[index]) return
    selected[index] = Object.assign({}, selected[index], { reps: (e.detail && e.detail.value) || '' })
    this.setData({ selected: selected })
  },

  onSave() {
    if (!this.data.selected.length) {
      toast.show('请至少添加一个动作')
      return
    }
    const scene = this.data.scene
    const name = (this.data.name || '').trim() || customPlans.defaultName(scene)
    customPlans.save(scene, {
      name: name,
      exercises: this.data.selected.map(function (item) {
        return { actionId: item.actionId, sets: item.sets, reps: item.reps }
      })
    })
    if (account.isLoggedIn()) customPlans.pushToCloud()
    toast.back('计划已保存', { success: true })
  },

  onDelete() {
    this.setData({ showDeleteConfirm: true })
  },

  onCancelDelete() {
    this.setData({ showDeleteConfirm: false })
  },

  onConfirmDelete() {
    customPlans.remove(this.data.scene)
    // 已登录时同步云端删除结果，避免换设备后旧计划被拉回。
    if (account.isLoggedIn()) customPlans.pushToCloud()
    this.setData({ showDeleteConfirm: false })
    toast.back('自定义计划已删除')
  },

  noop() {}
})
