// 个人设置：头像走 chooseAvatar、昵称走 nickname 输入框，资料按 openid 写云端
const account = require('../../utils/account.js')
const customPlans = require('../../utils/custom-plans.js')
const profile = require('../../utils/profile.js')
const login = require('../../utils/login.js')
const font = require('../../utils/font.js')
const fontBehavior = font.behavior
const toast = require('../../utils/toast.js')

// emoji 昵称的代理对问题在 account.charOf 里处理
const charOf = account.charOf

Page({
  behaviors: [fontBehavior, account.avatarBehavior('avatarUrl')],

  data: {
    nickname: '',
    avatarUrl: '',
    avatarChar: account.FALLBACK_CHAR,
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

  onShow() {
    this.refreshCustomHint()
    this.refreshFont()
    this.syncCustomPlans()
  },

  refreshFont() {
    this.setData({ usePixelFont: font.getChoice() === 'pixel' })
  },

  // 改页面根节点字体栈即时生效，无需重启
  onTogglePixelFont(e) {
    const on = !!(e.detail && e.detail.value)
    font.setChoice(on ? 'pixel' : 'system')
    this.setData({ usePixelFont: on, fontStyle: font.pageStyle() })
    if (on) font.load()
  },

  // 用 syncPull 而非 syncFromCloud：它自带限频，否则每次从子页返回都打一次 userGet
  syncCustomPlans() {
    if (!account.isLoggedIn()) return
    return profile.syncPull(this, {
      key: '_lastCloudSyncAt',
      onChange: () => this.refreshCustomHint()
    })
  },

  refreshCustomHint() {
    const parts = customPlans.customSceneNames()
    this.setData({ customHint: parts.length ? '已设置：' + parts.join(' · ') : '自由组合动作，设置你的专属计划' })
  },

  onLogout() {
    this.setData({ showLogoutConfirm: true })
  },

  onCancelLogout() {
    this.setData({ showLogoutConfirm: false })
  },

  // 清本机并暂停同步；云端保留，同一微信再登录自动拉回
  onConfirmLogout() {
    this.setData({ showLogoutConfirm: false })
    login.resetSession()
    wx.navigateBack({ fail: function () {} })
  },

  noop() {},

  onLoad() {
    this.bindAvatar()
    const info = account.get()
    this._remoteAvatar = info.avatar
    this._savedNickname = info.nickname
    this._avatarChanged = false
    this.setData({
      nickname: info.nickname,
      avatarChar: charOf(info.nickname)
    })
    this.showAvatar(info.avatar)
    // 进设置页就该看到云端最新值，不受水位限制
    login.refreshAccount(this, {
      force: true,
      onProfile: (res) => {
        this._remoteAvatar = res.avatar
        this._savedNickname = res.nickname
        this.setData({
          nickname: res.nickname,
          avatarChar: charOf(res.nickname)
        })
        this.showAvatar(res.avatar)
      },
      onGone: () => toast.back('账号已失效，请重新登录')
    }).then((res) => {
      // 本地资料还在、不影响编辑，但要让用户知道这可能不是最新值
      if (res.code === 'failed') toast.show('云端资料读取失败，显示的可能不是最新')
    })
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

  // 没有保存按钮：昵称失焦或头像变更后自动写云端
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
          // 保存失败时刚上传的头像会成为孤儿文件，清掉（同图同 md5 时除外）
          if (avatarChanged && nextAvatar && nextAvatar !== this._remoteAvatar) {
            account.deleteFile(nextAvatar)
          }
          toast.show('保存失败：请确认已部署 login 云函数并创建 ft_users 集合')
          return
        }
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
