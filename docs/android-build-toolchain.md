# Android App 编译工具链与常用指令

本文档记录 `Quick Photo` Android 客户端（`app/` 模块）的编译工具链版本、环境变量与常用构建/测试/安装指令。

## 1. 编译工具链版本

| 组件 | 版本 / 配置 | 说明 |
|---|---|---|
| **JDK** | OpenJDK 21（Temurin 21）运行 Gradle；`jvmToolchain(17)`、`sourceCompatibility / targetCompatibility = VERSION_17` | 需安装 JDK 17 或 JDK 21 |
| **Gradle** | `9.3.1` | 仓库含 Gradle Wrapper 时优先使用 `./gradlew` / `.\gradlew.bat` |
| **Android Gradle Plugin (AGP)** | `9.1.1` | 定义于 `gradle/libs.versions.toml` |
| **Kotlin / Compose Compiler** | `2.3.20` | 启用 Compose Compiler 与 Kotlin Serialization 插件 |
| **Android SDK** | `compileSdk = 36`、`targetSdk = 36`、`minSdk = 26` | 需安装 `platforms;android-36` 与 `build-tools;36.0.0` |
| **主要依赖库** | Compose BOM `2026.03.01`、Navigation3 `1.0.1`、OkHttp `4.12.0`、ML Kit Document Scanner `16.0.0` | 配置于 `gradle/libs.versions.toml` |

---

## 2. 环境变量配置

### Windows (PowerShell)

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
```

### Linux / macOS (Bash/Zsh)

```bash
export JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-amd64
export ANDROID_HOME=/opt/android/sdk   # 或 $HOME/Android/Sdk
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

---

## 3. 编译与检查指令

> 若项目根目录包含 Gradle Wrapper，请将命令中的 `gradle` 替换为 `./gradlew`（Linux/macOS）或 `.\gradlew.bat`（Windows）。

### 构建 Debug APK

```bash
gradle :app:assembleDebug
```

- **产物路径**：`app/build/outputs/apk/debug/app-debug.apk`
- Debug 包会启用 `BuildConfig.DEBUG`，主界面显示「调试日志」入口。

### 构建 Release APK

```bash
gradle :app:assembleRelease
```

- **未配置签名环境变量时**：产物为 `app/build/outputs/apk/release/app-release-unsigned.apk`。
- **配置 CI / 发布签名环境变量时**（`app/build.gradle.kts` 自动读取）：
  - `RELEASE_STORE_FILE`：keystore 文件路径
  - `RELEASE_STORE_PASSWORD`：keystore 密码
  - `RELEASE_KEY_ALIAS`：密钥别名
  - `RELEASE_KEY_PASSWORD`：密钥密码
- 签名产物路径：`app/build/outputs/apk/release/app-release.apk`。

### 单元测试与 Lint 检查

```bash
# 运行本地 JVM 单元测试（如 ServerConfigTest）
gradle :app:testDebugUnitTest

# 运行 Android Lint 静态检查
gradle :app:lintDebug

# 仅验证 Kotlin/Java 编译（不打包 APK）
gradle :app:compileDebugKotlin

# 清理构建缓存
gradle clean
```

- **离线构建**（依赖已缓存时加速）：在命令后追加 `--offline`。
- **Lint 报告路径**：`app/build/reports/lint-results-debug.html`。

---

## 4. 真机 / 模拟器安装与调试

```bash
# 查看已连接设备
adb devices

# 安装并覆盖已有 Debug APK
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 启动应用主界面
adb shell am start -n com.example.quickphoto/.MainActivity

# 查看应用日志
adb logcat -s QuickPhoto
```

---

## 5. 联调提示（Android 客户端 + Windows 服务端）

1. 在 Windows 端运行服务端（默认监听 `0.0.0.0:3000` 与 UDP `45879`）：
   ```powershell
   npm install
   npm run dev
   ```
2. **模拟器**：应用内服务器地址填 `10.0.2.2`，端口 `3000`。
3. **局域网真机**：确保手机与 Windows 主机处于同一局域网，可在 App 主页点击「自动发现局域网服务器」，或在设置中填写 Windows 主机的局域网 IP 与端口 `3000`；Windows 防火墙需放行 TCP `3000` 与 UDP `45879`。
