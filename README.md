# 比价卡

比价卡是一款本地运行的跨平台商品价格对比应用，使用 Electron、React、TypeScript 和 SQLite 构建。

它适合比较总价和包装规格不同的同类商品，例如饮品、食品、日用品或营养补充剂。应用会统一换算单价，让不同包装之间可以直接比较。

## 当前功能

- 管理多个独立的对比清单。
- 每个清单选择一种比较基准：件数、容量或重量。
- 录入商品名称、总价、包装数量、规格、商家和备注。
- 容量统一换算为升，支持 `L/ml` 显示切换。
- 重量统一换算为千克，支持 `kg/g` 显示切换。
- 可选使用有效成分占比和倍率修正有效单价。
- 自动标记最低统一单价；四位小数下相同的最低价会同时标记。
- 卡片横向排列，可拖动排序；顺序会自动保存。
- 新卡片保存后追加到最右侧。
- 点击“单价 + 当前单位”即可复制该数值。
- 本地 SQLite 持久化，以及 JSON 备份和恢复。
- 跟随系统浅色或深色主题。

当前版本固定使用人民币（CNY），界面不显示货币选择。OCR、云同步、价格历史、汇率换算和联网抓价尚未实现。

## Windows 免安装运行

在当前项目目录中，直接双击：

```text
启动比价卡.bat
```

脚本会启动 `release\win-unpacked\比价卡.exe`。如果源代码比便携包更新，并且本机已有开发依赖，脚本会先重新生成便携版。

首次从 GitHub 克隆项目时，需要先安装依赖：

```powershell
npm install
```

随后可以双击启动脚本，或手动生成便携版：

```powershell
npm run pack:portable
```

`release\win-unpacked` 是免安装目录，可以整体复制到其他 Windows 电脑使用。

## 开发

```powershell
npm install
npm run dev
```

常用命令：

```powershell
npm test          # 单元测试、数据层测试和组件测试
npm run typecheck # TypeScript 类型检查
npm run build     # 生成生产构建到 out 目录
npm run test:e2e  # 自动 UI 端到端测试
npm run test:e2e:electron # 真实 Electron 诊断测试，默认跳过
npm run pack:portable # 生成 Windows 免安装目录
npm run dist:win      # 生成 Windows 安装包
```

Windows 下也可以直接双击：

```text
测试比价卡.bat
```

里面可以选择日常 UI E2E、真实 Electron E2E 或基础检查组合。
其中第 3 项会依次运行 typecheck、单元测试、UI E2E 和真实 Electron E2E，适合作为提交或发布前的完整检查。

默认 E2E 会打开构建后的界面并注入测试用 `compareApi`，自动验证创建清单、添加卡片、拖拽排序和备份恢复等主流程。它不会启动 Electron 主进程，因此不会触发当前 Windows 环境下偶发的 `electron.exe unknown software exception` 弹窗。

真实 Electron 诊断测试需要手动开启：

```powershell
$env:BIJIAKA_RUN_ELECTRON_E2E = '1'
npm run test:e2e:electron
Remove-Item Env:\BIJIAKA_RUN_ELECTRON_E2E
```

真实 Electron E2E 会使用临时 `userData` 目录，不会读写你的真实应用数据。测试启动时会额外传入临时 `--user-data-dir` 和测试专用 `--no-sandbox`，用于避免受限测试环境下 Chromium 子进程无法启动导致的 Windows native 异常；正常应用启动仍保持沙箱配置。

macOS 和 Linux 打包脚本：

```powershell
npm run dist:mac
npm run dist:linux
```

对应安装包需要在目标操作系统上完成实际启动和数据读写验证。

## 使用方式

1. 创建一个用于比较同类商品的清单。
2. 选择件数、容量或重量作为统一比较基准。
3. 新建价格卡，填写总价和包装规格。
4. 查看统一单价和最低价标记。
5. 使用拖动手柄调整卡片顺序。

每张卡片表示当前报价。编辑价格会覆盖旧值，但会保留创建时间和更新时间。

## 计价规则

```text
总件数 = 包装数量 × 规格
基础每件价 = 总价 ÷ 总件数
每升价 = 总价 ÷ 总容量（升）
每千克价 = 总价 ÷ 总重量（千克）
有效量 = 基础总量 × 有效成分占比 × 倍率
有效单价 = 总价 ÷ 有效量
```

金额和单价使用 `decimal.js` 进行十进制计算，避免 JavaScript 浮点误差。最低价比较会先将统一单价舍入到四位小数，因此四位小数下相同的卡片会并列最低。

## 数据与备份

- SQLite 数据库保存在 Electron 的 `userData` 目录。
- 导出备份会生成带版本信息的 JSON 文件，包含全部清单、卡片和排序。
- 恢复前会校验备份格式并显示清单和卡片数量。
- 恢复会替换当前业务数据，但会先在 `userData\backups` 中自动保存恢复前快照。
- 恢复失败时数据库事务会回滚，不会留下部分导入的数据。

## 技术与安全边界

- Electron 主进程负责数据库、文件对话框和备份操作。
- preload 只暴露类型化的 `compareApi`。
- 渲染进程不直接访问 Node.js、数据库或文件系统。
- 已启用 `contextIsolation` 和渲染进程沙箱，并关闭 `nodeIntegration`。
- 主进程会再次校验来自界面的输入。
- 数据库结构通过版本化迁移维护。

## 项目结构

```text
src/main/       Electron 主进程、SQLite 数据层和 IPC
src/preload/    安全的渲染进程桥接 API
src/renderer/   React 界面、样式和组件测试
src/shared/     数据类型与纯计价模块
tests/          自动 UI E2E 与真实 Electron 诊断测试
```

`out`、`release`、测试报告和本地数据库均为生成内容，不提交到 Git。
