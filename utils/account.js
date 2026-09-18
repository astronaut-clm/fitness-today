// 用户账号：以 openid 为身份，资料存云端 ft_users，本机仅缓存
const cloud = require('./cloud.js')
const storage = require('./storage.js')
const throttle = require('./throttle.js')

const cache = storage.scoped('ft_account_v1')
const loginFlag = storage.scoped('ft_logged_in')
const logoutFlag = storage.scoped('ft_logged_out')

let openidPromise = null
// 单飞标签：'userGet'（打卡页会同时触发资料刷新与偏好同步）、'avatar:<fileID>'
const flight = throttle.flight()

// fileID → https 临时链接，缓存 90 分钟，换取失败时回退旧链接。登出必须清，否则切账号会命中他人头像
const AVATAR_CACHE = {}
const AVATAR_TTL = 90 * 60 * 1000

function clearAvatarCache() {
  Object.keys(AVATAR_CACHE).forEach(function (id) { delete AVATAR_CACHE[id] })
  flight.clear()
}

function enabled() {
  return cloud.callable()
}

// 失败不缓存，允许本会话重试
function login() {
  if (!enabled()) return Promise.resolve('')
  if (openidPromise) return openidPromise
  openidPromise = cloud.call('login', 'openid').then(function (res) {
    const openid = (res.ok && res.openid) || ''
    if (!openid) throw new Error('no_openid')
    return openid
  }).catch(function (err) {
    openidPromise = null
    throw err
  })
  return openidPromise
}

function defaultNickname(openid) {
  const id = String(openid || '')
  const tail = id.length > 6 ? id.slice(-6) : id
  return tail || '微信用户'
}

function get() {
  return Object.assign({ nickname: '', avatar: '' }, cache.read({}))
}

// 只有主动一键登录过才算已登录；登出只暂停同步与展示，云端数据保留
function isLoggedIn() {
  if (logoutFlag.read()) return false
  return !!loginFlag.read()
}

function markLoggedIn() {
  loginFlag.write(1)
  logoutFlag.remove()
}

function logout() {
  openidPromise = null
  cache.remove()
  loginFlag.remove()
  logoutFlag.write(1)
  clearAvatarCache() // 顺带作废在飞的 userGet / 头像解析
}

function saveLocal(info) {
  const next = {
    nickname: String((info && info.nickname) || ''),
    avatar: String((info && info.avatar) || ''),
    updatedAt: Date.now()
  }
  cache.write(next)
  return next
}

// 裸读云端用户文档（资料+偏好+自定义计划），失败 resolve null，无副作用
function readCloud() {
  if (!enabled()) return Promise.resolve(null)
  return flight.run('userGet', function () {
    return cloud.call('login', 'userGet').then(function (res) {
      return res.ok ? res : null
    })
  })
}

// 云端无文档（清库/删号）时登出并返回 no_account
function fetchProfile() {
  return readCloud().then(function (res) {
    if (!res || !res.ok) return { ok: false }
    if (res.exists === false) {
      logout()
      return { ok: false, code: 'no_account' }
    }
    const info = saveLocal({ nickname: res.nickname || '', avatar: res.avatar || '' })
    return Object.assign({ ok: true }, info)
  })
}

function saveProfile(info) {
  const payload = {
    nickname: String((info && info.nickname) || '').trim().slice(0, 30),
    avatar: String((info && info.avatar) || '')
  }
  return cloud.call('login', 'profileSet', { profile: payload }).then(function (res) {
    if (!res.ok) return { ok: false, code: res.code || 'save_error' }
    const saved = saveLocal({ nickname: res.nickname, avatar: res.avatar })
    markLoggedIn()
    return Object.assign({ ok: true }, saved)
  })
}

function fileDigest(filePath) {
  return new Promise(function (resolve) {
    wx.getFileSystemManager().getFileInfo({
      filePath: filePath,
      digestAlgorithm: 'md5',
      success: function (res) { resolve((res && res.digest) || '') },
      fail: function () { resolve('') }
    })
  })
}

// 文件名取内容 md5：同图重传覆盖同路径，不重复占位
function uploadAvatar(tempFilePath) {
  if (!enabled() || !tempFilePath) return Promise.resolve({ ok: false })
  return login().then(function (openid) {
    if (!openid) return { ok: false, code: 'no_openid' }
    const ext = String(tempFilePath).match(/\.(png|jpe?g|gif|webp)$/i)
    const suffix = ext ? ext[0].toLowerCase() : '.jpg'
    return fileDigest(tempFilePath).then(function (digest) {
      const cloudPath = 'avatars/' + openid + '/' + (digest || String(Date.now())) + suffix
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

function deleteFile(fileID) {
  const id = String(fileID || '')
  if (!id) return Promise.resolve()
  delete AVATAR_CACHE[id] // 文件已删，顺带失效它的临时链接
  if (!enabled()) return Promise.resolve()
  return wx.cloud.deleteFile({ fileList: [id] }).catch(function () {})
}

// image 组件不认 cloud://，走云函数 fileUrl 换临时链接（顺带绕过存储权限）
function resolveAvatar(fileID) {
  const id = String(fileID || '')
  if (!id) return Promise.resolve('')
  if (id.indexOf('cloud://') !== 0) return Promise.resolve(id)
  if (!enabled()) return Promise.resolve('')

  const cached = AVATAR_CACHE[id]
  if (cached && cached.expireAt > Date.now()) return Promise.resolve(cached.url)

  const fallback = (cached && cached.url) || ''
  return flight.run('avatar:' + id, function () {
    return cloud.call('login', 'fileUrl', { fileList: [id] }).then(function (res) {
      const list = res.fileList || []
      const url = (list[0] && list[0].tempFileURL) || ''
      if (url) AVATAR_CACHE[id] = { url: url, expireAt: Date.now() + AVATAR_TTL }
      return url || fallback
    })
  })
}

// ——— 头像渲染 ———
// 页面用 avatarBehavior()，列表行用 clearAvatarRow()。换链失败一律回退文字头像

// Array.from 而非 slice：emoji 昵称是代理对，slice(0,1) 会切出半个字符
const FALLBACK_CHAR = '练'

function charOf(nickname) {
  const name = String(nickname == null ? '' : nickname).trim()
  return name ? Array.from(name)[0] : FALLBACK_CHAR
}

function createAvatar(apply) {
  let seq = 0 // 换链是异步的，过期结果按 seq 丢弃
  return {
    // 非 cloud://（本地临时图/空值）直接渲染；cloud:// 先清空再异步换链
    show(fileID) {
      const id = String(fileID || '')
      seq += 1
      const current = seq
      if (id.indexOf('cloud://') !== 0) {
        apply(id)
        return
      }
      apply('')
      resolveAvatar(id).then(function (url) {
        if (!url || current !== seq) return
        apply(url)
      }).catch(function () {})
    },

    // binderror（多为链接过期）：作废在飞结果并回退文字头像
    error() {
      seq += 1
      apply('')
    }
  }
}

// 列表行头像失效：清空该行 avatar，落到文字头像
function clearAvatarRow(page, listKey, index) {
  if (index == null) return
  const patch = {}
  patch[listKey + '[' + index + '].avatar'] = ''
  page.setData(patch)
}

// dataKey 是头像字段在 data 里的路径，支持嵌套（'accountInfo.avatar'）
function avatarBehavior(dataKey) {
  return Behavior({
    methods: {
      // onLoad 里最先调用，之后用 showAvatar / onAvatarError
      bindAvatar() {
        const page = this
        this._avatar = createAvatar(function (url) {
          const patch = {}
          patch[dataKey] = url
          page.setData(patch)
        })
      },
      showAvatar(fileID) {
        if (this._avatar) this._avatar.show(fileID)
      },
      onAvatarError() {
        if (this._avatar) this._avatar.error()
      }
    }
  })
}

module.exports = {
  login: login,
  defaultNickname: defaultNickname,
  get: get,
  isLoggedIn: isLoggedIn,
  logout: logout,
  readCloud: readCloud,
  fetchProfile: fetchProfile,
  saveProfile: saveProfile,
  uploadAvatar: uploadAvatar,
  deleteFile: deleteFile,
  charOf: charOf,
  FALLBACK_CHAR: FALLBACK_CHAR,
  clearAvatarRow: clearAvatarRow,
  avatarBehavior: avatarBehavior
}
