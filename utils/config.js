// 云开发配置
// ENABLE_CLOUD：云同步总开关，置 false 即降级为纯本地
// CLOUD_ENV：云开发环境 ID，单环境可留空，多环境必填
// ACTION_VIDEO_PREFIX：演示视频 https 直链前缀，拼 '<id>.mp4' 得到完整地址
// FONT_URLS：像素字体 https 直链，留空则用系统字体
module.exports = {
  ENABLE_CLOUD: true,
  CLOUD_ENV: '',
  ACTION_VIDEO_PREFIX: 'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@master/assets/videos/',
  FONT_URLS: 'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@master/assets/fonts/zpix.woff2'
}
