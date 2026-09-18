// 登录编排：一键登录、登录后同步、登出清理、引导「已看过」标记。
// 唯一知道「一次登录/登出要动哪些本机数据」的地方
const account = require('./account.js')
const records = require('./records.js')
const profile = require('./profile.js')
const customPlans = require('./custom-plans.js')
const adjustments = require('./plan-adjustments.js')
const recommend = require('./recommend.js')
const storage = require('./storage.js')
const throttle = require('./throttle.js')
const sessionStore = require('./workout/session.js')
const aiWeekly = require('./ai/weekly.js')
const aiRecommend = require('./ai/recommend.js')

// 与 profile.completed() 是两件事：那个看偏好数据填过没有，这个看引导流程走过没有
const onboardingStore = storage.scoped('ft_onboarding_v1')

function onboardingDone() {
  return !!onboardingStore.read(false)
}

function markOnboardingDone() {
  onboardingStore.write(1)
}

// 一键登录：取 openid → 传头像 → 存资料。始终 resolve。
// newUser = 写入前云端无该文档，调用方据此决定是否进引导
function loginOneTap(tempFilePath) {
  if (!tempFilePath) return Promise.resolve({ ok: false, code: 'no_avatar' })
  let openid = ''
  let newUser = false
  return account.login().then(function (id) {
    if (!id) throw new Error('no_openid')
    openid = id
    // 先读云端：拿旧头像（存完要清理）并判断是不是新用户
    return account.readCloud().then(function (prev) {
      const previousAvatar = (prev && prev.avatar) || ''
      newUser = !!prev && prev.exists === false
      return account.uploadAvatar(tempFilePath).then(function (uploadRes) {
        if (!uploadRes || !uploadRes.ok) throw new Error('upload_failed')
        return account.saveProfile({
          // 老用户重登要保留云端自定义昵称，只有首次登录才落默认值
          nickname: (prev && prev.nickname) || account.defaultNickname(openid),
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
  return records.syncFromCloud().then(function (ok) {
    return profile.syncFromCloud().then(function () { return ok })
  }).catch(function (err) {
    console.error('[login-sync]', err)
    return false
  })
}

// 清本机业务数据；账号身份由 account.logout 负责，云端数据保留
function resetLocalData() {
  records.clearLocal()
  sessionStore.clear()
  profile.resetLocal()
  adjustments.resetLocal()
  customPlans.resetLocal()
  onboardingStore.remove()
  recommend.resetCache()
  aiWeekly.resetLocal()
  // AI 推荐缓存与 openid 无关，漏清会让新账号看到上个用户的推荐
  aiRecommend.resetLocal()
}

function resetSession() {
  account.logout()
  resetLocalData()
}

// 云端账号已不存在（清库/删号）：清本机数据并返回 true。
// 仅本文件内用，页面走 refreshAccount 的 onGone
function handleNoAccount(res) {
  if (!res || res.code !== 'no_account') return false
  resetLocalData()
  return true
}

// 页面级资料刷新：限频、失败重试、账号失效三件事都收在这里，永不 reject。
// opts: key（限频基准点挂在 page 上的属性名）/ interval / force / onProfile(res) / onGone()
// resolve { ok, code }，code = '' | 'throttled' | 'gone' | 'failed'（failed 已清水位，可立即重试）
const ACCOUNT_REFRESH_INTERVAL = 15000

function refreshAccount(page, opts) {
  const options = opts || {}
  const key = options.key || '_lastAccountRefreshAt'
  if (!options.force && !throttle.pass(page, key, options.interval || ACCOUNT_REFRESH_INTERVAL)) {
    return Promise.resolve({ ok: false, code: 'throttled' })
  }
  return account.fetchProfile().then(function (res) {
    if (res && res.ok && typeof options.onProfile === 'function') options.onProfile(res)
    if (handleNoAccount(res)) {
      if (typeof options.onGone === 'function') options.onGone()
      return { ok: false, code: 'gone' }
    }
    // 判不出账号状态就保留登录态，清水位让下次 onShow 重试
    if (!res || !res.ok) {
      throttle.reset(page, key)
      return { ok: false, code: 'failed' }
    }
    return { ok: true, code: '' }
  }).catch(function (err) {
    // 网络异常同样不下结论，别把用户卡在错误视图里
    console.warn('[login] refreshAccount', err)
    throttle.reset(page, key)
    return { ok: false, code: 'failed' }
  })
}

module.exports = {
  onboardingDone: onboardingDone,
  markOnboardingDone: markOnboardingDone,
  loginOneTap: loginOneTap,
  syncAfterLogin: syncAfterLogin,
  refreshAccount: refreshAccount,
  resetSession: resetSession
}
