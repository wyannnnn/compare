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
npm run test:e2e:electron
npm run pack:portable
```

Windows 可直接双击：

```text
测试比价卡.bat
```

该脚本提供日常 UI E2E、真实 Electron E2E 和完整检查组合，并会正确保留测试退出码。也可以直接传参：

```text
测试比价卡.bat ui
测试比价卡.bat electron
测试比价卡.bat basic
```

第 3 项 / `basic` 会依次运行 typecheck、单元测试、UI E2E 和真实 Electron E2E。

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

涉及交互主流程、拖拽、备份恢复、复制卡片或卡片展示逻辑时，补跑：

```powershell
npm run test:e2e
```

涉及 Electron 主进程、preload、文件对话框、数据库路径、启动脚本、打包配置或发布前检查时，优先跑：

```text
测试比价卡.bat basic
```

如只想单独诊断真实 Electron，可跑下面的环境变量版本。修改启动脚本或便携包时，另补 `npm run pack:portable`。

`npm run test:e2e` 默认执行浏览器 UI E2E：打开构建后的 renderer，并注入测试用 `compareApi`，覆盖创建清单、添加卡片、拖拽排序和备份恢复等主流程。它不会启动 Electron 主进程。复制卡片目前由 renderer 组件测试和数据库测试覆盖；如果后续改到跨窗口或 IPC 复杂流程，再补 E2E。

真实 Electron 诊断测试使用：

```powershell
$env:BIJIAKA_RUN_ELECTRON_E2E = '1'
npm run test:e2e:electron
Remove-Item Env:\BIJIAKA_RUN_ELECTRON_E2E
```

真实 Electron E2E 会使用临时 `userData`，并在 Electron 启动参数里传入临时 `--user-data-dir` 与测试专用 `--no-sandbox`。原因是受限测试环境中 Chromium 子进程沙箱可能无法启动，表现为 Windows `electron.exe unknown software exception (0x80000003)`；正常应用启动不应使用 `--no-sandbox`。

如果只是文档改动，可以不跑完整测试，但提交前仍需检查 `git diff --check`。

E2E 注意事项：

- `tests/ui.spec.ts` 使用固定安全端口池，不要改回随机 `listen(0)`；Chromium 可能抽到 6666 等 unsafe port，导致 `net::ERR_UNSAFE_PORT`。
- UI E2E 和真实 Electron E2E 都包含“C 卡一次拖到 A 卡前面”的跨位置排序断言，不要为了让测试通过而弱化成相邻拖动。
- 真实 Electron E2E 的 `--no-sandbox` 只允许留在测试启动参数中，不要复制到正常应用启动逻辑。

## 架构边界

- `src/main/`：Electron 主进程、SQLite 数据层、IPC、文件对话框。
- `src/preload/`：只暴露类型化 `compareApi`，不要暴露通用 Node 能力。
- `src/renderer/`：React UI，不应直接访问数据库、文件系统或 Node API。
- `src/shared/`：共享类型和纯计算逻辑，应尽量保持无副作用。
- `tests/`：自动 UI E2E 与真实 Electron 诊断测试。

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
- 相对最低价差异是展示层增强，基于当前统一单价计算；不要改变最低价判断规则。
- 可选的有效成分占比和倍率会影响有效单价，不能只当作展示字段。
- 清单的数量单位 `itemUnit` 只影响文案展示，默认“件”，不参与计算。
- 数据库结构变更必须通过迁移处理，并补数据层测试。
- JSON 恢复必须校验格式，并在事务中替换数据。

## UI 与交互约定

- 界面语言为简体中文。
- 新卡片保存后追加到当前清单最右侧。
- 复制卡片只复制到当前清单，名称追加“副本”，并追加到最右侧。
- 商品卡片竖向展示，多卡片横向排列。
- 卡片拖拽时不应改变原始尺寸；拖拽浮层应尽量保持和原卡片一致。
- 单价数字和当前单位可以点击复制；单位切换按钮必须与复制区域分开。
- `L/ml`、`kg/g` 切换只是显示方式，不改变底层计算。
- 清单用于比较同类商品，并统一使用一种比较基准。
- “显示选项”中的数量单位用于总数量、基础单价和包装规格文案，默认值保持“件”。
- 删除卡片应使用应用内确认弹窗，不使用系统 `window.confirm`。
- 备份菜单点击外部或按 `Esc` 应关闭。
- Electron 默认菜单栏应保持移除，按 `Alt` 不应出现菜单栏。
- 卡片摘要只放适合横向对比的核心字段；更多信息通过“查看详情”抽屉展示。

## 打包与生成文件

不要提交以下生成内容：

- `node_modules/`
- `out/`
- `release/`
- `coverage/`
- `test-results/`
- `playwright-report/`
- `.diag-data/`

Windows 图标已配置为 `build/icon.ico`，并在 `package.json` 的 electron-builder 配置中声明。`build/icon.ico` 是源码资产，应提交；`release/` 仍然是生成目录，不提交。

## Git 约定

- 提交前先检查 `git status -sb`，确认没有混入无关改动。
- 提交代码时优先使用明确文件路径暂存，不要盲目 `git add -A`。
- 用户明确要求推送时，可以直接推送当前 `main` 到 `origin/main`。
- 文档、UI 文案、样式和测试可以合并为一个小提交；架构、数据库迁移和打包配置尽量单独提交。

## 后续建议

优先级较高的改进方向：

1. 发布前冒烟清单：便携包启动、真实数据读写、备份恢复和图标显示。
2. 抽取 `tests/ui.spec.ts` 与 `tests/electron.spec.ts` 中重复的 E2E helper，降低两套测试漂移风险。
3. 备份管理增强：打开备份目录、最近自动备份列表、恢复前更详细的数据摘要。
4. 详情抽屉继续优化：让高级换算信息更适合横向对比，同时保持卡片摘要清爽。
5. OCR 接入前的 `CardDraft` 校对流程设计，确保识别结果必须先进入编辑抽屉再保存。
6. 为旧备份兼容、数据库迁移和异常恢复补更多测试样例。
