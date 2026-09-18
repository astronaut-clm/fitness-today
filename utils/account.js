// 用户账号：以 openid 为身份，资料存云端 ft_users，本机仅缓存
const cloud = require('./cloud.js')
const storage = require('./storage.js')
const throttle = require('./throttle.js')

const cache = storage.scoped('ft_account_v1')
const loginFlag = storage.scoped('ft_logged_in')
const logoutFlag = storage.scoped('ft_logged_out')

let openidPromise = null
// 云请求单飞：
//   'userGet'    打卡页会同时触发「资料刷新」与「偏好同步」，合并成一次云往返
//   'avatar:<id>' 打卡页与账号页可能同时渲染同一个头像
const flight = throttle.flight()

// fileID → https 临时链接内存缓存 90 分钟，换取失败回退旧链接。
// 只解析当前用户自己的头像，键数量天然有限；登出时清空，避免切换账号命中他人头像
const AVATAR_CACHE = {}
const AVATAR_TTL = 90 * 60 * 1000

function clearAvatarCache() {
  Object.keys(AVATAR_CACHE).forEach(function (id) { delete AVATAR_CACHE[id] })
  flight.clear()
}

function enabled() {
  return cloud.callable()
}

// openid 内存缓存；失败不缓存，允许本会话重试
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

// 只有主动一键登录过才算已登录；登出仅暂停同步与展示，云端数据保留
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
  // 头像临时链接有 90 分钟 TTL，不清的话同设备切换账号可能命中他人头像；
  // 顺带作废在飞的 userGet / 头像解析
  clearAvatarCache()
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

// 裸读云端用户文档（userGet：资料+偏好+自定义计划），失败 resolve null，无副作用。
// 同一 tick 内的并发调用共用一次云请求（单飞），成功失败都放行下一次
function readCloud() {
  if (!enabled()) return Promise.resolve(null)
  return flight.run('userGet', function () {
    return cloud.call('login', 'userGet').then(function (res) {
      return res.ok ? res : null
    })
  })
}

// 拉取云端资料并写本地缓存；云端无文档（清库/删号）时登出并返回 no_account
function fetchProfile() {
  return readCloud().then(function (res) {
    if (!res) return { ok: false }
    const hasDoc = Number(res.updatedAt || 0) > 0 || !!res.nickname || !!res.avatar
    if (!hasDoc) {
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

// 文件名取内容 md5，同图重传覆盖同路径，避免重复占位
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
  // 文件已删，顺带失效它的临时链接缓存
  delete AVATAR_CACHE[id]
  if (!enabled()) return Promise.resolve()
  return wx.cloud.deleteFile({ fileList: [id] }).catch(function () {})
}

// fileID → https 临时链接（image 组件不能用 cloud://），走云函数 fileUrl 绕过存储权限；
// 缓存与单飞状态见文件顶部
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

// ——— 头像渲染助手 ———
// cloud:// 换临时 https 链接 + seq 防过期覆盖 + 失败回退文字头像。
// 页面直接用 avatarBehavior()（把创建与 binderror 回退都收进去）；列表行用 clearAvatarRow()
// apply(url) 由页面实现（setData 写头像字段，空串即回退文字头像）

// 文字头像的首字：昵称首字符，空则兜底。
// Array.from 而非 slice：emoji 昵称是代理对，slice(0,1) 会切出半个字符
const FALLBACK_CHAR = '练'

function charOf(nickname) {
  const name = String(nickname == null ? '' : nickname).trim()
  return name ? Array.from(name)[0] : FALLBACK_CHAR
}

function createAvatar(apply) {
  let seq = 0
  return {
    // 非 cloud://（本地临时图/空值）直接渲染；cloud:// 先清空再异步换链，过期结果丢弃
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

    // image binderror（如临时链接过期）：作废旧结果并回退文字头像
    error() {
      seq += 1
      apply('')
    }
  }
}

// 列表行头像失效回退：清空该行 avatar，落到文字头像
function clearAvatarRow(page, listKey, index) {
  if (index == null) return
  const patch = {}
  patch[listKey + '[' + index + '].avatar'] = ''
  page.setData(patch)
}

// 页面侧样板：创建助手 + 统一 binderror 回退，省掉每个页面重复的一份接线。
// dataKey 是头像字段在 data 中的路径，支持嵌套（'avatarUrl' / 'accountInfo.avatar'）
function avatarBehavior(dataKey) {
  return Behavior({
    methods: {
      // 在 onLoad 里最先调用：之后用 showAvatar / onAvatarError 即可
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
      // image binderror（如临时链接过期）：作废旧结果并回退文字头像
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
