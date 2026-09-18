// 云开发配置
// ENABLE_CLOUD：云同步总开关，置 false 即降级为纯本地
// CLOUD_ENV：云开发环境 ID，单环境可留空，多环境必填
//
// ACTION_VIDEO_PREFIX / FONT_URL：演示视频与像素字体的 https 直链
// 本地 assets/ 已被 project.config.json 的 packOptions.ignore 排除（不进代码包），
// 因此这两个地址是运行时资源的唯一来源，注意两点：
// 1. 必须在小程序后台把 CDN 域名加入 downloadFile 合法域名白名单，真机才拉得到。
//    开发者工具的 urlCheck:false 只对工具生效，不能作为真机已验证的依据。
// 2. REPO_REF 必须锁定到固定 commit SHA 或 tag，不能用 @master：master 会随仓库更新漂移，
//    已发布的旧版本小程序会拉到与它不匹配的资源。
//    改了 assets/ 里的任何文件 → 提交并推到 origin → 把 REPO_REF 换成新的 SHA/tag。
// 迁移到自有 CDN 或微信云存储时，只需改 REPO_REF 与 CDN_BASE 两处。

// 当前锁定：3.8.0（assets/ 的内容以这个提交为准）
const REPO_REF = 'de891dad83419dd09361491aebe115520117f7b0'
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@' + REPO_REF + '/assets/'

module.exports = {
  ENABLE_CLOUD: true,
  CLOUD_ENV: '',
  ACTION_VIDEO_PREFIX: CDN_BASE + 'videos/',
  FONT_URL: CDN_BASE + 'fonts/zpix.woff2'
}
