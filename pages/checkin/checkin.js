// pages/checkin/checkin.js
const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const profile = require('../../utils/profile.js')
const account = require('../../utils/account.js')
const login = require('../../utils/login.js')
const toast = require('../../utils/toast.js')

function recordView(record) {
  const time = new Date(record.createdAt)
  return {
    id: record.id,
    planName: record.planName,
    sceneName: record.sceneName,
    timeText: dateUtil.pad(time.getHours()) + ':' + dateUtil.pad(time.getMinutes()),
    detailText: '实际训练 ' + record.actualMinutes + ' 分钟',
    skippedText: record.skippedGroups ? '跳过 ' + record.skippedGroups + ' 组' : ''
  }
}

Page({
  data: {
    accountInfo: { nickname: '', avatar: '', char: '练' },
    todayStr: '',
    stats: { total: 0, streak: 0, monthCount: 0, monthMinutes: 0 },
    year: 0,
    month: 0,
    monthLabel: '',
    canNext: false,
    weekHead: dateUtil.WEEK_HEAD_LABELS,
    weeks: [],
    selected: '',
    selectedLabel: '',
    selectedRecords: [],
    // 删除记录确认弹层
    deleteConfirm: { show: false, id: '', name: '' }
  },

  onLoad() {
    const now = new Date()
    this.setData({
      todayStr: dateUtil.today(),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      selected: dateUtil.today()
    })
  },

  onShow() {
    // 自定义 tabBar 选中态（WebView 下 getTabBar 同步返回实例）
    if (typeof this.getTabBar === 'function') {
      const tabBar = this.getTabBar()
      if (tabBar && tabBar.setData) tabBar.setData({ selected: 2 })
    }
    this.reload()
    this.pullCloud()
    this.refreshAccount()
    this.syncPrefs()
  },

  refreshAccount() {
    // 登录态以「是否完成过登录」为准，未登录一律显示登录卡片
    if (!account.isLoggedIn()) {
      this.setData({ accountInfo: { nickname: '', avatar: '', char: '练' } })
      return
    }
    this.renderAccount(account.get())
    // 云端资料 15 秒内只拉一次，失败允许下次重试
    const now = Date.now()
    if (this._lastProfileFetchAt && now - this._lastProfileFetchAt < 15000) return
    this._lastProfileFetchAt = now
    account.fetchProfile().then((res) => {
      if (res && res.ok) this.renderAccount(res)
      // 账号已不存在：清理本地数据并切回未登录视图
      if (res && res.code === 'no_account') {
        login.resetLocalData()
        this.setData({ accountInfo: { nickname: '', avatar: '', char: '练' } })
        this.reload()
        return
      }
      if (!res || !res.ok) this._lastProfileFetchAt = 0
    })
  },

  // 头像存的是 cloud:// 文件 ID，统一换临时 https 链接再渲染，换不到则回退文字头像
  renderAccount(src) {
    const nickname = (src && src.nickname) || ''
    const fileID = (src && src.avatar) || ''
    const seq = (this._avatarSeq || 0) + 1
    this._avatarSeq = seq
    this.setData({
      accountInfo: { nickname: nickname, avatar: '', char: nickname ? nickname.slice(0, 1) : '练' }
    })
    if (!fileID) return
    account.resolveAvatar(fileID).then((url) => {
      // 换链期间资料可能已更新，丢弃过期结果
      if (!url || seq !== this._avatarSeq) return
      this.setData({ 'accountInfo.avatar': url })
    }).catch(() => {})
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' })
  },

  // 登录后与云端收敛偏好与自定义计划（一次 userGet 拉回两者）；非 force 的重复 onShow 30 秒内跳过
  syncPrefs(force) {
    if (!account.isLoggedIn()) return Promise.resolve(false)
    const now = Date.now()
    if (!force && this._lastPrefsSyncAt && now - this._lastPrefsSyncAt < 30000) return Promise.resolve(false)
    this._lastPrefsSyncAt = now
    return profile.syncFromCloudAll().then((res) => {
      if (res && res.changed) this.reload()
      if (!res || !res.ok) this._lastPrefsSyncAt = 0
      return !!(res && res.ok)
    }).catch(() => { this._lastPrefsSyncAt = 0; return false })
  },

  pullCloud() {
    if (!store.syncEnabled()) return
    const now = Date.now()
    if (this._lastSync && now - this._lastSync < 15000) return
    this._lastSync = now
    store.syncFromCloud().then((ok) => { if (ok) this.reload() }).catch(() => {})
  },

  reload() {
    // 一次读取记录快照，统计/日历/明细都从同一份派生
    this._records = store.getAllRecords()
    this.setData({ stats: store.computeStatsFrom(this._records) })
    this.renderCalendar()
    this.refreshSelected()
  },

  renderCalendar() {
    const records = store.getDateMapFrom(this._records || store.getAllRecords())
    const selected = this.data.selected
    const today = this.data.todayStr
    // 每周行 { key, cells }：key 取该行首格标识，供 WXML wx:key 使用
    const weeks = dateUtil.monthGrid(this.data.year, this.data.month).map(function (week) {
      return {
        key: week[0].key,
        cells: week.map(function (cell) {
          if (!cell.inMonth) return cell
          const count = (records[cell.date] || []).length
          return {
            key: cell.key,
            date: cell.date,
            day: cell.day,
            inMonth: true,
            checked: count > 0,
            count: count,
            isToday: cell.date === today,
            isSel: cell.date === selected
          }
        })
      }
    })
    const now = new Date()
    const curYM = now.getFullYear() * 100 + now.getMonth() + 1
    const viewYM = this.data.year * 100 + this.data.month
    this.setData({
      monthLabel: this.data.year + '年' + this.data.month + '月',
      canNext: viewYM < curYM,
      weeks: weeks
    })
  },

  refreshSelected() {
    const selected = this.data.selected
    const p = selected.split('-')
    const day = new Date(+p[0], +p[1] - 1, +p[2])
    const list = (this._records || store.getAllRecords()).filter(function (record) {
      return record.date === selected
    }).sort(function (a, b) {
      return Number(a.createdAt) - Number(b.createdAt)
    })
    this.setData({
      selectedLabel: (+p[1]) + '月' + (+p[2]) + '日 周' + dateUtil.WEEK_LABELS[day.getDay()],
      selectedRecords: list.map(recordView)
    })
  },

  onPrevMonth() {
    let year = this.data.year
    let month = this.data.month - 1
    if (month < 1) { month = 12; year-- }
    this.setData({ year: year, month: month })
    this.renderCalendar()
  },

  onNextMonth() {
    const now = new Date()
    let year = this.data.year
    let month = this.data.month + 1
    if (month > 12) { month = 1; year++ }
    if (year * 100 + month > now.getFullYear() * 100 + now.getMonth() + 1) return
    this.setData({ year: year, month: month })
    this.renderCalendar()
  },

  onSelectDay(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    this.setData({ selected: date })
    this.renderCalendar()
    this.refreshSelected()
  },

  // 删除记录确认弹层
  onDeleteRecord(e) {
    const id = e.currentTarget.dataset.id
    const record = store.getRecord(id)
    if (!record) return
    this.setData({ deleteConfirm: { show: true, id: id, name: record.planName } })
  },

  onCancelDelete() {
    this.setData({ deleteConfirm: { show: false, id: '', name: '' } })
  },

  onConfirmDelete() {
    const id = this.data.deleteConfirm.id
    if (!id) return
    store.removeRecord(id)
    this.reload()
    this.setData({ deleteConfirm: { show: false, id: '', name: '' } })
    toast.show('已删除')
  },

  // 头像链接失效（临时链接过期）时回退文字头像
  onAvatarError() {
    this._avatarSeq = (this._avatarSeq || 0) + 1
    this.setData({ 'accountInfo.avatar': '' })
  },

  noop() {},

  onShareAppMessage() {
    const stats = this.data.stats
    return {
      title: '我已坚持打卡 ' + stats.total + ' 天，连续 ' + stats.streak + ' 天！',
      path: '/pages/index/index' }
  }
})
