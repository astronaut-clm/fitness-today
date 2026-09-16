const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const profile = require('../../utils/profile.js')
const account = require('../../utils/account.js')
const login = require('../../utils/login.js')
const avatarView = require('../../utils/avatar.js')
const tab = require('../../utils/tab.js')
const aiWeekly = require('../../utils/ai-weekly.js')
const limit = require('../../utils/limit.js')

function recordView(record) {
  const time = new Date(record.createdAt)
  return {
    id: record.id,
    planName: record.planName,
    sceneName: record.sceneName,
    timeText: dateUtil.pad(time.getHours()) + ':' + dateUtil.pad(time.getMinutes()),
    detailText: '实际训练 ' + record.actualMinutes + ' 分钟'
  }
}

Page({
  data: {
    accountInfo: { nickname: '', avatar: '', char: '练' },
    stats: { total: 0, streak: 0, monthCount: 0, monthMinutes: 0 },
    year: 0,
    month: 0,
    monthLabel: '',
    canNext: false,
    weekHead: dateUtil.WEEK_HEAD_LABELS,
    weeks: [],
    selectedLabel: '',
    selectedRecords: [],
    // 周复盘：visible=已登录才展示；locked=本周次数不足；loading=生成中；review=复盘内容
    weeklyVisible: false,
    weeklyLocked: true,
    weeklyLoading: false,
    weeklyReview: null,
    deleteConfirm: { show: false, id: '', name: '' }
  },

  onLoad() {
    this._avatar = avatarView.create((url) => this.setData({ 'accountInfo.avatar': url }))
    // 今天日期与选中日仅 JS 内部使用（wxml 渲染用单元格自身的 isToday/isSel），不进 data
    this.todayStr = dateUtil.today()
    this.selected = this.todayStr
    const now = new Date()
    this.setData({
      year: now.getFullYear(),
      month: now.getMonth() + 1
    })
  },

  onShow() {
    tab.sync(this, 2)
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
    if (!limit.pass(this, '_lastProfileFetchAt', 15000)) return
    account.fetchProfile().then((res) => {
      if (res && res.ok) this.renderAccount(res)
      // 账号已不存在：清理本地数据并切回未登录视图
      if (login.handleNoAccount(res)) {
        this.setData({ accountInfo: { nickname: '', avatar: '', char: '练' } })
        this.reload()
        return
      }
      if (!res || !res.ok) limit.reset(this, '_lastProfileFetchAt')
    })
  },

  // 头像存的是 cloud:// 文件 ID，换临时 https 链接渲染，换不到则回退文字头像
  renderAccount(src) {
    const nickname = (src && src.nickname) || ''
    this.setData({
      accountInfo: { nickname: nickname, avatar: '', char: nickname ? nickname.slice(0, 1) : '练' }
    })
    this._avatar.show((src && src.avatar) || '')
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' })
  },

  // 登录后与云端收敛偏好与自定义计划（一次 userGet 拉回两者）；非 force 的重复 onShow 30 秒内跳过
  syncPrefs(force) {
    if (!account.isLoggedIn()) return Promise.resolve(false)
    if (!force && !limit.pass(this, '_lastPrefsSyncAt', 30000)) return Promise.resolve(false)
    return profile.syncFromCloudAll().then((res) => {
      if (res && res.changed) this.reload()
      if (!res || !res.ok) limit.reset(this, '_lastPrefsSyncAt')
      return !!(res && res.ok)
    })
  },

  pullCloud() {
    if (!store.syncEnabled()) return
    if (!limit.pass(this, '_lastSync', 15000)) return
    store.syncFromCloud().then((ok) => { if (ok) this.reload() }).catch(() => {})
  },

  reload() {
    // 一次读取记录快照，统计/日历/明细都从同一份派生
    this._records = store.getAllRecords()
    this.setData({ stats: store.computeStatsFrom(this._records) })
    this.renderCalendar()
    this.refreshSelected()
    this.loadWeekly()
  },

  // 周复盘：仅登录可见（登出/未登录整卡隐藏）；本周练过 ≥2 次解锁
  loadWeekly(force) {
    if (!account.isLoggedIn()) {
      this.setData({ weeklyVisible: false, weeklyLoading: false, weeklyReview: null })
      return
    }
    this.setData({ weeklyVisible: true })
    const records = this._records || store.getAllRecords()
    if (aiWeekly.weekSessions(records) < 2) {
      this.setData({ weeklyLocked: true, weeklyLoading: false, weeklyReview: null })
      return
    }
    if (this._weeklyBusy) return
    this._weeklyBusy = true
    this.setData({ weeklyLocked: false, weeklyLoading: true })
    aiWeekly.fetchWeekly({
      records: records,
      goal: profile.get().goal
    }, { force: !!force }).then((res) => {
      this._weeklyBusy = false
      // 失败：有旧内容保留旧内容，无则结束加载态，下次 onShow 再试（6 小时失败水位限频）
      const patch = { weeklyLoading: false }
      if (res && res.ok) patch.weeklyReview = res.data
      this.setData(patch)
    })
  },

  onWeeklyRefresh() {
    if (this._weeklyBusy) return
    this.loadWeekly(true)
  },

  renderCalendar() {
    const records = store.getDateMapFrom(this._records || store.getAllRecords())
    const selected = this.selected
    const today = this.todayStr
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
      monthLabel: dateUtil.monthLabel(this.data.year, this.data.month),
      canNext: viewYM < curYM,
      weeks: weeks
    })
  },

  refreshSelected() {
    const selected = this.selected
    const list = (this._records || store.getAllRecords()).filter(function (record) {
      return record.date === selected
    }).sort(function (a, b) {
      return Number(a.createdAt) - Number(b.createdAt)
    })
    this.setData({
      selectedLabel: dateUtil.dayLabel(dateUtil.parse(selected)),
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
    this.selected = date
    this.renderCalendar()
    this.refreshSelected()
  },

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
  },

  // 头像链接失效（临时链接过期）时回退文字头像
  onAvatarError() {
    this._avatar.error()
  },

  onShareAppMessage() {
    const stats = this.data.stats
    return {
      title: '我已坚持打卡 ' + stats.total + ' 天，连续 ' + stats.streak + ' 天！',
      path: '/pages/index/index' }
  }
})
