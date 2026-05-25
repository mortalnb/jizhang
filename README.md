# 记账

一个移动端优先的 AI 记账应用，基于 React、TypeScript、Vite、Tailwind CSS 和 Capacitor Android 构建。

## 功能概览

- **仪表盘**：查看月度预算、周度趋势、分类排行、饼状图和每日花费日历。
- **智能洞察**：本地统计兜底；当数据足够且已配置 API Key 时，接入大模型生成月度对比、分类变化、预算建议和异常消费分析。
- **AI 记账**：支持自然语言输入，未配置 API Key 时使用本地规则解析。
- **截图拆单**：支持盒马鲜生、淘宝/天猫截图的来源识别和专用规则拆单，并允许手动切换来源重新解析。
- **账单明细**：支持搜索、分类筛选、展开详情、单条删除和批量管理。
- **高级设置**：配置 API Key、Base URL、模型名称、月度预算和自定义分类。
- **Android 打包**：通过 Capacitor 生成 Android APK。

## 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Capacitor Android
- LocalStorage 本地持久化

## 本地开发

```bash
npm install
npm run dev
```

默认本地地址：

```text
http://127.0.0.1:5173/
```

## 构建 Web 资源

```bash
npm run build
```

## 同步 Android 工程

```bash
npm run android:sync
```

## 构建 APK

```bash
cd android
./gradlew assembleDebug
```

Windows PowerShell 可使用：

```powershell
cd android
.\gradlew.bat assembleDebug
```

调试包输出路径：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

当前版本另存为：

```text
jizhang-v1.2.2-debug.apk
```

## Android 更新兼容

Android 是否识别为同一个 App 的更新，取决于：

- 包名不变：`com.aurora.bookkeeper`
- 签名证书不变
- `versionCode` 递增

当前版本：

- `versionCode`: `6`
- `versionName`: `1.2.2`

## 本地数据兼容

应用数据存储在 LocalStorage。重构和升级时应保持这些 key 稳定：

- `ab_transactions`
- `ab_settings`

新安装用户默认账本为空；旧版本内置测试账单会在升级时自动清理，用户真实账单和设置继续保留。

## 隐私说明

- 账单数据默认保存在本机。
- API Key 保存在本地设置中，不应写入源码或提交到仓库。
- 截图测试文件和生成产物已通过 `.gitignore` 排除，避免误提交私人数据。
