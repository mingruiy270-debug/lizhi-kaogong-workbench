# 贡献指南

感谢你愿意改进砺知考公工作台。项目优先接受能够增强本地学习闭环、数据可迁移性、知识库质量和隐私安全的改动。

## 开始之前

1. 对较大的功能先创建 Issue，说明使用场景、数据流和兼容性影响。
2. 不要提交第三方题库、课程讲义、受保护知识包、真实 API Key、数据库或个人学习记录。
3. 新增 AI 功能时，必须说明哪些数据会发送给模型，并提供无 AI 或本地模型的降级路径。
4. 修改知识库格式时，必须考虑旧 Vault 的兼容与稳定题号。

## 本地开发

要求 Node.js 24 或兼容版本、npm 和 Windows 开发环境。知识库工坊的 MarkItDown 功能还需要 Python 3.10 以上版本。

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

提交前请执行：

```powershell
npm run format:check
npm run typecheck
npm test
```

## Pull Request

- 一个 PR 聚焦一个问题，并写清用户可见变化。
- 对修复提供复现步骤，对新功能提供验证步骤。
- 涉及界面时说明空状态、加载状态、错误状态和窄窗口表现。
- 涉及 LLM 时补充 Prompt 契约、结构化输出校验和模拟模型测试；测试不得依赖付费 API。
- 保持原料只读、用户数据独立保存和人工审核后发布等安全边界。

提交贡献即表示你有权提供相关代码，并同意其按项目 MIT License 发布。
