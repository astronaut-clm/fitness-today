// 打卡页：月历（哪天练过）+ 累计统计 + 当日明细
const records = require('../../utils/records.js')
const dateUtil = require('../../utils/date.js')
const account = require('../../utils/account.js')
const login = require('../../utils/login.js')
const nav = require('../../utils/nav.js')
const profile = require('../../utils/profile.js')
const throttle = require('../../utils/throttle.js')
const toast = require('../../utils/toast.js')
const fontBehavior = require('../../utils/font.js').behavior

// 未登录/登出时的占位账号（char 为文字头像兜底字符）
function emptyAccount() {
  return { nickname: '', avatar: '', char: account.FALLBACK_CHAR }
}

function emptyDeleteConfirm() {
  return { show: false, id: '', name: '' }
}

// 年月压成可比较的整数：202603 > 202602
function ymOf(year, month) {
  return year * 100 + month
}

function currentYM() {
  const now = new Date()
  return ymOf(now.getFullYear(), now.getMonth() + 1)
}

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
  behaviors: [fontBehavior, account.avatarBehavior('accountInfo.avatar')],

  data: {
    accountInfo: emptyAccount(),
    stats: { total: 0, streak: 0, monthCount: 0, monthMinutes: 0 },
    monthLabel: '',
    canNext: false,
    weekHead: dateUtil.WEEK_HEAD_LABELS,
    weeks: [],
    selectedLabel: '',
    selectedRecords: [],
    deleteConfirm: emptyDeleteConfirm()
  },

  onLoad() {
    this.bindAvatar()
    // 今天日期、选中日、当前翻到的年月都只在 JS 内部使用，不进 data
    // （wxml 渲染日历用单元格自身的 isToday/isSel，月份只用派生出来的 monthLabel/canNext）
    this.todayStr = dateUtil.today()
    this.selected = this.todayStr
    const now = new Date()
    this.year = now.getFullYear()
    this.month = now.getMonth() + 1
  },

  onShow() {
    if (!nav.enter(this, nav.TAB.checkin)) return
    this.reload()
    this.pullCloud()
    this.refreshAccount()
    this.syncPrefs()
  },

  refreshAccount() {
    if (!account.isLoggedIn()) {
      this.setData({ accountInfo: emptyAccount() })
      return
    }
    this.renderAccount(account.get())
    // 云端资料的限频与失败重试见 utils/login.js 的 refreshAccount
    login.refreshAccount(this, {
      key: '_lastProfileFetchAt',
      onProfile: (res) => this.renderAccount(res),
      // 云端账号已不存在（清库/删号）：本机数据已被清空，直接回首页登录
      onGone: () => nav.requireLogin()
    })
  },

  renderAccount(src) {
    const nickname = (src && src.nickname) || ''
    this.setData({
      accountInfo: { nickname: nickname, avatar: '', char: account.charOf(nickname) }
    })
    this.showAvatar((src && src.avatar) || '')
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' })
  },

  // 登录后与云端收敛偏好与自定义计划（一次 userGet 拉回两者）；限频与失败重试见 utils/profile.js 的 syncPull
  syncPrefs(force) {
    return profile.syncPull(this, {
      key: '_lastPrefsSyncAt',
      force: !!force,
      onChange: () => { if (nav.alive(this)) this.reload() }
    })
  },

  pullCloud() {
    if (!records.syncEnabled()) return
    if (!throttle.pass(this, '_lastSync', 15000)) return
    records.syncFromCloud().then((ok) => {
      // 请求飞行期间可能已跳到别的页，别再给离开的页面重算一遍
      if (ok && nav.alive(this)) this.reload()
    }).catch(() => {})
  },

  reload() {
    // 读一次记录存到页面上：统计 / 日历 / 当日明细都从这一份算，
    // 翻月、选日期时不用再读一遍记录
    this._records = records.getAll()
    this._dateMap = records.getDateMapFrom(this._records)
    this.setData({ stats: records.computeStatsFrom(this._records) })
    this.renderCalendar()
    this.refreshSelected()
  },

  renderCalendar() {
    const dateMap = this._dateMap || {}
    const selected = this.selected
    const today = this.todayStr
    // 每周行 { key, cells }：key 取该行首格标识，供 WXML wx:key 使用
    const weeks = dateUtil.monthGrid(this.year, this.month).map(function (week) {
      return {
        key: week[0].key,
        cells: week.map(function (cell) {
          if (!cell.inMonth) return cell
          return {
            key: cell.key,
            date: cell.date,
            day: cell.day,
            inMonth: true,
            checked: !!(dateMap[cell.date] && dateMap[cell.date].length),
            isToday: cell.date === today,
            isSel: cell.date === selected
          }
        })
      }
    })
    this.setData({
      monthLabel: dateUtil.monthLabel(this.year, this.month),
      canNext: ymOf(this.year, this.month) < currentYM(),
      weeks: weeks
    })
  },

  refreshSelected() {
    const selected = this.selected
    // slice 一份再排序，别改到 _dateMap 里那个数组的顺序
    const list = ((this._dateMap || {})[selected] || []).slice().sort(function (a, b) {
      return Number(a.createdAt) - Number(b.createdAt)
    })
    this.setData({
      selectedLabel: dateUtil.dayLabel(dateUtil.parse(selected)),
      selectedRecords: list.map(recordView)
    })
  },

  onPrevMonth() {
    let year = this.year
    let month = this.month - 1
    if (month < 1) { month = 12; year-- }
    this.year = year
    this.month = month
    this.renderCalendar()
  },

  onNextMonth() {
    let year = this.year
    let month = this.month + 1
    if (month > 12) { month = 1; year++ }
    if (ymOf(year, month) > currentYM()) return
    this.year = year
    this.month = month
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
    const record = records.getRecord(id)
    if (!record) return
    this.setData({ deleteConfirm: { show: true, id: id, name: record.planName } })
  },

  onCancelDelete() {
    this.setData({ deleteConfirm: emptyDeleteConfirm() })
  },

  onConfirmDelete() {
    const id = this.data.deleteConfirm.id
    if (!id) return
    // 删除同样要过本地写入这一关，失败必须让用户知道
    if (!records.removeRecord(id)) toast.show('删除失败，请重试')
    this.reload()
    this.setData({ deleteConfirm: emptyDeleteConfirm() })
  },

  onShareAppMessage() {
    const stats = this.data.stats
    return {
      title: '我已坚持打卡 ' + stats.total + ' 天，连续 ' + stats.streak + ' 天！',
      path: '/pages/index/index'
    }
  }
})
