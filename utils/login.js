// 微信「头像昵称」一键登录：取 openid → 传头像 → 存资料 → 云端收敛
const account = require('./account.js')
const store = require('./store.js')
const profile = require('./profile.js')
const customPlans = require('./custom-plans.js')
const adjustments = require('./plan-adjustments.js')
const onboarding = require('./onboarding.js')
const recommend = require('./recommend.js')
const sessionStore = require('./workout-session.js')
const coachMemory = require('./coach-memory.js')
const aiReview = require('./ai-review.js')
const aiCheers = require('./ai-cheers.js')
const aiWeekly = require('./ai-weekly.js')

// 一键登录，始终 resolve：成功 { ok, nickname, avatar, newUser }，失败 { ok:false, code }。
// newUser=写入前云端无该用户文档，即全新账号首次登录（用于决定是否引导）
function loginOneTap(tempFilePath) {
  if (!tempFilePath) return Promise.resolve({ ok: false, code: 'no_avatar' })
  let openid = ''
  let newUser = false
  return account.login().then(function (id) {
    if (!id) throw new Error('no_openid')
    openid = id
    // 先读云端资料：拿旧头像（保存后清理）并判断是否新用户，必须在写入前完成
    return account.cloudProfile().then(function (prev) {
      const previousAvatar = (prev && prev.avatar) || ''
      // prev 为 null（读取失败）保守视为非新用户；updatedAt=0 表示全新账号首次登录
      newUser = !!prev && Number(prev.updatedAt || 0) === 0
      return account.uploadAvatar(tempFilePath).then(function (uploadRes) {
        if (!uploadRes || !uploadRes.ok) throw new Error('upload_failed')
        return account.saveProfile({
          nickname: account.defaultNickname(openid),
          avatar: uploadRes.fileID || ''
        }).then(function (res) {
          if (res && res.ok && previousAvatar && previousAvatar !== uploadRes.fileID) {
            account.deleteFile(previousAvatar)
          }
          return res
        })
      })
    })
  }).then(function (res) {
    if (res && res.ok) return { ok: true, nickname: res.nickname, avatar: res.avatar, newUser: newUser }
    return { ok: false, code: 'save_error' }
  }).catch(function (err) {
    return { ok: false, code: (err && err.message) || 'login_error' }
  })
}

function syncAfterLogin() {
  return store.syncFromCloud().then(function (ok) {
    return profile.syncFromCloudAll().then(function () { return ok })
  }).catch(function (err) {
    console.error('[login-sync]', err)
    return false
  })
}

// 清理本地业务数据（记录/未完成训练/偏好/计划调整/自定义计划/引导标记/推荐缓存）；
// 不含账号身份信息（由 account.logout 负责），云端数据保留。
function resetLocalData() {
  store.clearLocal()
  sessionStore.clear()
  profile.resetLocal()
  adjustments.resetLocal()
  customPlans.resetLocal()
  onboarding.resetLocal()
  recommend.resetCache()
  coachMemory.resetLocal()
  aiReview.resetLocal()
  aiCheers.resetLocal()
  aiWeekly.resetLocal()
}

function resetSession() {
  account.logout()
  resetLocalData()
}

// 云端账号已不存在（清库/删号）：清理本地业务数据并返回 true，由调用方重置视图
function handleNoAccount(res) {
  if (!res || res.code !== 'no_account') return false
  resetLocalData()
  return true
}

module.exports = {
  loginOneTap: loginOneTap,
  syncAfterLogin: syncAfterLogin,
  resetLocalData: resetLocalData,
  resetSession: resetSession,
  handleNoAccount: handleNoAccount
}
