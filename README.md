# 今天练了吧（fitness-today）

8-bit 像素风的微信小程序健身打卡应用：挑计划 → 跟练 → 打卡记录。

## 功能

- **今日主页**：推荐训练计划、连续打卡天数与本月训练概览，一键开始跟练。
- **训练计划**：居家 / 健身房两种场景，按等级浏览，查看动作构成与详情；支持自定义计划。
- **AI跟练**：按组循环推进动作与组数，结束后自动记录本次训练时长。
- **打卡记录**：日历视图查看每日训练，同一天支持多次训练。
- **动作库**：标准动作教学，含动作要点、步骤、节奏、常见错误与简化替代。
- **排行榜**：按月累计训练时长排名，展示「我的名次」。
- **我的账号**：微信登录、个人资料与每周目标设置，训练记录可云端同步。

## 使用方法

1. 首次进入：在引导页选择目标、场景与经验，生成推荐训练偏好。
2. 挑计划：在「训练计划」中按场景和等级选择，或自己创建自定义计划。
3. 开始跟练：进入计划详情，点击开始，按提示逐组完成动作。
4. 记录打卡：跟练结束后自动生成记录。
5. 查看与社交：在「动作库」学习标准动作，在排行榜比名次。
6. 账号：登录后个人资料与训练记录可同步到云端，换设备不丢数据。

## 目录结构

```
app.js / app.json / app.wxss   全局入口、页面与组件注册、设计变量与共用样板
assets/                        静态资源（动作演示 videos），不进代码包，运行时走 CDN
cloudfunctions/                云函数：login（身份与个人数据）、social（月榜聚合）
components/                    复用 UI：navigation-bar、px-toast、px-dialog
                               prefs-form 是模板三件套（mixin + import 的 wxml + 全局 wxss），不是自定义组件
custom-tab-bar/                自定义 tabBar，tab 清单来自 utils/nav.js
databases/                     静态数据：动作库 actions、计划库 plans（场景与难度档位的唯一定义处）
pages/                         页面（每个页面一个目录）
                               组件统一在 app.json 全局注册，页面 .json 只留空的 {}——
                               页面缺少 .json 文件会导致该页不被注册（报 has not been
                               registered yet，并连带把组件解析成 wx://not-found），别删
utils/
  config storage cloud date    配置、本机存储（scoped 句柄）、云调用、日期
  throttle device              限频与单飞、设备信息兼容层
  toast nav                    页内提示、tabBar 清单与登录门禁
  video-cache                  动作演示视频本地缓存，登录后全量预热
  account login profile        账号资料与头像、登录编排与引导标记、训练偏好
  records insights             训练记录持久化+云端同步、统计洞察
  recommend                    规则推荐打分
  custom-plans plan-adjustments exercise-item    自定义计划、计划微调、动作条目
  workout/  groups session finish voice lines tts    计划→训练组、断点恢复、完成收尾、播报
  ai/       client recommend weekly coach-profile    大模型网关、AI 推荐、周复盘、长期画像
```

## License

[MIT](./LICENSE)
