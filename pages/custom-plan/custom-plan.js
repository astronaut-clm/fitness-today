const actionsData = require('../../data/actions.js')
const customPlans = require('../../utils/custom-plans.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')

// 新加入动作的默认目标：时长类动作给秒数，其余给次数。
function defaultReps(action) {
  if (!action) return customPlans.DEFAULT_REPS
  if (action.category === '有氧') return '30秒'
  if (action.id === 'plank' || action.id === 'wall_sit') return '30秒'
  return customPlans.DEFAULT_REPS
}

// 动作 → 已选条目（加载已有计划与点选新动作共用）
function toItem(action, sets, reps) {
  return {
    actionId: action.id,
    name: action.name || action.id,
    category: action.category || '',
    equipment: action.equipment || '',
    level: action.level || '初级',
    sets: sets,
    reps: reps
  }
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
      return toItem(actionsData.getAction(ex.actionId) || { id: ex.actionId }, ex.sets, ex.reps)
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
      const selected = this.data.selected.concat([toItem(action, 3, defaultReps(action))])
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
    const sets = customPlans.clampSets(Number(item.sets || 1) + delta)
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
      toast.show('请添加动作')
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
    if (!account.isLoggedIn()) {
      toast.back('计划已保存', { success: true })
      return
    }
    customPlans.pushToCloud().then(function (ok) {
      if (ok) toast.back('计划已保存', { success: true })
      else toast.back('已保存，云端同步失败')
    })
  },

  onDelete() {
    this.setData({ showDeleteConfirm: true })
  },

  onCancelDelete() {
    this.setData({ showDeleteConfirm: false })
  },

  onConfirmDelete() {
    this.setData({ showDeleteConfirm: false })
    customPlans.removeAndSync(this.data.scene).then(function (synced) {
      if (synced) toast.back('计划已删除', { success: true })
      else toast.back('已删除，云端同步失败')
    })
  }
})
