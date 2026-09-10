// utils/account.js 用户账号与个人设置（头像昵称）
// 身份由微信 openid 唯一标识，无需注册；资料按 openid 存取于云端 ft_users 集合。
// 所有云能力调用均先等待 cloud.ready()，避免启动期竞态。
const cloud = require('./cloud.js')

const OPENID_KEY = 'ft_openid'
const CACHE_KEY = 'ft_account_v1'
const LOGIN_KEY = 'ft_logged_in'
const LOGOUT_KEY = 'ft_logged_out'

let openidPromise = null

function enabled() {
  return cloud.callable()
}

// 发起 login 云函数调用：云不可用时 resolve(null)，云函数调用失败时 reject（由调用方决定提示或重试）。
function call(action, data) {
  return cloud.invoke(action, data)
}

// 获取当前微信用户的 openid（成功后做内存缓存，跨页面复用）。
// 失败或拿不到 openid 时不缓存结果，允许本次会话内再次登录自动重试。
function login() {
  if (!enabled()) return Promise.resolve('')
  if (openidPromise) return openidPromise
  openidPromise = call('').then(function (r) {
    const openid = (r && r.result && r.result.openid) || ''
    if (!openid) throw new Error('no_openid')
    try { wx.setStorageSync(OPENID_KEY, openid) } catch (e) {}
    return openid
  }).catch(function (err) {
    openidPromise = null
    throw err
  })
  return openidPromise
}

// 生成默认昵称：取 openid 后六位，避免把一长串 openid 直接当昵称展示。
function defaultNickname(openid) {
  const id = String(openid || '')
  const tail = id.length > 6 ? id.slice(-6) : id
  return tail || '微信用户'
}

function cached() {
  let info = { nickname: '', avatar: '' }
  try { info = Object.assign(info, wx.getStorageSync(CACHE_KEY) || {}) } catch (e) {}
  return info
}

function get() {
  return cached()
}

// 登录态语义：只有主动点击「一键登录」并完成过登录才算已登录（本机写入登录标记）。
// 云端资料的自动拉回（fetchProfile）只用于刷新展示，不会自行建立登录态，
// 因此未点过登录或已退出登录的用户无法开始训练/写记录。
// 微信身份 openid 本身无法退出，登出只是本机不再展示账号并暂停云端同步，
// 云端数据保留，再次一键登录（同一 openid）即可恢复。
function isLoggedOut() {
  try { return !!wx.getStorageSync(LOGOUT_KEY) } catch (e) { return false }
}

function isLoggedIn() {
  if (isLoggedOut()) return false
  try { return !!wx.getStorageSync(LOGIN_KEY) } catch (e) { return false }
}

function markLoggedIn() {
  try {
    wx.setStorageSync(LOGIN_KEY, 1)
    wx.removeStorageSync(LOGOUT_KEY)
  } catch (e) {}
}

function logout() {
  openidPromise = null
  try {
    wx.removeStorageSync(OPENID_KEY)
    wx.removeStorageSync(CACHE_KEY)
    wx.removeStorageSync(LOGIN_KEY)
    wx.setStorageSync(LOGOUT_KEY, 1)
  } catch (e) {}
}

// 训练/记录类操作的登录闸门：已登录返回 true；未登录返回 false。
// 由调用页面在返回 false 时展示登录引导层并跳转「我的」页一键登录。
function requireLogin() {
  return isLoggedIn()
}

function saveLocal(info) {
  const next = {
    nickname: String((info && info.nickname) || ''),
    avatar: String((info && info.avatar) || ''),
    updatedAt: Date.now()
  }
  try { wx.setStorageSync(CACHE_KEY, next) } catch (e) {}
  return next
}

// 从云端拉取当前用户资料，成功后写本地缓存（含换机场景恢复）。
// 主动登出期间不自动拉回资料，避免"退出即失效"被静默破坏；重新一键登录后会解除登出态。
function fetchProfile() {
  if (!enabled() || isLoggedOut()) return Promise.resolve({ ok: false })
  return call('profile').then(function (r) {
    const result = (r && r.result) || {}
    if (!result.openid) return { ok: false }
    const info = saveLocal({
      nickname: result.nickname || '',
      avatar: result.avatar || ''
    })
    return Object.assign({ ok: true, openid: result.openid }, info)
  }).catch(function (err) {
    console.error('[account] fetchProfile', err)
    return { ok: false }
  })
}

// 保存资料到云端（login 云函数写入 ft_users，doc id = openid）。
function saveProfile(info) {
  const payload = {
    nickname: String((info && info.nickname) || '').trim().slice(0, 30),
    avatar: String((info && info.avatar) || '')
  }
  return call('profileSet', { profile: payload }).then(function (r) {
    const result = (r && r.result) || {}
    if (!result.openid) return { ok: false, code: 'save_error' }
    const saved = saveLocal({ nickname: result.nickname, avatar: result.avatar })
    markLoggedIn()
    return Object.assign({ ok: true }, saved)
  }).catch(function (err) {
    console.error('[account] saveProfile', err)
    return { ok: false, code: 'save_error', err: err }
  })
}

// 计算本地临时文件的 md5（用于头像内容去重）。
// 低版本基础库不支持 digestAlgorithm 时返回空串，由调用方回退为时间戳命名。
function fileDigest(filePath) {
  return new Promise(function (resolve) {
    let fs = null
    try { fs = wx.getFileSystemManager() } catch (e) {}
    if (!fs || !fs.getFileInfo) return resolve('')
    fs.getFileInfo({
      filePath: filePath,
      digestAlgorithm: 'md5',
      success: function (res) { resolve((res && res.digest) || '') },
      fail: function () { resolve('') }
    })
  })
}

// 把 chooseAvatar 返回的临时图片上传到云存储，返回 fileID。
// 文件名取图片内容 md5：同一张图反复选择、反复登录/失败重试都会落到同一路径并覆盖，
// 不会在 avatars 目录里积累大量内容相同的副本。
function uploadAvatar(tempFilePath) {
  if (!enabled() || !tempFilePath) return Promise.resolve({ ok: false })
  return login().then(function (openid) {
    if (!openid) return { ok: false, code: 'no_openid' }
    const ext = String(tempFilePath).match(/\.(png|jpe?g|gif|webp)$/i)
    const suffix = ext ? ext[0].toLowerCase() : '.jpg'
    return fileDigest(tempFilePath).then(function (digest) {
      const name = digest || String(Date.now())
      const cloudPath = 'avatars/' + openid + '/' + name + suffix
      return wx.cloud.uploadFile({ cloudPath: cloudPath, filePath: tempFilePath }).then(function (res) {
        const fileID = (res && res.fileID) || ''
        return fileID ? { ok: true, fileID: fileID } : { ok: false, code: 'upload_error' }
      }).catch(function (err) {
        console.error('[account] uploadAvatar', err)
        return { ok: false, code: 'upload_error' }
      })
    })
  })
}

// 读取云端 ft_users 中当前头像 fileID（纯云端读，不依赖本机登录态），用于换头像后清理旧文件。
function cloudAvatar() {
  if (!enabled()) return Promise.resolve('')
  return call('profile').then(function (r) {
    const result = (r && r.result) || {}
    return (result && result.avatar) || ''
  }).catch(function () {
    return ''
  })
}

// 清理旧的云头像文件（忽略失败，避免阻塞主流程）。
function deleteFile(fileID) {
  if (!enabled() || !fileID) return Promise.resolve()
  return wx.cloud.deleteFile({ fileList: [fileID] }).catch(function () {})
}

// 云端数据自愈：让 login 云函数把当前 openid 的重复资料/订阅收敛为唯一一份。
// 服务端幂等，无重复时几乎零成本；登录成功后调用一次即可长期兜底。
function repair() {
  if (!enabled()) return Promise.resolve({ ok: false })
  return cloud.invoke('selfRepair').then(function (r) {
    const result = (r && r.result) || {}
    return { ok: !!(result && result.openid) }
  }).catch(function () {
    return { ok: false }
  })
}

module.exports = {
  login: login,
  defaultNickname: defaultNickname,
  get: get,
  isLoggedIn: isLoggedIn,
  requireLogin: requireLogin,
  logout: logout,
  fetchProfile: fetchProfile,
  saveProfile: saveProfile,
  uploadAvatar: uploadAvatar,
  cloudAvatar: cloudAvatar,
  repair: repair,
  deleteFile: deleteFile
}
