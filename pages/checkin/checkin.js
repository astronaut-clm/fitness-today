// pages/checkin/checkin.js
const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const profile = require('../../utils/profile.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')

function recordView(record) {
  const time = new Date(record.createdAt || record.ts)
  const minutes = Number(record.actualMinutes || record.duration || 0)
  return {
    id: record.id,
    planName: record.planName,
    sceneName: record.sceneName,
    duration: record.duration,
    timeText: dateUtil.pad(time.getHours()) + ':' + dateUtil.pad(time.getMinutes()),
    isFree: record.type === 'free',
    detailText: record.actualMinutes
      ? '实际训练 ' + record.actualMinutes + ' 分钟'
      : (record.type === 'free' ? '时长 ' + record.duration + ' 分钟' : '训练 ' + record.duration + ' 分钟'),
    groupsText: record.completedGroups ? '完成 ' + record.completedGroups + '/' + record.totalGroups + ' 组' : '',
    skippedText: record.skippedGroups ? '跳过 ' + record.skippedGroups + ' 组' : '',
    effortText: record.effort ? '主观强度 ' + record.effort + '/5' : '',
    minutes: minutes
  }
}

Page({
  data: {
    accountInfo: { nickname: '', avatar: '', char: '练' },
    loginBusy: false,
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
    // 删除记录确认弹层（页内像素弹窗）
    deleteConfirm: { show: false, id: '', name: '' },
    // 登录未完成提示弹层
    loginFailShow: false
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
    // 自定义 tabBar 选中态：WebView 下 getTabBar 同步返回实例
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
    // 登录态以「是否完成过登录」为准：未登录一律显示登录卡片，
    // 避免把云端自动拉回的缓存资料误当成"已登录"而放行训练。
    if (!account.isLoggedIn()) {
      this.setData({ accountInfo: { nickname: '', avatar: '', char: '练' } })
      return
    }
    this.renderAccount(account.get())
    // 云端资料短时间（15 秒）内只拉一次：频繁切回本 tab 不再重复发起云函数请求；失败则允许下次重试。
    const now = Date.now()
    if (this._lastProfileFetchAt && now - this._lastProfileFetchAt < 15000) return
    this._lastProfileFetchAt = now
    account.fetchProfile().then((res) => {
      if (res && res.ok) this.renderAccount(res)
      if (!res || !res.ok) this._lastProfileFetchAt = 0
    })
  },

  // 头像存的是云文件 ID（cloud://），部分环境 image 组件无法直接加载，
  // 统一换成临时 https 链接再渲染；换不到就保持空值，回退文字头像。
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
      // 换链期间资料可能已更新，丢弃过期结果，避免覆盖新头像。
      if (!url || seq !== this._avatarSeq) return
      this.setData({ 'accountInfo.avatar': url })
    }).catch(() => {})
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' })
  },

  // 登录后自动与云端收敛偏好配置与自定义计划：
  // 一次 userGet 往返同时拉回两者（云端较新则覆盖并刷新统计，本地较新则自动补传云端）。
  // 非强制（force）的重复 onShow 30 秒内跳过，避免频繁切回本 tab 产生多余云函数调用。
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

  // 未登录卡片本身是 chooseAvatar 按钮：用户点头像（含"微信头像"）即完成登录。
  // 昵称默认取 openid 后六位（免填写、好识别），头像上传云端；后续可在个人设置页改成更好记的昵称。
  onLoginOneTap(e) {
    if (this.data.loginBusy) return
    const tempUrl = (e.detail && e.detail.avatarUrl) || ''
    if (!tempUrl) return
    this.setData({ loginBusy: true })
    account.login().then((openid) => {
      if (!openid) throw new Error('no_openid')
      // 先记录云端当前头像：登录保存成功后若文件有变化，顺手清理旧文件，避免存储积累。
      const previousAvatar = account.cloudAvatar()
      return account.uploadAvatar(tempUrl).then((uploadRes) => {
        if (!uploadRes || !uploadRes.ok) throw new Error('upload_failed')
        return account.saveProfile({ nickname: account.defaultNickname(openid), avatar: uploadRes.fileID || '' }).then((res) => {
          if (res && res.ok) {
            previousAvatar.then((oldFileID) => {
              if (oldFileID && oldFileID !== uploadRes.fileID) account.deleteFile(oldFileID)
            })
          }
          return res
        })
      })
    }).then((res) => {
      if (!res || !res.ok) {
        this.setData({ loginBusy: false })
        this.setData({ loginFailShow: true })
        return
      }
      // 登录成功：先收起「登录中」加载层，随后后台静默与云端同步
      // （历史训练记录、偏好与自定义计划、云端自愈），不展示任何同步提示打扰用户。
      this.setData({ loginBusy: false })
      this.refreshAccount()
      // 顺带触发一次云端自愈（幂等）：收敛同 openid 可能存在的历史重复资料/订阅文档。
      account.repair().catch(function () {})
      store.syncFromCloud().then((ok) => {
        return this.syncPrefs(true).then(() => ok)
      }).then((ok) => {
        // 同步完成且数据有变化才刷新统计，失败仅记日志，不打扰用户。
        if (ok) this.reload()
      }).catch((err) => {
        console.error('[login-sync]', err)
      })
    }).catch((err) => {
      this.setData({ loginBusy: false })
      console.error('[one-tap-login]', err)
      toast.show('登录失败，请重试')
    })
  },

  pullCloud() {
    if (!store.syncEnabled()) return
    const now = Date.now()
    if (this._lastSync && now - this._lastSync < 15000) return
    this._lastSync = now
    store.syncFromCloud().then((ok) => { if (ok) this.reload() }).catch(() => {})
  },

  reload() {
    // 一次读取记录快照，统计、日历与当日明细都从同一份派生，避免一轮内多次全量读取。
    this._records = store.getAllRecords()
    this.setData({ stats: store.computeStatsFrom(this._records) })
    this.renderCalendar()
    this.refreshSelected()
  },

  renderCalendar() {
    const records = store.getDateMapFrom(this._records || store.getAllRecords())
    const selected = this.data.selected
    const today = this.data.todayStr
    // 每周行改为 { key, cells }：key 取该行首个格子的稳定标识，供 WXML 外层 wx:key 使用
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

  // 删除记录：页内像素确认弹层
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

  onCloseLoginFail() {
    this.setData({ loginFailShow: false })
  },

  // 头像链接失效（如临时链接过期）：回退为文字头像，避免破图。
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
