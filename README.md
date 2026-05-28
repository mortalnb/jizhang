# 智能记账

智能记账是一款本地优先的 Android 记账工具，面向愿意自行配置 AI 模型接口的用户。它支持自然语言记账、账单截图识别、订单拆分、预算看板和本地明细管理。

项目当前更适合作为开源工具、个人效率工具或二次开发基础，而不是免配置的商业化 App。

## 适合谁

- 想用视觉模型识别账单截图的人。
- 希望账单数据默认保存在本机的人。
- 愿意自行配置 API Key、接口地址和模型名称的人。
- 想研究 React + Capacitor Android + AI 记账应用实现的人。

## 不适合谁

- 不想配置模型接口、希望开箱即用的普通用户。
- 需要云同步、多端账号、多人共享账本的人。
- 希望识别结果完全自动入账、不做人工核对的人。

## 功能

- 自然语言记账：从一句话中提取金额、分类、日期、备注和标签。
- 截图识别：支持接入视觉模型识别账单截图。
- 盒马订单：保存为一条父账单，展开后查看商品小项、数量、单位、金额和分类。
- 淘宝/天猫订单：按订单或商品分别记录，优先使用实付款金额。
- 明细管理：支持搜索、分类筛选、展开详情、单条删除和批量删除。
- 预算仪表盘：展示月度支出、预算进度、周趋势、分类结构、标签汇总和日历视图。
- 智能洞察：基于本地账单生成预算、分类和消费变化提示。
- 模型设置：支持自定义 API Key、Base URL 和模型名称。
- 模型能力测试：可测试文字、JSON 和图片能力。
- 本地优先：账单、设置、预算和分类默认保存在 LocalStorage。

## 模型说明

默认配置为：

```text
Base URL: https://api.xiaomimimo.com
Model: mimo-v2.5
```

你可以在设置页改成其他兼容 OpenAI Chat Completions 风格的模型服务。截图识别建议使用支持图片理解的视觉模型；如果使用纯文本模型，图片拆单、商品数量和单位识别可能不完整。

## 安装

从 GitHub Releases 下载最新版 APK：

```text
jizhang-v1.4.0-debug.apk
```

安装后进入设置页，填写你的模型 API Key、接口地址和模型名称，再使用“测试文字 / JSON / 图片能力”确认模型可用。

更详细的安装与配置说明见 [docs/SETUP.md](docs/SETUP.md)。

## 数据与隐私

- 新用户首次安装后账本为空，不写入测试数据。
- 老用户升级后保留已有真实账单、设置、API Key、预算和分类。
- 截图识别会把图片发送到你配置的模型服务。
- 项目作者不会接收或保存你的账单、截图或 API Key。

请在使用前阅读 [PRIVACY.md](PRIVACY.md) 和 [DISCLAIMER.md](DISCLAIMER.md)。

## 本地开发

```bash
npm install
npm run dev
```

默认预览地址：

```text
http://127.0.0.1:5173/
```

开发预览可以在项目根目录放置 `key.txt`，用于本地代理测试模型接口。`key.txt` 已被 `.gitignore` 忽略，不应提交到仓库。

## 构建

```bash
npm run build
```

## Android 构建

同步 Android 工程：

```bash
npm run android:sync
```

构建 debug APK：

```powershell
cd android
.\gradlew.bat assembleDebug
```

APK 输出路径：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

当前 Android 版本：

- `versionCode`: `11`
- `versionName`: `1.4.0`

## 技术栈

- React
- TypeScript
- Vite
- Tailwind CSS
- Capacitor Android
- Android ML Kit OCR 回退能力
- LocalStorage 本地持久化

## 开源协议

本项目使用 [MIT License](LICENSE)。
