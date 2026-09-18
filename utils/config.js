// 云开发配置。ENABLE_CLOUD 置 false 即降级为纯本地；CLOUD_ENV 多环境时必填。
//
// assets/ 已被 packOptions.ignore 排除（不进代码包），这两个 https 直链是运行时资源的唯一来源：
// 1. CDN 域名必须加进小程序后台的 downloadFile 白名单，真机才拉得到。
//    开发者工具的 urlCheck:false 只对工具生效，不算真机已验证。
// 2. REPO_REF 必须锁定 SHA 或 tag：用 @master 会随仓库漂移，已发布的旧版本会拉到不匹配的资源。
//    改了 assets/ 里任何文件 → 提交推到 origin → 把 REPO_REF 换成新的 SHA/tag。
// 换自有 CDN 或云存储时只改 REPO_REF 与 CDN_BASE。

// 当前锁定 3.8.0
const REPO_REF = 'de891dad83419dd09361491aebe115520117f7b0'
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@' + REPO_REF + '/assets/'

module.exports = {
  ENABLE_CLOUD: true,
  CLOUD_ENV: '',
  ACTION_VIDEO_PREFIX: CDN_BASE + 'videos/'
}
