// utils/login.js 微信「头像昵称」一键登录（首页使用）
// 登录步骤固定：login 取 openid -> 上传头像 -> 保存资料（含旧头像清理）；
// 登录成功后的云端收敛（训练记录、偏好/自定义计划、云端自愈）也统一封装在此。
// 各页面只需在完成后刷新自己的视图，避免登录流程在各页重复实现。
const account = require('./account.js')
const store = require('./store.js')
const profile = require('./profile.js')

// 一键登录。tempFilePath 为 chooseAvatar 返回的本地头像临时路径。
// 始终 resolve（不 reject）：成功 { ok:true, nickname, avatar, newUser }；
// 失败 { ok:false, code }，code 取值：no_avatar / no_openid / upload_failed / save_error / login_error。
// newUser：写入资料前云端无该用户文档，即本次为全新账号的首次登录（用于决定是否启动新用户引导）。
function loginOneTap(tempFilePath) {
  if (!tempFilePath) return Promise.resolve({ ok: false, code: 'no_avatar' })
  let openid = ''
  let newUser = false
  return account.login().then(function (id) {
    if (!id) throw new Error('no_openid')
    openid = id
    // 先读取云端现有资料：既拿到旧头像（保存成功后清理被替换的文件），
    // 又据此判断是否首次登录（文档不存在即新用户），必须在写资料之前完成。
    return account.cloudProfile().then(function (prev) {
      const previousAvatar = (prev && prev.avatar) || ''
      // prev 为 null 表示读取失败（无法判定）——保守视为非新用户，避免误弹引导；
      // prev.updatedAt 为 0 表示云端尚无该用户文档，即全新账号首次登录。
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

// 登录成功后的云端收敛：触发云端自愈，并拉回历史训练记录与偏好/自定义计划。
// resolve 是否成功（用于页面决定是否刷新本地统计），失败仅记日志、不打扰用户。
function syncAfterLogin() {
  account.repair().catch(function () {})
  return store.syncFromCloud().then(function (ok) {
    return profile.syncFromCloudAll().then(function () { return ok })
  }).catch(function (err) {
    console.error('[login-sync]', err)
    return false
  })
}

module.exports = {
  loginOneTap: loginOneTap,
  syncAfterLogin: syncAfterLogin
}
