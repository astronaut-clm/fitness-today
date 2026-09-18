// 自定义计划编辑页：每个场景一份，从动作库挑动作、设组数次数
const actionsData = require('../../databases/actions.js')
const plansData = require('../../databases/plans.js')
const customPlans = require('../../utils/custom-plans.js')
const exerciseItem = require('../../utils/exercise-item.js')
const account = require('../../utils/account.js')
const nav = require('../../utils/nav.js')
const toast = require('../../utils/toast.js')
const fontBehavior = require('../../utils/font.js').behavior

const ALL_CATS = '全部' // 分类筛选里的「不筛选」项
const DEFAULT_SETS = 3 // 新增动作的默认组数
// 与计划列表页的分段选择同一份数据
const sceneTabs = plansData.scenes.map(function (scene) {
  return { value: scene.value, name: scene.name + '计划' }
})
const DEFAULT_SCENE = plansData.SCENES[0]

function toItem(action, sets, targetText) {
  return {
    actionId: action.id,
    name: action.name || action.id,
    category: action.category || '',
    equipment: action.equipment || '',
    level: action.level || plansData.LEVELS[0],
    sets: sets,
    targetText: targetText
  }
}

Page({
  behaviors: [fontBehavior],

  data: {
    sceneTabs: sceneTabs,
    scene: DEFAULT_SCENE,
    name: '',
    cats: [ALL_CATS].concat(actionsData.categories),
    cat: ALL_CATS,
    picker: [],
    selected: [],
    switchConfirm: false, // 切场景会丢弃未保存改动，先确认
    pendingScene: ''
  },

  onLoad(options) {
    if (!nav.requireLogin()) return
    const wanted = options && options.scene
    this.loadScene(plansData.SCENES.indexOf(wanted) >= 0 ? wanted : DEFAULT_SCENE)
  },

  loadScene(scene) {
    const existing = customPlans.get(scene)
    const selected = existing ? existing.exercises.map(function (ex) {
      const action = actionsData.getAction(ex.actionId) || { id: ex.actionId }
      return toItem(action, ex.sets, exerciseItem.of(ex).text)
    }) : []
    this.setData({
      scene: scene,
      name: existing ? existing.name : customPlans.defaultName(scene),
      selected: selected
    })
    this.buildPicker()
    this._dirty = false
  },

  // 任何编辑都打脏标记，切场景前据此判断要不要确认
  markDirty() {
    this._dirty = true
  },

  // 切分类时整表重建；勾选态变化只补丁单行，见 setChecked
  buildPicker() {
    const cat = this.data.cat
    const chosen = {}
    this.data.selected.forEach(function (item) { chosen[item.actionId] = true })
    const picker = actionsData.actions.filter(function (action) {
      return cat === ALL_CATS || action.category === cat
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

  // 只翻转这一行，避免为一次点击重建整张动作表
  setChecked(actionId, checked) {
    const index = this.data.picker.findIndex(function (row) { return row.id === actionId })
    if (index < 0) return
    this.setData({ ['picker[' + index + '].checked']: checked })
  },

  onScene(e) {
    const scene = e.currentTarget.dataset.scene
    if (scene === this.data.scene) return
    // 切场景会从存储重载，未保存的改动会丢，先确认
    if (this._dirty) {
      this.setData({ switchConfirm: true, pendingScene: scene })
      return
    }
    this.loadScene(scene)
  },

  onCancelSceneSwitch() {
    this.setData({ switchConfirm: false, pendingScene: '' })
  },

  onConfirmSceneSwitch() {
    const scene = this.data.pendingScene
    this.setData({ switchConfirm: false, pendingScene: '' })
    if (scene) this.loadScene(scene)
  },

  onName(e) {
    this.setData({ name: (e.detail && e.detail.value) || '' })
    this.markDirty()
  },

  onCat(e) {
    this.setData({ cat: e.currentTarget.dataset.cat })
    this.buildPicker()
  },

  onToggleAction(e) {
    const actionId = e.currentTarget.dataset.id
    const index = this.data.selected.findIndex(function (item) { return item.actionId === actionId })
    const selected = this.data.selected.slice()
    if (index >= 0) {
      selected.splice(index, 1)
    } else {
      const action = actionsData.getAction(actionId)
      if (!action) return
      selected.push(toItem(action, DEFAULT_SETS, exerciseItem.defaultText(action)))
    }
    this.setData({ selected: selected })
    this.setChecked(actionId, index < 0)
    this.markDirty()
  },

  onRemoveAction(e) {
    const index = Number(e.currentTarget.dataset.index)
    const selected = this.data.selected.slice()
    if (index < 0 || index >= selected.length) return
    const removed = selected.splice(index, 1)[0]
    this.setData({ selected: selected })
    this.setChecked(removed.actionId, false)
    this.markDirty()
  },

  onSets(e) {
    const index = Number(e.currentTarget.dataset.index)
    const delta = Number(e.currentTarget.dataset.delta || 0)
    const selected = this.data.selected.slice()
    const item = selected[index]
    if (!item || !delta) return
    const sets = exerciseItem.clampSets(Number(item.sets || 1) + delta)
    if (sets === item.sets) return
    selected[index] = Object.assign({}, item, { sets: sets })
    this.setData({ selected: selected })
    this.markDirty()
  },

  // 这里只收自由文案，保存时才解析成结构化目标
  onTarget(e) {
    const index = Number(e.currentTarget.dataset.index)
    const selected = this.data.selected.slice()
    if (!selected[index]) return
    selected[index] = Object.assign({}, selected[index], { targetText: (e.detail && e.detail.value) || '' })
    this.setData({ selected: selected })
    this.markDirty()
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
        return Object.assign({
          actionId: item.actionId,
          sets: item.sets
        }, exerciseItem.fromText(item.targetText))
      })
    })
    this._dirty = false
    if (!account.isLoggedIn()) {
      toast.back('计划已保存', { success: true })
      return
    }
    customPlans.pushToCloud().then(function (ok) {
      if (ok) toast.back('计划已保存', { success: true })
      else toast.back('已保存，云端同步失败')
    })
  }
})
