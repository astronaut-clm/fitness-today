// 云开发配置
// ENABLE_CLOUD：云同步总开关，置 false 即降级为纯本地
// CLOUD_ENV：云开发环境 ID，单环境可留空，多环境必填
// FONT_URLS：像素字体 https 直链列表，按序回退，留空则用系统字体；
//   要求 https 且支持跨域，字体文件已从打包中排除（packOptions.ignore）
// FONT_FAMILY：注册给 wx.loadFontFace 的字体名，需与 app.wxss 的 font-family 首项一致
// 动作演示资源（详情页）：真机 <image> 只解 GIF 首帧、不播动画，故优先播放 MP4，GIF 仅作视频加载失败时的兜底
//   两者均为 https 直链前缀（以 / 结尾），分别拼 '<id>.mp4' / '<id>.gif' 得到完整地址；都留空则不展示演示动画
//   对应目录已由 packOptions.ignore 排除打包，不占小程序包体积
// ACTION_CDN_PREFIX：演示动图（GIF）前缀
//   例：'https://cdn.jsdelivr.net/gh/<user>/<repo>@master/assets/actions/'
// ACTION_VIDEO_PREFIX：演示视频前缀，由 assets/actions 下的 gif 转码而来（H.264/yuv420p/faststart，10fps 还原原帧节奏）
//   例：'https://cdn.jsdelivr.net/gh/<user>/<repo>@master/assets/videos/'
module.exports = {
  ENABLE_CLOUD: true,
  CLOUD_ENV: '',
  ACTION_CDN_PREFIX: 'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@master/assets/actions/',
  ACTION_VIDEO_PREFIX: 'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@master/assets/videos/',
  FONT_URLS: [
    'https://cdn.jsdelivr.net/gh/astronaut-clm/fitness-today@master/assets/fonts/zpix.woff2'
  ],
  FONT_FAMILY: 'Zpix'
}
