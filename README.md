# 比价卡

一款使用 Electron、React、TypeScript 和 SQLite 构建的本地商品价格对比应用。

## 开发

```powershell
npm install
npm run dev
```

## 免安装运行（Windows）

直接双击项目根目录的 `启动比价卡.bat`（或 `start.bat`）。脚本会优先启动
`release\win-unpacked\比价卡.exe`，不写入安装信息，也不需要运行安装程序。

常用检查：

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e
```

## 数据与备份

- SQLite 数据库保存在 Electron 的 `userData` 目录。
- “导出备份”生成带版本号的 JSON 文件，可用于跨系统迁移。
- 恢复会替换当前业务数据，但应用会先在 `userData/backups` 自动保存恢复前快照。
- 渲染进程无法直接访问数据库或文件系统，所有读写均通过 preload 暴露的类型化 API 完成。

## 计价规则

- 总件数 = 包装数量 × 每包装件数
- 每件价 = 总价 ÷ 总件数
- 每升价 = 总价 ÷ 总容量（升）
- 每千克价 = 总价 ÷ 总重量（千克）
- 每个清单使用一个比较基准：件数、容量或重量。
- 可选填写有效成分占比和倍率；有效量 = 基础总量 × 有效成分占比 × 倍率，用于对比鱼油等“实际有效吸收量”。
- 首版固定使用人民币（CNY），界面暂不开放货币代码设置。

金额和单价使用十进制定点算法计算，避免 JavaScript 浮点误差。
