// 登录编排：一键登录、登录后同步、登出清理，以及引导流程的「已看过」标记。
// 这里是唯一知道「一次登录/登出要动哪些本机数据」的地方，各页面只调这里的入口。
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

// 引导页「是否已看过」标记（完成/跳过后写入，登出时清除）。
// 注意与 profile.completed() 是两件事：
//   profile.completed()  = 训练偏好数据是否已填过（看数据）
//   onboardingDone()     = 引导流程是否已走过/跳过（看标记）
// 首次进入看 onboardingDone，首页是否显示配置入口看 profile.completed
const onboardingStore = storage.scoped('ft_onboarding_v1')

function onboardingDone() {
  return !!onboardingStore.read(false)
}

function markOnboardingDone() {
  onboardingStore.write(1)
}

// 微信「头像昵称」一键登录：取 openid → 传头像 → 存资料 → 云端收敛
// 始终 resolve：成功 { ok, nickname, avatar, newUser }，失败 { ok:false, code }
// newUser = 写入前云端无该用户文档，用于决定是否进入引导
function loginOneTap(tempFilePath) {
  if (!tempFilePath) return Promise.resolve({ ok: false, code: 'no_avatar' })
  let openid = ''
  let newUser = false
  return account.login().then(function (id) {
    if (!id) throw new Error('no_openid')
    openid = id
    // 写入前读云端：拿旧头像（保存后清理）并判断是否新用户
    return account.readCloud().then(function (prev) {
      const previousAvatar = (prev && prev.avatar) || ''
      newUser = !!prev && Number(prev.updatedAt || 0) === 0
      return account.uploadAvatar(tempFilePath).then(function (uploadRes) {
        if (!uploadRes || !uploadRes.ok) throw new Error('upload_failed')
        return account.saveProfile({
          // 老用户重新登录要保留云端自定义昵称，只有首次登录（云端无昵称）才落到默认值
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

// 清理本地业务数据（不含账号身份，由 account.logout 负责）；云端数据保留
function resetLocalData() {
  records.clearLocal()
  sessionStore.clear()
  profile.resetLocal()
  adjustments.resetLocal()
  customPlans.resetLocal()
  onboardingStore.remove()
  recommend.resetCache()
  aiWeekly.resetLocal()
  // AI 推荐结果按 openid 无关地存在本地，漏清会让新账号看到上一个用户的推荐
  aiRecommend.resetLocal()
}

function resetSession() {
  account.logout()
  resetLocalData()
}

// 云端账号已不存在（清库/删号）：清理本地业务数据并返回 true。
// 只在本文件内使用——页面一律走 refreshAccount 的 onGone 回调，不用自己判这个 code
function handleNoAccount(res) {
  if (!res || res.code !== 'no_account') return false
  resetLocalData()
  return true
}

// 页面级账号资料刷新：限频、失败放行重试、账号失效处理都收在这里，
// 免得首页 / 打卡页 / 账号页各写一遍同样的三段式。永不 reject。
//   opts.key       限频基准点挂在 page 上的属性名（每页各自一个，互不干扰）
//   opts.interval  限频窗口，默认 15 秒
//   opts.force     跳过限频（账号页 onLoad 首次进入用）
//   opts.onProfile(res)  成功拉到云端资料时回调
//   opts.onGone()        云端账号已不存在、本机业务数据已清空时回调
// resolve { ok, code }，code 取值：
//   ''          成功
//   'throttled' 被限频，本次没发请求
//   'gone'      云端账号已不存在（onGone 已回调）
//   'failed'    网络/云端异常，判不出账号状态，水位已清、下次可立即重试
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
    // 无法判定账号状态时保留登录态，清掉水位让下一次 onShow 重试
    if (!res || !res.ok) {
      throttle.reset(page, key)
      return { ok: false, code: 'failed' }
    }
    return { ok: true, code: '' }
  }).catch(function (err) {
    // 网络异常解不出结论，放行下一次，别把用户卡在错误视图里
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
