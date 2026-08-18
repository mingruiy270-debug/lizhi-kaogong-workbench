# 砺知考公工作台

[![License: MIT](https://img.shields.io/badge/License-MIT-2f855a.svg)](LICENSE)
[![CI](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/mingruiy270-debug/lizhi-kaogong-workbench)](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/releases/latest)

> 开源、本地优先、可自定义知识库的私人公考学习工作台。

砺知考公工作台是一个 clean-room 实现的本地优先公考学习桌面应用。它保留经过验证的学习流程，但不复制第三方程序代码、商标、授权机制或专有视觉资产。

它适合希望把自己的真题、讲义、错题和方法论统一管理，又不想把学习数据锁在某个在线平台中的备考者。基础训练完全离线可用，AI 是可选增强项。

## 下载体验

前往 [GitHub Releases](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/releases/latest) 下载 Windows 安装包。当前构建尚未购买商业代码签名证书，Windows SmartScreen 可能提示“未知发布者”，请在 Release 页面核对 SHA-256 后使用。

如果只想从源码启动：

```powershell
git clone https://github.com/mingruiy270-debug/lizhi-kaogong-workbench.git
cd lizhi-kaogong-workbench
npm ci
npm run dev
```

## 核心原则

- 官方或用户导入内容只读，学习数据独立保存。
- 基础做题、错题、模考和报告无需 AI 或外部运行时。
- API 凭据使用 Electron `safeStorage` 加密后落盘，不以明文写入配置文件。
- AI 草稿和生成训练不写回正式知识库。
- 不实现或绕过第三方 `.akvault` 授权。应用支持用户拥有的 Markdown Vault。

## 已实现功能

- Markdown 题目与知识文档导入、校验、增量索引、搜索和稳定题号。
- 多 Vault 切换、跨库题号隔离、索引快照回滚，以及年份、地区、试卷筛选。
- Markdown 材料、公式、表格和受控本地图片附件。
- 顺序、随机、自适应专项训练，即时或汇总解析、断点续练、不确定标记、错因、收藏、笔记、相似题和分级间隔复习。
- 行测模考计时、逐题自动保存、到时自动交卷、断点续答、不可变题目快照、原子交卷和历史成绩。
- 申论草稿自动保存、本地规则评分、可选 AI 语义评估。
- 学习报告与导出、本地能力诊断、可选 AI 汇总解读、计划预览、应用和进度记录。
- 13 类模型服务、5 种协议、模型发现、连接验证、独立删除凭据、当前题白名单深讲和双阶段 AI 变式质检。
- 统一的模块化 Prompt 协议：自由问答、错题讲解、申论评估、学习诊断、变式生成/终审和知识提取/终审分别约束角色、证据、流程、输出与质检。
- Obsidian 可选连接、`.obsidian` 备份/恢复/安全模式、环境诊断、数据库备份和失败自动回滚恢复。
- 学习数据单独重置，保留知识库、应用设置和模型配置。
- 内置知识库工坊：本地原料扫描、Microsoft MarkItDown 转换、可配置 LLM 提炼、两阶段审校、人工批准和应用管理库发布。
- 工坊任务支持逐文件失败隔离、取消、失败重试、中断恢复、转换缓存、来源定位和仅转换模式。

飞书与 OpenClaw 已按产品需求完全移除，不保留菜单、配置、诊断或空占位。此 clean-room 应用也不包含第三方授权页、激活逻辑和受保护内容包解密能力。

## API Key

进入“模型设置”，选择服务类型并填写模型名称和 API Key，点击“保存配置”后再点击“测试连接”。也可在保存凭据后获取提供商返回的模型列表。API Key 不写入 `.env` 或项目文件，不会从其他软件的凭据库中提取，并可在设置页单独删除。

使用云模型时，当前任务中提交的题目、答案或知识片段会发送给用户自己配置的模型服务商；选择 Ollama、LM Studio 或知识工坊的“仅转换 Markdown”模式时可以保持本地处理。应用不会在后台自动上传整个知识库。

## 自建知识库

进入“知识库工坊”，首次使用点击“安装转换引擎”。应用会在自己的数据目录创建独立 Python 环境，并安装固定版本的 Microsoft MarkItDown。本地开发目录也可以使用 `.venv-markitdown`。

建议先选择 1-3 个代表性文件：

1. 扫描原料目录并选择文件。
2. 选择自动识别、只生成题目、只生成知识文档或仅转换 Markdown。
3. 根据需要填写科目、标签和自定义整理要求。
4. 运行标准提取或高质量双阶段审校。
5. 逐项核对题干、答案、解析、事实、来源定位和警告。
6. 批准后发布到应用管理知识库。

原料目录始终只读。MarkItDown 子进程不会获得模型 API Key，也不会访问 URL。扫描式 PDF、图片和视频不会假装转换成功，当前会标记为需要 OCR 或暂不支持。详见 `docs/knowledge-builder.md`。

所有题目、统计、作答内容、来源片段和候选 JSON 都放入显式的不可信数据边界。Prompt 与数据边界设计详见 `docs/prompt-design.md`。

## 开发

```powershell
npm install
npm run dev
```

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run package
```

完整架构和迁移状态见 `docs/`。

## 开源边界

- 代码采用 [MIT License](LICENSE)。
- 仓库不附带任何第三方题库、课程资料、受许可保护的知识包或模型 API Key。
- 用户应仅导入自己有权处理的内容，并在发布 AI 生成内容前人工复核。
- 本项目不是任何考试主管部门、培训机构或 Obsidian 官方产品，也不承诺考试成绩。

欢迎阅读 [贡献指南](CONTRIBUTING.md)、[安全政策](SECURITY.md) 并通过 [Issues](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/issues) 提交问题。
