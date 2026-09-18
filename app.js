const cloud = require('./utils/cloud.js')
const account = require('./utils/account.js')
const videoCache = require('./utils/video-cache.js')

App({
  onLaunch() {
    // 延后初始化，别阻塞首屏
    setTimeout(function () {
      cloud.init()
      // 已登录用户补一次预热：本地缓存被系统回收后也能自己补齐
      if (account.isLoggedIn()) videoCache.warmup()
    }, 0)
  }
})
