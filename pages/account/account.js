// pages/account/account.js 个人设置（头像昵称）
// 使用微信「头像昵称填写能力」：头像走 chooseAvatar、昵称走 nickname 输入框。
// 资料最终按 openid 写入云端 ft_users（经 login 云函数），保证换机可恢复。
const account = require('../../utils/account.js')
const store = require('../../utils/store.js')
const sessionStore = require('../../utils/workout-session.js')
const profile = require('../../utils/profile.js')
const adjustments = require('../../utils/plan-adjustments.js')
const customPlans = require('../../utils/custom-plans.js')
const onboarding = require('../../utils/onboarding.js')
const font = require('../../utils/font.js')
const toast = require('../../utils/toast.js')

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
    savingShow: false
  },

  goPrefs() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  goCustomPlans() {
    wx.navigateTo({ url: '/pages/custom-plan/custom-plan' })
  },

  // 返回个人设置时刷新自定义计划状态提示与字体选择。
  onShow() {
    this.refreshCustomHint()
    this.refreshFont()
    this.syncCustomPlans()
  },

  refreshFont() {
    this.setData({ usePixelFont: font.getChoice() === 'pixel' })
  },

  // 像素字体开关：开启可即时生效；关闭需重启小程序（已加载的像素字体无法卸载）。
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

  // 已登录时与云端收敛自定义计划，换机/他端改动可见。
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

  // 退出登录：页内确认弹层。
  onLogout() {
    this.setData({ showLogoutConfirm: true })
  },

  onCancelLogout() {
    this.setData({ showLogoutConfirm: false })
  },

  // 确认后清空本机训练记录与个人偏好/调整并暂停云端同步；
  // 云端数据保留，同一微信再次登录时自动拉回。
  onConfirmLogout() {
    this.setData({ showLogoutConfirm: false })
    account.logout()
    store.clearLocal()
    sessionStore.clear()
    profile.resetLocal()
    adjustments.resetLocal()
    customPlans.resetLocal()
    onboarding.resetLocal()
    toast.back('已退出，记录已清空')
  },

  noop() {},

  onLoad() {
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

  // 云头像存的是文件 ID（cloud://），部分环境 image 组件无法直接加载，
  // 统一换成临时 https 链接再渲染；非云文件（用户刚选的本地临时图）直接用。
  showAvatar(fileID) {
    const id = String(fileID || '')
    const seq = (this._avatarSeq || 0) + 1
    this._avatarSeq = seq
    if (id.indexOf('cloud://') !== 0) {
      this.setData({ avatarUrl: id })
      return
    }
    this.setData({ avatarUrl: '' })
    account.resolveAvatar(id).then((url) => {
      // 换链期间可能已选新头像，丢弃过期结果。
      if (!url || seq !== this._avatarSeq) return
      this.setData({ avatarUrl: url })
    }).catch(() => {})
  },

  // 头像加载失败（如临时链接过期）：回退文字头像，避免破图。
  onAvatarError() {
    this._avatarSeq = (this._avatarSeq || 0) + 1
    this.setData({ avatarUrl: '' })
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
        toast.show('已保存', { success: true })
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
