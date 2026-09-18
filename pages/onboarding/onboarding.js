// 登录后引导：补全训练偏好 → 创建自定义计划（均可跳过）
const profile = require('../../utils/profile.js')
const customPlans = require('../../utils/custom-plans.js')
const account = require('../../utils/account.js')
const login = require('../../utils/login.js')
const toast = require('../../utils/toast.js')
const prefsForm = require('../../components/prefs-form/prefs-form.js')
const fontBehavior = require('../../utils/font.js').behavior

Page(Object.assign({}, prefsForm, {
  behaviors: [fontBehavior],
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

  // 从自定义计划页返回时刷新已设置状态
  onShow() {
    this.refreshCustom()
  },

  // 无论「完成」还是「跳过」，离开引导即记为已看过，避免反复打扰
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
    // 不阻塞引导流程，但要接住 rejection：否则云调用失败会以未处理 rejection 冒出来
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

  // 跳过当前步骤：第一步的目标为必选，与「保存并继续」同一逻辑；最后一步才结束引导
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
