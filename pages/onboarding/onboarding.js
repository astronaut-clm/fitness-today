// 登录后引导：补全训练偏好 → 创建自定义计划（均可跳过）
const profile = require('../../utils/profile.js')
const customPlans = require('../../utils/custom-plans.js')
const account = require('../../utils/account.js')
const login = require('../../utils/login.js')
const toast = require('../../utils/toast.js')
const prefsForm = require('../../components/prefs-form/prefs-form.js')

Page(Object.assign({}, prefsForm, {
  data: {
    step: 1,
    goals: [],
    scenes: [],
    experiences: [],
    equipment: [],
    weeklyTargetDays: profile.DEFAULT_WEEKLY_TARGET.days,
    weeklyTargetMinutes: profile.DEFAULT_WEEKLY_TARGET.minutes,
    customHint: ''
  },

  onLoad() {
    this.current = profile.get()
    this.applyCurrent()
    this.refreshCustom()
  },

  // 从自定义计划页返回时刷新
  onShow() {
    this.refreshCustom()
  },

  // 完成或跳过都算看过，避免反复打扰
  onUnload() {
    login.markOnboardingDone()
  },

  refreshCustom() {
    const parts = customPlans.customSceneNames()
    this.setData({
      customHint: parts.length ? '已设置：' + parts.join(' · ') : '还没有自定义计划，去创建一个吧'
    })
  },

  savePrefs() {
    profile.save(this.current)
    // 不阻塞流程，但要接住 rejection
    if (account.isLoggedIn()) profile.pushToCloud().catch(() => {})
  },

  onNextStep() {
    if (!this.current.goal) {
      toast.show('请先选择训练目标')
      return
    }
    this.savePrefs()
    this.setData({ step: 2 })
  },

  // 第一步的目标必选，所以跳过等同「保存并继续」；最后一步才真结束
  onSkipStep() {
    if (this.data.step === 1) {
      this.onNextStep()
      return
    }
    this.onExit()
  },

  onPrevStep() {
    this.setData({ step: 1 })
  },

  goCustomPlan() {
    wx.navigateTo({ url: '/pages/custom-plan/custom-plan' })
  },

  onExit() {
    wx.navigateBack({
      fail: function () { wx.switchTab({ url: '/pages/index/index' }) }
    })
  }
}))
