// utils/onboarding.js 登录后「完善资料」引导的完成标记
// 首次登录后引导用户补全训练偏好与自定义计划；完成或跳过后写入标记，避免重复打扰。
// 退出登录时清除，保证同一设备上换账号后仍会被引导。
const KEY = 'ft_onboarding_v1'

function isDone() {
  try { return !!wx.getStorageSync(KEY) } catch (e) { return false }
}

function markDone() {
  try { wx.setStorageSync(KEY, 1) } catch (e) {}
}

function resetLocal() {
  try { wx.removeStorageSync(KEY) } catch (e) {}
}

module.exports = {
  isDone: isDone,
  markDone: markDone,
  resetLocal: resetLocal
}
