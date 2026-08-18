# 架构决策

## 技术栈

- Electron 主进程：文件系统、SQLite、凭据、模型网络请求和 Obsidian 集成。
- React 19 渲染进程：路由、学习交互和可视化。
- Fluent UI React：密集桌面产品界面和无障碍基础。
- Phosphor Icons：全项目唯一图标家族，统一 weight 为 regular。
- 共享 TypeScript 契约：IPC 输入输出；主进程对数值、路径、URL 和 Vault 字段做运行时校验。
- `node:sqlite`：主进程同步 SQLite，事务边界清晰，无额外原生扩展。
- Microsoft MarkItDown：运行在应用管理的独立 Python 环境中，只承担本地文件到原始 Markdown 的转换。

## 进程边界

渲染进程不启用 Node 集成，并保持 Chromium 沙箱。所有能力通过 CJS preload 暴露的类型化 `window.workbench` API 访问。主进程对路径、URL、模型输入和备份文件再次校验。

## 数据边界

1. Vault 内容：只读 Markdown 与白名单图片附件。索引可重建，并保留最多 5 份压缩索引快照。
2. 用户数据：SQLite，包含作答、错题、收藏、笔记、计划、申论草稿和模考。
3. AI 变式记录与申论草稿：独立表，不进入 Vault。
4. 凭据：使用 Electron `safeStorage` 加密，配置文件只保存密文。
5. 知识工坊暂存：应用数据目录中的任务清单、原始 Markdown 和待审核产物。原料文件保持只读。
6. 应用管理 Vault：只有人工批准的 Markdown 产物进入该目录，并通过现有 Vault 索引器校验。

## 知识构建边界

知识构建采用“扫描、转换、提炼、复核、人工批准、发布”流水线：

- 扫描拒绝符号链接、未完成下载、超大文件和不支持的格式。
- MarkItDown 通过 `spawn` 参数数组启动，`shell` 为 false，只调用 `convert_local()`，不开放 URI 转换。
- Python 进程只接收一个已验证的本地输入路径和一个应用暂存输出路径，不接收 API Key。
- LLM 只读取 MarkItDown 文本结果。统一系统 Prompt 把来源内容视作数据，拒绝其中夹带的指令。
- 高质量模式先提取，再用同一来源片段执行独立审校。每条产物仍必须人工批准。
- 发布后使用既有稳定 ID、跨 Vault 隔离、快照和增量索引机制，不覆盖学习记录。

## 内容兼容

应用读取用户拥有的 Markdown Vault。第三方 `.akvault` 使用设备授权加密，不在本项目中复刻或绕过。合法取得并有权使用的 Markdown 内容可由用户主动选择目录连接。

## 故障隔离

- Vault 不可用时保留用户库和设置。
- AI 不可用时显示官方解析。
- Obsidian 不可用时不阻塞主界面。
- 备份恢复失败时自动回到恢复前快照。
- Obsidian 安全模式先备份 `.obsidian`，再停用社区插件列表，不删除插件文件。
- 飞书与 OpenClaw 未接入应用进程、数据模型或诊断链路。
- 单个知识原料转换或模型调用失败时只标记该文件，不中断其余批次。
- 应用异常退出后，运行中任务标记为可重试，已转换文件和审核产物保留。
