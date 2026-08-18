# 砺知考公工作台

[![License: MIT](https://img.shields.io/badge/License-MIT-2f855a.svg)](LICENSE)
[![CI](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/mingruiy270-debug/lizhi-kaogong-workbench)](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/releases/latest)

一个开源、本地优先、支持自定义知识库与可选 AI 的私人公考学习工作台。

砺知考公工作台用于集中管理题库、知识文档、错题、笔记、模考和学习计划。基础学习功能可以离线运行；需要 AI 时，可以连接自己选择的云端模型，也可以使用 Ollama、LM Studio 等本地模型。

## 功能概览

| 模块       | 功能                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| 知识库     | 导入 Markdown 题目与知识文档，多知识库切换、增量索引、全文搜索、分类筛选和快照回滚 |
| 行测训练   | 顺序、随机、自适应训练，即时或汇总解析，断点续练、不确定标记、收藏和笔记           |
| 错题复习   | 错因记录、相似题、分级间隔复习和 AI 深度讲解                                       |
| 模拟考试   | 计时作答、逐题保存、到时交卷、断点续答和历史成绩                                   |
| 申论训练   | 草稿自动保存、本地规则评估和可选 AI 语义评估                                       |
| 学习分析   | 学习报告、本地能力诊断、计划生成与进度记录                                         |
| AI 训练    | 学习问答、错题分析、学习诊断和双阶段变式题生成与复核                               |
| 知识库工坊 | 本地资料转换、LLM 结构化整理、人工审核和知识库发布                                 |
| 环境与数据 | 模型设置、Obsidian 连接、环境诊断、数据库备份和恢复                                |

## 下载安装

在 [GitHub Releases](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/releases/latest) 下载 Windows x64 安装包，并使用同页的 `SHA256SUMS.txt` 校验文件完整性。

安装后可以直接使用内置示例知识库体验训练、模考、申论和报告功能。模型与自定义资料均为可选配置。

## 快速开始

### 1. 连接自己的 Markdown 知识库

进入“知识库设置”，选择一个 Markdown 文件夹。应用会读取其中的题目和知识文档，建立本地索引，并保留原文件路径用于查看和重新索引。

知识库支持：

- 行测与申论题目
- 单选、多选、判断和主观题
- 知识、方法和规律文档
- 年份、地区、试卷、难度与标签
- Markdown 表格、公式和受控本地图片

现有格式说明见 [架构文档](docs/architecture.md)。

### 2. 配置模型（可选）

进入“模型设置”，选择服务类型，填写模型地址、模型名称和 API Key，然后执行连接测试。

API Key 使用 Electron `safeStorage` 加密保存，不写入 `.env`、Markdown 知识库或页面日志。清除凭据后，基础训练功能仍可继续使用。

### 3. 建立自己的知识库

进入“知识库工坊”，按以下流程处理本地资料：

```text
PDF / Word / 表格 / 网页等本地资料
  → Microsoft MarkItDown 本地转换
  → 自己配置的 LLM 提取与整理
  → 可选的第二阶段质量复核
  → 人工批准或驳回
  → 发布到工作台知识库
```

当前转换格式包括 PDF、DOCX、PPTX、XLSX、XLS、HTML、CSV、JSON、XML、TXT、Markdown、EPUB、MSG 和 EML。

可以选择：

- 自动识别题目与知识文档
- 只生成题目
- 只生成知识文档
- 仅转换为 Markdown，不调用模型
- 标准单阶段整理
- 高质量双阶段整理与复核

生成内容先进入待审核区，只有人工批准的条目才会发布。完整说明见 [知识库工坊文档](docs/knowledge-builder.md)。

## 数据与隐私

- 学习记录、设置、索引和备份保存在本机应用数据目录。
- 原料目录以只读方式扫描和转换，应用不会修改源文件。
- MarkItDown 转换进程不会获得模型 API Key。
- 使用云端模型时，只发送用户主动提交的当前任务内容。
- 使用本地模型或“仅转换 Markdown”模式时，可以让对应流程保持在本机运行。
- AI 生成的题目与知识不会自动进入正式知识库。

## Prompt 设计

每个 AI 功能都有独立的任务协议，包括角色、证据边界、处理步骤、输出格式和质量检查。题目、统计、答案、来源正文和候选 JSON 会被标记为待分析数据，避免材料中的文字改变当前任务。

详细设计见 [LLM Prompt 设计](docs/prompt-design.md)。

## 从源码运行

需要 Node.js 24、npm 和 Windows 开发环境。知识库工坊还需要 Python 3.10 以上版本。

```powershell
git clone https://github.com/mingruiy270-debug/lizhi-kaogong-workbench.git
cd lizhi-kaogong-workbench
npm ci
npm run dev
```

常用命令：

```powershell
npm run format:check
npm run typecheck
npm test
npm run build
npm run package
```

## 项目结构

```text
src/main/       Electron 主进程、数据库、模型、知识库与学习服务
src/preload/    安全的渲染层调用桥接
src/renderer/   React + Fluent UI 桌面界面
src/shared/     数据契约、默认配置与 Prompt
tools/          MarkItDown 本地转换脚本
tests/          数据库、知识库与构建流程测试
docs/           架构、设计和使用说明
```

## 参与项目

- 问题与建议：[GitHub Issues](https://github.com/mingruiy270-debug/lizhi-kaogong-workbench/issues)
- 开发流程：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全反馈：[SECURITY.md](SECURITY.md)
- 更新记录：[CHANGELOG.md](CHANGELOG.md)
- 许可证：[MIT License](LICENSE)
