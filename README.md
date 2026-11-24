<div align="center">

<img src="assets/icon.png" width="128" height="128" alt="小金工具箱">

# 小金工具箱

住在 Windows 上的离线百宝箱 · 开发 / 文本 / 媒体 / 文件 / AI / 系统工具一站集成

[![下载最新版](https://img.shields.io/github/v/release/Jinkra/XJ-Toolbox?label=%E4%B8%8B%E8%BD%BD&color=1f6feb)](https://github.com/Jinkra/XJ-Toolbox/releases/latest)
![平台](https://img.shields.io/badge/Windows-10%20%2F%2011%20x64-0078d4)

</div>

面向 Windows 10/11 x64 的个人工具箱。单个可执行文件自带 Electron 和 FFmpeg，工具处理在本机完成，无需登录或另外安装运行库。检查和下载更新时访问 GitHub。

## 运行

从 [GitHub Releases](https://github.com/Jinkra/XJ-Toolbox/releases/latest) 获取 Windows x64 安装包，选择目录并完成安装，然后从开始菜单打开工具箱。从旧便携版迁移时，请先运行一次安装包。首次打开每个版本需要输入激活码，激活记录保存在本机。程序未做数字签名。

微信搜索「都拓文化」或扫描激活页二维码，关注公众号获取激活码。程序默认在启动后检查最新发行版。右上角设置提供手动检查更新、默认工具模式、布局密度、动画及窗口关闭行为。检查和下载支持 GitHub 直连及加速线路。更新弹窗显示发布备注，下载前测速，失败时自动切换。校验发布清单签名和完整文件的 SHA-256 后，在原安装目录更新并重新启动。见[激活与发布保护](docs/activation-security.md)。

`Ctrl + K` 搜索工具。`Ctrl + Alt + J` 从其他应用唤出窗口。默认使用简单版，右上角可切换到专业版并保留当前输入。点击图钉可切换置顶。关闭窗口会收起到系统托盘，退出应用请用托盘菜单。

设置里的「开机自启」会在 Windows 登录后启动已安装的工具箱并进入托盘。

在 Windows 设置的「已安装的应用」中卸载工具箱，会打开卸载向导。默认保留本地用户数据。取消勾选「保留用户数据」后，向导会清除本地设置、日程和激活记录等工具箱数据。

## 工具范围

| 分类 | 工具 |
| --- | --- |
| 开发 | JSON 格式化与字段提取、Base64、URL 编解码与参数、Unicode 与 UTF-8、时间戳、命名、正则、哈希、UUID 与雪花 ID、Cron、JWT、进制和字节换算 |
| 文本 | 文本对比、去空行、简繁转换、Markdown、CSV ↔ JSON、文字统计、查找替换、按行排序 |
| 媒体 | 图片压缩裁剪、调色、水印、拼接、图片属性与 GIF。视频压缩剪辑、格式转换、提取音频和抽帧。音频转码、二维码、色值与配色对比度 |
| 文件 | ZIP 压缩解压、文件哈希与属性、批量重命名、PDF 合并拆分、PDF 转图、页面重排、图片转 PDF |
| 效率 | 日程表与通知、随机密码、随机抽签、倒计时、秒表、备忘录、剪贴板、单位换算、日期差与百分比计算 |
| AI | 双语 Skill 库、AI 工具安装、提示词模板、上下文打包、OpenAI 兼容 API 连通性测试 |
| 系统 | 内存释放、系统盘清理、系统信息、快捷方式箭头、DLL 缺失检查、运行库安装和 SFC 修复 |

视频压缩简单版提供超高、高、中、低四个档位。预计输出大小根据目标码率与时长计算，实际大小随画面变化。专业版可调整码率或 CRF、编码器、帧率、分辨率、音频设置等。

打开 AI Skill 库时自动同步目录，并为浏览到的公开 Skill 加载原文简介和中文译文。翻译需要联网，成功的译文会在本地缓存。选择 Codex 或 Claude Code 后可安装包含 `SKILL.md` 的技能目录。在「已安装」中可扫描用户级目录并将 Skill 移到回收站。标有一键安装的 AI 应用需要 Windows WinGet 或 Microsoft Store。

日程表在本地保存提醒。可选择普通 Windows 通知、手动关闭的持续通知或打开工具箱的强力弹窗，Windows 通知不可用时会尽量使用右下角应用通知。保持工具箱在托盘运行即可按时提醒，恢复运行后会补发已到期的日程。

DLL 工具检查选中 EXE 的静态导入和常见搜索位置，也可以粘贴报错文本。匹配到 Visual C++ 时可通过 WinGet 安装，旧版 DirectX 组件提供 Microsoft 官方下载入口。快捷方式箭头和 SFC 操作需要 Windows 管理员授权。

## 从源码运行

在 Windows x64 上使用 Node.js 22.12+ 或 Node.js 24。

```powershell
npm ci
npm run desktop
npm run dist
```

首次从源码运行或构建会联网获取 Electron 和 FFmpeg。生成的 Windows 安装包在 `release/`。只开发界面时可用 `npm run dev`，文件系统和窗口功能需在桌面应用中使用。

推送与项目版本相同的 `vX.Y.Z` 标签后，GitHub Actions 会用仓库的 `JINKRA_UPDATE_SIGNING_KEY` 密钥签名更新清单和发布备注，并发布 Windows 安装包及 SHA-256 校验文件。

参考项目、FFmpeg 源码和许可信息见 [THIRD-PARTY.md](THIRD-PARTY.md)。
