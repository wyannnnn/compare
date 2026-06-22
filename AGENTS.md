# AGENTS.md

本文件给后续参与本项目的 AI agent 或开发者使用，记录项目约定和容易踩坑的地方。用户使用说明请看 `README.md`。

## 项目概览

- 应用名称：比价卡。
- 技术栈：Electron、React、TypeScript、Vite、SQLite、decimal.js。
- 目标：本地管理商品报价，用统一单价比较同类商品。
- 当前固定货币为 CNY，界面不开放货币选择。
- OCR、云同步、价格历史、汇率换算、联网抓价尚未实现。

## 常用命令

```powershell
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run pack:portable
```

注意：Playwright Electron E2E 目前默认跳过真实 Electron 启动。需要手动执行完整 E2E 时，在 PowerShell 中先设置：

```powershell
$env:BIJIAKA_RUN_E2E = '1'
npm run test:e2e
Remove-Item Env:\BIJIAKA_RUN_E2E
```

这样做是因为当前 Windows + Electron 42 + Playwright 组合在测试启动/退出 Electron 时偶发 `electron.exe unknown software exception` 弹窗；用户正常启动应用未复现该问题。

Windows 免安装启动入口：

```text
启动比价卡.bat
```

`start.bat` 会优先启动 `release\win-unpacked\比价卡.exe`。如果源代码比便携包更新，并且本机有打包依赖，会先重新执行 `npm run pack:portable`。

## 必跑检查

普通代码或 UI 改动至少运行：

```powershell
npm run typecheck
npm test -- --run
npm run build
```

涉及 Electron 主进程、preload、文件对话框、数据库路径、启动脚本、拖拽、备份恢复时，尽量补跑：

```powershell
npm run test:e2e
npm run pack:portable
```

如果要真正执行 Electron 端到端测试，需按上文设置 `BIJIAKA_RUN_E2E=1`。否则 `npm run test:e2e` 只会构建并跳过这些 Playwright Electron 用例。

如果只是文档改动，可以不跑完整测试，但提交前仍需检查 `git diff --check`。

## 架构边界

- `src/main/`：Electron 主进程、SQLite 数据层、IPC、文件对话框。
- `src/preload/`：只暴露类型化 `compareApi`，不要暴露通用 Node 能力。
- `src/renderer/`：React UI，不应直接访问数据库、文件系统或 Node API。
- `src/shared/`：共享类型和纯计算逻辑，应尽量保持无副作用。
- `tests/`：Electron 端到端测试；当前需要 `BIJIAKA_RUN_E2E=1` 手动启用真实 Electron 启动。

安全边界说明：

“安全边界”指的是应用内部不同运行环境之间的权限分层。比价卡是本地桌面应用，但仍然需要避免让界面代码直接获得过大的系统权限。当前项目按四层隔离：

1. 渲染进程只负责界面。
   - `src/renderer/` 中的 React 代码只能渲染 UI、收集表单输入和调用 `compareApi`。
   - 不允许直接读写文件、访问数据库、执行 Node API 或拼接系统路径。
   - 这样即使界面层出现 bug，也不会直接影响本机文件系统或数据库。

2. preload 只负责暴露白名单 API。
   - `src/preload/` 只能通过 `contextBridge` 暴露类型化的 `compareApi`。
   - 不要暴露 `fs`、`path`、`child_process`、数据库连接或任意 IPC 调用器。
   - 新能力必须显式加入 API 类型，而不是提供“万能通道”。

3. 主进程负责有权限的操作。
   - `src/main/` 可以访问 SQLite、文件对话框、备份文件和 Electron 系统能力。
   - 数据库、备份导入导出、文件选择只允许主进程处理。
   - 主进程不能信任渲染进程传入的数据，必须再次校验。

4. 共享计算模块保持纯净。
   - `src/shared/` 应只包含类型、校验和纯计算逻辑。
   - 不应访问 DOM、Electron、数据库或文件系统。
   - 这样计算规则可以被主进程、渲染进程和测试安全复用。

必须保持的 Electron 配置：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- 移除默认应用菜单，避免 Alt 唤出 Electron 默认菜单。

判断新功能是否越界：

- 如果功能需要读写文件、打开系统对话框、访问数据库或修改备份，只能放在主进程。
- 如果功能只是展示、输入、排序、复制文本，可以放在渲染进程。
- 如果功能是价格计算、单位换算或最低价判断，应优先放在 `src/shared/`。
- 如果要让渲染进程调用新能力，必须通过 preload 增加明确命名、明确参数和明确返回值的 API。

## 数据与计算约定

- 计算结果不入库，始终由 `src/shared/calculator.ts` 计算。
- 金额和单价必须使用 decimal.js，避免 JavaScript 浮点误差。
- 总件数 = 包装数量 × 规格。
- 容量统一换算为 L，重量统一换算为 kg。
- 最低价比较基于当前清单比较基准的统一单价，并按四位小数判断并列最低。
- 可选的有效成分占比和倍率会影响有效单价，不能只当作展示字段。
- 数据库结构变更必须通过迁移处理，并补数据层测试。
- JSON 恢复必须校验格式，并在事务中替换数据。

## UI 与交互约定

- 界面语言为简体中文。
- 新卡片保存后追加到当前清单最右侧。
- 商品卡片竖向展示，多卡片横向排列。
- 卡片拖拽时不应改变原始尺寸；拖拽浮层应尽量保持和原卡片一致。
- 单价数字和当前单位可以点击复制；单位切换按钮必须与复制区域分开。
- `L/ml`、`kg/g` 切换只是显示方式，不改变底层计算。
- 清单用于比较同类商品，并统一使用一种比较基准。
- 删除卡片应使用应用内确认弹窗，不使用系统 `window.confirm`。
- 备份菜单点击外部或按 `Esc` 应关闭。
- Electron 默认菜单栏应保持移除，按 `Alt` 不应出现菜单栏。
- 当前卡片默认折叠详情；如果后续改为详情侧栏，要保留影响单价的高级修正状态提示。

## 打包与生成文件

不要提交以下生成内容：

- `node_modules/`
- `out/`
- `release/`
- `coverage/`
- `test-results/`
- `playwright-report/`
- `.diag-data/`

Windows 图标后续应配置为 `.ico`，并在 `package.json` 的 electron-builder 配置中声明；当前程序文件仍可能使用 Electron 默认图标。

## Git 约定

- 提交前先检查 `git status -sb`，确认没有混入无关改动。
- 提交代码时优先使用明确文件路径暂存，不要盲目 `git add -A`。
- 用户明确要求推送时，可以直接推送当前 `main` 到 `origin/main`。
- 文档、UI 文案、样式和测试可以合并为一个小提交；架构、数据库迁移和打包配置尽量单独提交。

## 后续建议

优先级较高的改进方向：

1. 详情侧栏与等高卡片。
2. 复制卡片并预填新建表单。
3. 相对最低价差异展示。
4. 自定义商品单位。
5. Windows `.ico` 图标。
6. 更完整的拖拽和备份恢复 E2E 测试。
