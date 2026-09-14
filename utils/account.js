// utils/account.js 用户账号与个人设置（以 openid 为身份，资料存云端 ft_users）
const cloud = require('./cloud.js')

const OPENID_KEY = 'ft_openid'
const CACHE_KEY = 'ft_account_v1'
const LOGIN_KEY = 'ft_logged_in'
const LOGOUT_KEY = 'ft_logged_out'

let openidPromise = null

function enabled() {
  return cloud.callable()
}

// 发起 login 云函数调用：云不可用 resolve(null)，调用失败 reject
function call(action, data) {
  return cloud.invoke(action, data)
}

// 获取 openid 并做内存缓存；失败不缓存，允许本会话重试
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

// 默认昵称：取 openid 后六位
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

// 登录态语义：只有主动一键登录过才算已登录，云端资料自动拉回不建立登录态。
// 登出仅本机不再展示账号并暂停同步，云端数据保留，再次登录即恢复。
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

// 训练/记录类操作的登录闸门；未登录时由调用方展示引导并跳转登录
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

// 从云端拉取资料并写本地缓存（含换机恢复）；主动登出期间不拉回
function fetchProfile() {
  if (!enabled() || isLoggedOut()) return Promise.resolve({ ok: false })
  return call('profile').then(function (r) {
    const result = (r && r.result) || {}
    if (!result.openid) return { ok: false }
    // 云端无该用户文档（清库/删号）：置为未登录并返回 no_account，由上层清理本地数据
    const hasDoc = Number(result.updatedAt || 0) > 0 || !!result.nickname || !!result.avatar
    if (!hasDoc) {
      logout()
      return { ok: false, code: 'no_account' }
    }
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

// 保存资料到云端（ft_users，doc id = openid）
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

// 计算临时文件 md5（用于头像去重）
function fileDigest(filePath) {
  return new Promise(function (resolve) {
    const fs = wx.getFileSystemManager()
    fs.getFileInfo({
      filePath: filePath,
      digestAlgorithm: 'md5',
      success: function (res) { resolve((res && res.digest) || '') },
      fail: function () { resolve('') }
    })
  })
}

// 上传头像到云存储并返回 fileID；文件名取内容 md5，避免同图重复占位
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

// 读取云端用户资料（不依赖本机登录态）；updatedAt=0 表示新账号，读取失败返回 null
function cloudProfile() {
  if (!enabled()) return Promise.resolve(null)
  return call('profile').then(function (r) {
    const result = (r && r.result) || {}
    if (!result.openid) return null
    return result
  }).catch(function () {
    return null
  })
}

// 清理旧的云头像文件（忽略失败）
function deleteFile(fileID) {
  if (!enabled() || !fileID) return Promise.resolve()
  return wx.cloud.deleteFile({ fileList: [fileID] }).catch(function () {})
}

// 云文件 fileID → https 临时链接（image 组件不能直接用 cloud://）。
// 统一走云函数 fileUrl：服务端管理员 token 绕过存储权限规则，头像与动作动画通用。
// 内存缓存 90 分钟，换取失败回退旧链接，彻底失败返回空串。
const AVATAR_CACHE = {}
const AVATAR_TTL = 90 * 60 * 1000

function resolveAvatar(fileID) {
  const id = String(fileID || '')
  if (!id) return Promise.resolve('')
  // 普通 URL / 本地临时文件：直接用
  if (id.indexOf('cloud://') !== 0) return Promise.resolve(id)
  if (!enabled()) return Promise.resolve('')

  const cached = AVATAR_CACHE[id]
  if (cached && cached.expireAt > Date.now()) return Promise.resolve(cached.url)

  const fallback = (cached && cached.url) || ''
  // 用 invoke 直接调用 fileUrl，避免 cloud.call 要求 openid
  return cloud.invoke('fileUrl', { fileList: [id] }).then(function (res) {
    const list = (res && res.result && res.result.fileList) || []
    const url = (list[0] && list[0].tempFileURL) || ''
    if (url) AVATAR_CACHE[id] = { url: url, expireAt: Date.now() + AVATAR_TTL }
    return url || fallback
  }).catch(function () {
    return fallback
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
  cloudProfile: cloudProfile,
  deleteFile: deleteFile,
  resolveAvatar: resolveAvatar
}
