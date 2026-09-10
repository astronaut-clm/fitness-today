// pages/index/index.js
const plansData = require('../../data/plans.js')
const store = require('../../utils/store.js')
const dateUtil = require('../../utils/date.js')
const profile = require('../../utils/profile.js')
const recommend = require('../../utils/recommend.js')
const insights = require('../../utils/insights.js')
const account = require('../../utils/account.js')
const toast = require('../../utils/toast.js')

const sceneTabs = [
  { value: '', name: '全部' },
  { value: 'home', name: '居家' },
  { value: 'gym', name: '健身房' }
]

Page({
  data: {
    dateText: '',
    streak: 0,
    recPlan: null,
    isLogged: false,
    goalReady: false,
    todaySummary: null,
    insight: { weekDays: 0, targetDays: 3, weekMinutes: 0, targetMinutes: 90, dayPercent: 0, minutePercent: 0, coverage: [], dayBar: '', minuteBar: '' },
    sheetShow: false,
    sheetScene: '',
    sceneTabs: sceneTabs,
    sheetDate: '',
    sheetPlans: [],
    startDate: '',
    todayStr: '',
    showLoginDialog: false,
    freeShow: false,
    freeMinutes: ''
  },

  onShow() {
    // 自定义 tabBar 选中态：WebView 下 getTabBar 同步返回实例
    if (typeof this.getTabBar === 'function') {
      const tabBar = this.getTabBar()
      if (tabBar && tabBar.setData) tabBar.setData({ selected: 0 })
    }
    this.refresh()
    // 手动打卡弹层依赖登录态：若已退出登录/登录态失效，切换回本 tab 时主动收起，
    // 避免未完成的弹层残留，出现点选无响应、界面“保持”的假象。
    if (!account.isLoggedIn() && this.data.sheetShow) {
      this.setData({ sheetShow: false })
    }
  },

  refresh() {
    // 一次读取记录快照，统计与当日汇总都从同一份派生，避免重复遍历/排序。
    const records = store.getAllRecords()
    const stats = store.computeStatsFrom(records)
    const currentProfile = profile.get()
    const today = dateUtil.today()
    const now = new Date()
    const todayRecords = records.filter(function (record) {
      return record.date === today
    }).sort(function (a, b) {
      return Number(a.createdAt) - Number(b.createdAt)
    })

    const dateText = (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + dateUtil.WEEK_LABELS[now.getDay()]

    const minutes = todayRecords.reduce(function (total, record) {
      return total + Number(record.actualMinutes || record.duration || 0)
    }, 0)
    const latest = todayRecords[todayRecords.length - 1]
    const todaySummary = todayRecords.length ? {
      count: todayRecords.length,
      minutes: minutes,
      latestName: latest && latest.planName
    } : null

    const built = insights.build(records, currentProfile)
    built.dayBar = 'width:' + Math.max(0, Number(built.dayPercent) || 0) + '%;'
    built.minuteBar = 'width:' + Math.max(0, Number(built.minutePercent) || 0) + '%;'
    this.setData({
      dateText: dateText,
      streak: stats.streak,
      recPlan: recommend.pick(records, currentProfile),
      isLogged: todayRecords.length > 0,
      goalReady: profile.completed(currentProfile),
      todaySummary: todaySummary,
      insight: built
    })
  },

  goRecPlan() {
    // 进入计划库挑选任意计划（pick=1），挑中后进入可开始训练的详情页；
    // 推荐计划仍在首页 hero 文案中展示。
    if (!account.requireLogin()) { this.showLogin(); return }
    wx.navigateTo({ url: '/pages/plan/plan?pick=1' })
  },

  goProfile() {
    if (!account.requireLogin()) { this.showLogin(); return }
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  goTutorial() {
    wx.navigateTo({ url: '/pages/tutorial/tutorial' })
  },

  goPlans() {
    wx.navigateTo({ url: '/pages/plan/plan' })
  },

  // 「已练完 · 手动打卡」：直接在主页弹出记录表单，不跳到「我的」页。
  openSheet() {
    if (!account.requireLogin()) { this.showLogin(); return }
    const dates = Object.keys(store.getRecords())
    this.setData({
      sheetShow: true,
      sheetScene: '',
      sheetDate: dateUtil.today(),
      sheetPlans: this.buildSheetPlans(''),
      startDate: dates.length ? dates.sort()[0] : new Date().getFullYear() + '-01-01',
      todayStr: dateUtil.today()
    })
  },
  closeSheet() { this.setData({ sheetShow: false }) },

  buildSheetPlans(scene) {
    const src = scene ? plansData.listByScene(scene) : plansData.plans
    return src.map(function (plan) {
      return { id: plan.id, name: plan.name, scene: plan.scene, sceneName: plansData.sceneName(plan.scene), duration: plan.duration, level: plan.level }
    })
  },

  onSheetScene(e) {
    const scene = e.currentTarget.dataset.scene
    this.setData({ sheetScene: scene, sheetPlans: this.buildSheetPlans(scene) })
  },
  onSheetDateChange(e) { this.setData({ sheetDate: e.detail.value }) },

  onChoosePlan(e) {
    const plan = this.data.sheetPlans[e.currentTarget.dataset.idx]
    if (!plan) return
    this.commitSave({ type: 'plan', planId: plan.id, planName: plan.name, scene: plan.scene, sceneName: plan.sceneName, duration: plan.duration })
  },

  // 自由训练时长：页内像素输入弹层
  onChooseFree() {
    this.setData({ freeShow: true, freeMinutes: '' })
  },

  onFreeInput(e) {
    this.setData({ freeMinutes: e.detail.value })
  },

  onCancelFree() {
    this.setData({ freeShow: false, freeMinutes: '' })
  },

  onConfirmFree() {
    const minutes = parseInt(this.data.freeMinutes, 10)
    if (isNaN(minutes) || minutes < 1 || minutes > 600) {
      toast.show('请输入 1-600 之间的分钟数')
      return
    }
    this.setData({ freeShow: false, freeMinutes: '' })
    this.commitSave({ type: 'free', planId: 'free', planName: '自由训练', scene: 'free', sceneName: '自由', duration: minutes })
  },

  commitSave(payload) {
    if (!account.isLoggedIn()) {
      // 兜底：弹层仍残留且登录态已失效时，先收起再引导重新登录，避免静默无响应。
      this.setData({ sheetShow: false })
      this.showLogin()
      return
    }
    const todayStr = dateUtil.today()
    const date = this.data.sheetDate
    if (date > todayStr) {
      toast.show('不能记录未来日期')
      return
    }
    store.addRecord(Object.assign({ date: date }, payload))
    this.setData({ sheetShow: false })
    this.refresh()
    toast.show(date === todayStr ? '记录成功' : '补卡成功', { success: true })
  },

  goCheckin() {
    wx.switchTab({ url: '/pages/checkin/checkin' })
  },

  // 登录引导弹层（页内像素弹窗）
  showLogin() {
    this.setData({ showLoginDialog: true })
  },

  onCancelLogin() {
    this.setData({ showLoginDialog: false })
  },

  onConfirmLogin() {
    this.setData({ showLoginDialog: false })
    wx.switchTab({ url: '/pages/checkin/checkin' })
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: this.data.isLogged ? '今天已打卡，练得漂亮！' : '今天练了吧？一起动起来！',
      path: '/pages/index/index'
    }
  }
})
