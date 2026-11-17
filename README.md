# Quick Photo：拍完即传

## 架构说明

- **Android 客户端（`app/`）**：Kotlin + Jetpack Compose 应用，支持普通相机拍摄、ML Kit 文档扫描增强、预览与交互式矩形裁剪、局域网 UDP 自动发现（端口 `45879`）、双向剪贴板互传、长轮询接收服务端文件、本地照片保留及 GitHub Release 在线更新。
- **Windows / 跨平台服务端与 Web 控制台（`server.ts` + `server-lib/` + `src/`）**：基于 Node.js + Express + React 构建，监听 `0.0.0.0:3000` 与 UDP `45879`，接收来自 Android 客户端的拍照/文档/文件上传，支持自动将上传图片写入 Windows 系统剪贴板、双向剪贴板管理以及向在线 Android 设备定向推送文件。

## Windows 服务端运行

```powershell
npm install
npm run dev
```

或生产模式启动：

```powershell
npm run build
npm run start
```

Windows 剪贴板图片复制通过 `powershell.exe -NoProfile -NonInteractive -STA -EncodedCommand` 将图片读入 `MemoryStream` 并克隆为 `System.Drawing.Bitmap` 后，调用 `Clipboard.SetDataObject($bmp, $true, 10, 150)` 写入，避免路径转义、文件锁与剪贴板短暂占用导致的失败。

## Android 客户端构建

```bash
gradle :app:assembleDebug
```

调试 APK 输出位于 `app/build/outputs/apk/debug/app-debug.apk`。完整工具链版本、环境变量与测试/安装指令见 [`docs/android-build-toolchain.md`](docs/android-build-toolchain.md)。
