// 个人设置：头像走 chooseAvatar、昵称走 nickname 输入框，资料按 openid 写入云端 ft_users
const account = require('../../utils/account.js')
const customPlans = require('../../utils/custom-plans.js')
const feed = require('../../utils/feed.js')
const login = require('../../utils/login.js')
const font = require('../../utils/font.js')
const toast = require('../../utils/toast.js')
const avatarView = require('../../utils/avatar.js')

function charOf(nickname) {
  const name = (nickname || '').trim()
  return name ? name.slice(0, 1) : '练'
}

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    avatarChar: '练',
    customHint: '',
    usePixelFont: false,
    showLogoutConfirm: false,
    savingShow: false,
    isAdmin: false
  },

  goPrefs() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  goCustomPlans() {
    wx.navigateTo({ url: '/pages/custom-plan/custom-plan' })
  },

  // 举报审核入口仅管理员可见。
  goAdminReport() {
    wx.navigateTo({ url: '/pages/admin-report/admin-report' })
  },

  onShow() {
    this.refreshCustomHint()
    this.refreshFont()
    this.syncCustomPlans()
    this.checkAdmin()
  },

  checkAdmin() {
    feed.adminCheck().then((res) => {
      this.setData({ isAdmin: !!(res && res.isAdmin) })
    }).catch(() => {})
  },

  refreshFont() {
    this.setData({ usePixelFont: font.getChoice() === 'pixel' })
  },

  // 像素字体开启即时生效；关闭需重启小程序（已加载字体无法卸载）。
  onTogglePixelFont(e) {
    const on = !!(e.detail && e.detail.value)
    font.setChoice(on ? 'pixel' : 'system')
    this.setData({ usePixelFont: on })
    if (on) {
      font.load()
    } else {
      toast.show('重启小程序后生效')
    }
  },

  syncCustomPlans() {
    if (!account.isLoggedIn()) return
    customPlans.syncFromCloud().then((res) => {
      if (res && res.ok) this.refreshCustomHint()
    }).catch(() => {})
  },

  refreshCustomHint() {
    const parts = []
    if (customPlans.has('home')) parts.push('居家')
    if (customPlans.has('gym')) parts.push('健身房')
    this.setData({ customHint: parts.length ? '已设置：' + parts.join(' · ') : '自由组合动作，设置你的专属计划' })
  },

  onLogout() {
    this.setData({ showLogoutConfirm: true })
  },

  onCancelLogout() {
    this.setData({ showLogoutConfirm: false })
  },

  // 清空本机数据并暂停同步，云端保留，同一微信再登录时自动拉回。
  onConfirmLogout() {
    this.setData({ showLogoutConfirm: false })
    login.resetSession()
    wx.navigateBack({ fail: function () {} })
  },

  noop() {},

  onLoad() {
    this._avatar = avatarView.create((url) => this.setData({ avatarUrl: url }))
    const info = account.get()
    this._remoteAvatar = info.avatar
    this._savedNickname = info.nickname
    this._avatarChanged = false
    this.setData({
      nickname: info.nickname,
      avatarChar: charOf(info.nickname)
    })
    this.showAvatar(info.avatar)
    // 进入时从云端刷新一次，换机场景也能取回资料。
    account.fetchProfile().then((res) => {
      // 云端账号不存在（清库/删号）：清理本地数据并退回上一页。
      if (res && res.code === 'no_account') {
        login.resetLocalData()
        toast.back('账号已失效，请重新登录')
        return
      }
      if (!res || !res.ok) return
      this._remoteAvatar = res.avatar
      this._savedNickname = res.nickname
      this.setData({
        nickname: res.nickname,
        avatarChar: charOf(res.nickname)
      })
      this.showAvatar(res.avatar)
    })
  },

  // 云头像存的是 fileID（cloud://），统一换临时 https 链接再渲染；本地临时图直接用。
  showAvatar(fileID) {
    this._avatar.show(fileID)
  },

  // 头像加载失败（如临时链接过期）：回退文字头像，避免破图。
  onAvatarError() {
    this._avatar.error()
  },

  onChooseAvatar(e) {
    const tempUrl = (e.detail && e.detail.avatarUrl) || ''
    if (!tempUrl) return
    this._avatarChanged = true
    this.showAvatar(tempUrl)
    this.autoSave()
  },

  onNicknameInput(e) {
    this.setData({ nickname: (e.detail && e.detail.value) || '' })
  },

  // 无保存按钮：昵称失焦或头像变更后自动写云端，改动即时生效。
  onNicknameBlur(e) {
    const nickname = ((e.detail && e.detail.value) || '').trim()
    this.setData({ nickname: nickname, avatarChar: charOf(nickname) })
    this.autoSave()
  },

  autoSave() {
    if (this._savingAuto) {
      this._pendingAutoSave = true
      return
    }
    const nickname = (this.data.nickname || '').trim()
    const avatarChanged = this._avatarChanged && !!this.data.avatarUrl
    const nicknameChanged = nickname !== this._savedNickname
    if (!avatarChanged && !nicknameChanged) return
    if (!nickname) {
      toast.show('昵称不能为空')
      return
    }

    this._savingAuto = true
    if (avatarChanged) {
      this._loadingOn = true
      this.setData({ savingShow: true })
    }
    const ready = avatarChanged
      ? account.uploadAvatar(this.data.avatarUrl)
      : Promise.resolve({ ok: true, fileID: this._remoteAvatar || '' })

    ready.then((uploadRes) => {
      if (!uploadRes || !uploadRes.ok) {
        this._finishAutoSave()
        toast.show('头像上传失败，请重试')
        return
      }
      const nextAvatar = uploadRes.fileID || ''
      return account.saveProfile({ nickname: nickname, avatar: nextAvatar }).then((res) => {
        this._finishAutoSave()
        if (!res || !res.ok) {
          toast.show('保存失败：请确认已部署 login 云函数并创建 ft_users 集合')
          return
        }
        // 头像已更换时清理云端旧文件，避免积累。
        if (nextAvatar && this._remoteAvatar && nextAvatar !== this._remoteAvatar) {
          account.deleteFile(this._remoteAvatar)
        }
        this._remoteAvatar = nextAvatar
        this._savedNickname = nickname
        this._avatarChanged = false
      })
    }).catch(() => {
      this._finishAutoSave()
      toast.show('保存失败，请重试')
    })
  },

  _finishAutoSave() {
    this._savingAuto = false
    if (this._loadingOn) {
      this._loadingOn = false
      this.setData({ savingShow: false })
    }
    if (this._pendingAutoSave) {
      this._pendingAutoSave = false
      this.autoSave()
    }
  }
})
