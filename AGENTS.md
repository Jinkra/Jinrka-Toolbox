# Jinkra 工具箱协作说明

所有用户可见回复使用中文。保持 Windows 单文件安装包和浅色界面。

用户要求每次项目更新都上传到 `origin`（`Jinkra/Jinrka-Toolbox`）。验证更新后提交并推送到 GitHub。交付新 EXE 时更新 `package.json` 与锁文件中的版本，并推送同名 `vX.Y.Z` 标签。版本标签触发 GitHub Actions 构建并发布 Windows 安装包。
