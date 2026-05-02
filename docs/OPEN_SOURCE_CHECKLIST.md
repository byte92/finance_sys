# 开源发布检查清单

本文档用于在公开仓库前做最后检查。

## 必须完成

- [ ] 确认仓库不包含真实 `.env.local` 或 `docker/.env`。
- [ ] 确认仓库不包含真实 SQLite 数据库或备份文件。
- [ ] 确认仓库不包含真实 API Key、交易记录、账户截图或 AI Debug 敏感日志。
- [ ] 确认 `.gitignore` 覆盖本地数据库、构建产物、调试日志和环境变量。
- [ ] 确认 `README.md` 面向开源用户，而不是只面向个人开发记录。
- [ ] 确认 `CONTRIBUTING.md`、`SECURITY.md`、`LICENSE` 已存在。
- [ ] 确认 `CODE_OF_CONDUCT.md`、Issue template、PR template 已存在。
- [ ] 确认 `.env.example` 和 `docker/.env.example` 中没有真实密钥。
- [ ] 确认在 `docker/` 目录运行 `docker compose up -d --build` 可以启动服务。
- [ ] 运行 `pnpm test`。
- [ ] 运行 `pnpm build`。

## 建议完成

- [ ] 准备一张脱敏后的产品截图或演示 GIF。
- [ ] 增加示例数据或 demo seed，但不要包含真实交易。
- [ ] 在 GitHub 仓库中开启 Security Advisories。
- [ ] 配置 Issue template 和 PR template。
- [ ] 配置 CI，至少运行 `pnpm test` 和 `pnpm build`。
- [ ] 发布 Docker Hub 镜像，并补充 `latest` 与语义化版本标签。
- [ ] 添加 release notes 或 changelog。
- [ ] 明确 roadmap 中哪些能力已经完成，哪些仍在设计中。

## 发布前人工检查

建议运行以下命令辅助检查敏感信息：

```bash
git status --short
rg -n "sk-|api[_-]?key|secret|password|token" . --glob '!node_modules' --glob '!.next' --glob '!.git'
find data -type f -maxdepth 1
```

如果 `data/` 中存在真实 SQLite 文件或备份文件，只要它们被 `.gitignore` 忽略即可，不要强行删除用户本地数据。

## 开源定位建议

README 中应始终明确：

- StockTracker 是本地优先项目。
- 当前不提供云同步或多用户账号体系。
- AI 分析不是投资建议。
- 外部行情和新闻接口可能不稳定。
- 用户需要自行备份本地数据。
