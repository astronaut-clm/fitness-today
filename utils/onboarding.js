// utils/onboarding.js 登录后「完善资料」引导标记（完成/跳过后写入，退出登录时清除）
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
