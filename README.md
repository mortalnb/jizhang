# 智能记账

智能记账是一款本地优先的 Android 记账工具。它用 MiMo 把文字、账单截图或应用内录音整理为可核对的结构化账单；任何 AI 结果都必须经过确认才会入账。

当前主线测试版本为 `v1.5.0-rc.4`。RC4 在 RC3 语音权限修复基础上，将折叠父账单明确为结算容器：混合商品按明细分类统计，同时修复长商品名和重复分类按钮造成的移动端横向溢出；云端 API 仍沿用已验证的 RC2 服务。

## 当前能力

- **真正的批量文字记账**：一次输入多笔消费时，按日期、付款行为和订单边界生成多张确认卡；一次确认后原子写入，避免半批成功。
- **账单性质分组**：盒马、沃尔玛、山姆及其他超市的一次结账默认保存为一条父账单，商品作为可折叠明细；淘宝/天猫同一订单可折叠，多个订单或不同日期保持多笔。
- **手动纠偏**：确认页可将商品展开为多笔，也可主动合并多笔；跨日期合并会再次警告。
- **连续记账**：保存后停留在“记一笔”，清空并聚焦输入框；进入明细改为显式按钮，快速双击也只写入一次。
- **应用内语音**：直接调用麦克风录制 WAV，使用固定模型 `mimo-v2.5-asr` 转写为可编辑文字，再进入同一批量解析流程。录音最长 60 秒，不会自动入账。
- **视觉账单识别**：使用 `mimo-v2.5` 识别图片；Android 本地 ML Kit OCR 和规则解析作为回退。
- **AA 净支出**：优先按实际付款减回款计算用户最终承担金额。
- **本地完整账本**：账单、分类、预算和自填模型配置保存在设备 WebView LocalStorage。
- **备份与恢复**：手动导出 JSON；写入前保存恢复快照；旧版校验和缺陷可在保留原始快照后迁移。
- **可选云同步**：默认关闭。登录内测账号并主动开启后，仅上传账单、商品明细、分类和预算；本地仍是主账本，云端恢复必须显式确认。
- **克制的数据维度**：支付方式不再保存；标签收敛为一个可选场景值；商户只用于明细搜索和筛选，不参与消费统计。
- **守恒统计与洞察**：折叠订单按实付金额分摊分类，标签稀疏时不参与分析，当前不完整月份不与完整月份直接比较。

## 分组规则

| 场景 | 默认结果 |
|---|---|
| 一张盒马/沃尔玛/山姆/超市小票 | 一条父账单，商品明细折叠 |
| 淘宝同一订单的多个商品 | 一条订单，可折叠商品明细 |
| 淘宝订单列表中的多个订单 | 多条独立账单 |
| 一段文字中的不同日期消费 | 多条独立账单，各自保留日期 |
| 优惠后实付与商品合计不同 | 父级保留实付，界面提示差额 |

## 模型配置

文字和图片默认使用：

```text
Base URL: https://api.xiaomimimo.com
Model: mimo-v2.5
```

语音固定使用 `mimo-v2.5-asr`。用户可以自填 MiMo API Key，也可以登录作者维护的云端模型代理。其他兼容接口未必支持图片或 MiMo ASR，因此语音功能不承诺兼容非 MiMo 服务。

服务端支持旧 APK 的模型名称兼容：MiMo 的 `mimo-v2.5` 请求转为 `mimo-v2.6-flash`，显式关闭思考模式，语音继续使用 `mimo-v2.5-asr`。云端图片可由服务端配置切换到 `deepseek-flash`，同样关闭思考、要求 JSON，并保留原有确认结果。该兼容在部署对应 API 提交后生效，无需重新安装 APK；自填模型直接访问 MiMo，需要在设置中自行更新模型名称。用量表仍记录 APK 请求的名称，服务端日志另记录实际供应商、发送和上游返回的模型名称、结束原因及 token 用量，不记录账单内容。

云端图片识别允许截图未显示日期：API 省略未知日期并返回“日期待确认”警告，现有 APK 会以今天作为可编辑的表单默认值，用户需核对后再确认。识别提示要求完整、紧凑的 JSON，减少商品信息的重复说明；MiMo 图片调用预留 180 秒，DeepSeek 图片以及文字、语音调用上限为 90 秒。结构校验失败日志只保留字段路径、错误码和数值边界，不保存返回正文，也不自动重试或写账。

图片供应商配置 `BILL_IMAGE_PROVIDER` 接受 `mimo`（默认）或 `deepseek`，只影响云端图片识别。选择 DeepSeek 时必须设置服务端 `DEEPSEEK_API_KEY_FILE`，指向只读挂载的私有凭据文件；也支持现有凭据管理器注入 `DEEPSEEK_API_KEY`。凭据不进入仓库、镜像、客户端或账本快照。保留 MiMo 凭据，改回 `BILL_IMAGE_PROVIDER=mimo` 并重新创建 API 容器即可回滚，不涉及数据库迁移。部署时必须保留私有挂载和环境配置，不输出完整 Compose 展开配置或容器环境。

## 安装

当前候选安装包文件名：

```text
jizhang-v1.5.0-rc.4-debug.apk
```

RC4 已作为 [GitHub Pre-release](https://github.com/mortalnb/jizhang/releases/tag/v1.5.0-rc.4) 发布，供已知风险下的升级测试；它仍是候选版，不等同于正式稳定版。

升级安装会保留现有应用数据；请勿先卸载旧版。首次使用应用内语音时，Android 会请求麦克风权限。

详细操作见 [安装与配置](docs/SETUP.md)，数据处理边界见 [隐私政策](PRIVACY.md) 与 [免责声明](DISCLAIMER.md)。
真实账本的聚合评估与不改写边界见 [2026-08-09 样本评估](docs/REAL_LEDGER_FINDINGS_2026-08-09.md)，当前方向、旧方向和目录职责见 [项目维护与方向基线](docs/MAINTENANCE.md)。

本机私有输入与生成制品统一放入被 Git 忽略的 `.local/`：MiMo Key 在 `credentials/`，升级签名在 `signing/`，本地 APK 在 `releases/`，历史安装包、日志、真实账本证据和旧说明在 `archive/`。根目录只保留工具默认发现或项目入口真正需要的文件。

## 本地开发与验证

```powershell
npm install
npm run doctor
npm run verify
npm run android:build
```

真实 MiMo 验证需要被 Git 忽略的 `.local/credentials/mimo-api-key.txt`；也可通过 `JIZHANG_MIMO_KEY_FILE` 指定其他本机路径：

```powershell
npm run test:mimo-aa
npm run test:mimo-batch-asr -- <测试音频.wav>
```

服务端验证：

```powershell
Set-Location server
npm install
npm run prisma:generate
npm run build
npm test
```

Android debug APK：

```powershell
npm run doctor
npm run android:build
```

脚本从 `android/local.properties` 发现 SDK，并优先复用其同级项目工具链中的 JDK 21；无需依赖全局 `JAVA_HOME`。默认签名输入为 `.local/signing/debug.keystore`，生成 `.local/releases/jizhang-v1.5.0-rc.4-debug.apk`，并验证包名、版本、麦克风权限、v2 签名和升级证书指纹。当前 Android 元数据为 `versionCode 19`、`versionName 1.5.0-rc.4`。

## 云端部署边界

- API 运行镜像只使用提交 SHA 标签部署，不依赖可变的版本标签；运行镜像不携带 Prisma CLI。
- 数据库迁移使用同一提交的 `<SHA>-migrate` 独立镜像显式执行，不在 API 容器启动时隐式修改数据库，也不在无待执行迁移时拉取迁移镜像。
- 部署前必须创建并验证 PostgreSQL 备份。
- 云同步采用乐观版本号；发生冲突时暂停自动覆盖，推荐按交易 ID 合并且保留本机版本，整端覆盖是需确认的次级操作。
- 云快照不包含 API Key、访问 token、刷新 token或设备凭据。

## 技术栈

React、TypeScript、Vite、Tailwind CSS、Capacitor Android、ML Kit OCR、Fastify、PostgreSQL、Prisma。

项目使用 [MIT License](LICENSE)。反馈邮箱：`sqofficial0523@gmail.com`。
