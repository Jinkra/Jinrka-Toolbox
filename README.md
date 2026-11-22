# Jinkra 工具箱

面向 Windows 10/11 x64 的个人工具箱。单个可执行文件自带 Electron 和 FFmpeg，工具处理在本机完成，无需登录或另外安装运行库。检查和下载更新时访问 GitHub。

## 运行

从 [GitHub Releases](https://github.com/Jinkra/Jinrka-Toolbox/releases/latest) 获取便携 EXE，双击即可打开。启动时会把内置组件解压到 Windows 临时目录。首次打开每个版本需要输入激活码，激活记录保存在本机。程序未做数字签名。

微信搜索「都拓文化」或扫描激活页二维码，关注公众号获取激活码。程序默认在启动后检查最新发行版。右上角设置提供手动检查更新、默认工具模式、布局密度、动画及窗口关闭行为。更新支持 GitHub 直连和加速线路，下载前测速，失败时自动切换。校验发布清单签名或 GitHub 官方摘要，再校验完整文件的 SHA-256 后替换当前便携 EXE 并重新启动。

`Ctrl + K` 搜索工具。`Ctrl + Alt + J` 从其他应用唤出窗口。默认使用简单版，右上角可切换到专业版并保留当前输入。点击图钉可切换置顶。关闭窗口会收起到系统托盘，退出应用请用托盘菜单。

## 工具范围

| 分类 | 工具 |
| --- | --- |
| 开发 | JSON 格式化与字段提取、Base64、URL 编解码与参数、Unicode 与 UTF-8、时间戳、命名、正则、哈希、UUID 与雪花 ID、Cron、JWT、进制和字节换算 |
| 文本 | 文本对比、去空行、简繁转换、Markdown、CSV ↔ JSON、文字统计、查找替换、按行排序 |
| 媒体 | 图片压缩裁剪、调色、水印、拼接、图片属性与 GIF。视频压缩剪辑、格式转换、提取音频和抽帧。音频转码、二维码、色值与配色对比度 |
| 文件 | ZIP 压缩解压、文件哈希与属性、批量重命名、PDF 合并拆分、PDF 转图、页面重排、图片转 PDF |
| 效率 | 随机密码、随机抽签、倒计时、秒表、备忘录、剪贴板、单位换算、日期差与百分比计算 |
| AI | 同步 anbeime/skill 合集与 GitHub 收录，安装、扫描和卸载 Skill，一键安装 Codex CLI、Claude Code CLI 和 CC Switch |

视频压缩简单版提供超高、高、中、低四个档位。预计输出大小根据目标码率与时长计算，实际大小随画面变化。专业版可调整码率或 CRF、编码器、帧率、分辨率、音频设置等。

打开 AI Skill 库时同步目录。选择 Codex 或 Claude Code 后可安装包含 `SKILL.md` 的技能目录。在「已安装」中可扫描用户级目录并将 Skill 移到回收站。同步和安装需要联网，CLI 与 CC Switch 的安装需要 Windows WinGet。

## 从源码运行

在 Windows x64 上使用 Node.js 22.12+ 或 Node.js 24。

```powershell
npm ci
npm run desktop
npm run dist
```

首次从源码运行或构建会联网获取 Electron 和 FFmpeg。生成的便携 EXE 在 `release/`。只开发界面时可用 `npm run dev`，文件系统和窗口功能需在桌面应用中使用。

推送与项目版本相同的 `vX.Y.Z` 标签后，GitHub Actions 会用仓库的 `JINKRA_UPDATE_SIGNING_KEY` 密钥签名更新清单，并发布便携 EXE、清单及 SHA-256 校验文件。

参考项目、FFmpeg 源码和许可信息见 [THIRD-PARTY.md](THIRD-PARTY.md)。
