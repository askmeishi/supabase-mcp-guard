# 安全策略

[English](./SECURITY.md) | 简体中文

## 作用范围

`supabase-mcp-guard` 是官方 Supabase MCP 之前的一层本地策略包装。

它主要用于降低本机侧风险，包括：

- 避免 Supabase token 明文落在配置文件中
- 避免 token 通过命令行参数暴露
- 对可访问的项目做本地白名单限制
- 让写操作必须显式解锁
- 记录本地审计日志

## 威胁模型

这个项目主要面向以下威胁模型：

- 用户信任自己的本机
- 用户希望降低 AI Agent 对 Supabase MCP 的误用风险
- 用户希望生产写操作前有一层本地阻尼

## 它能帮助解决什么

- 本地 MCP 配置里的明文 token 泄露
- 通过进程列表、命令行参数、Shell 历史暴露 token
- 误连到错误的 Supabase 项目
- AI Agent 意外执行迁移或写 SQL
- 本机完全看不到 MCP 调用轨迹

## 它不能解决什么

- 本机已经被完全攻破
- 恶意程序已经以同一用户权限运行
- token 已经在别处泄露
- Supabase 侧本身权限设计过宽
- 数据库自身的 grants、RLS、`SECURITY DEFINER`、`search_path` 设计错误

## 安全假设

本项目默认假设：

- 本机没有被恶意软件控制
- 所选 secret backend 本身可信
- Supabase 侧权限设计仍然是正确的

如果你的 Supabase token 本身权限极大，这个工具只能降低“误用”和“随手写错”的风险，不能把广权限 token 自动变成最小权限 token。

## 推荐使用方式

- 为 MCP 单独准备 token
- `allowedProjectIds` 不要留空
- 默认保持写锁开启
- 高危工具持续保留在 `alwaysBlockedTools`
- 开发环境和生产环境使用不同配置
- 数据库本身继续做收权、RLS、函数安全收口

## 漏洞披露

如果你发现这个项目存在安全问题，建议不要先公开带利用细节的 issue。

推荐流程：

1. 优先使用 GitHub Security Advisories 的私密报告渠道
2. 如果暂时没有私密报告入口，请先联系维护者，再决定公开披露

建议附带以下信息：

- 受影响版本
- 平台环境
- 复现步骤
- 预期影响范围
- 你认为可行的修复建议
