# Docker 部署

本文档说明如何把 StockTracker 作为 Docker 服务运行，并为后续发布到 Docker Hub 预留流程。

## 本地构建并启动

准备环境变量：

```bash
cp .env.example .env.local
```

按需填写 `.env.local` 中的 AI 模型配置。然后启动服务：

```bash
docker compose up -d --build
```

启动后访问：

- http://localhost:3000

默认数据会保存在 Docker volume `stocktracker-data` 中，容器重启后不会丢失。

## 常用命令

```bash
# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 停止服务并删除本地数据 volume
docker compose down -v
```

## 直接运行镜像

如果镜像已经发布到 Docker Hub，可以直接拉取运行：

```bash
docker run -d \
  --name stocktracker \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env.local \
  -v stocktracker-data:/app/data \
  byte92/stocktracker:latest
```

## 发布到 Docker Hub

维护者发布镜像时可以使用：

```bash
docker build -t byte92/stocktracker:latest .
docker tag byte92/stocktracker:latest byte92/stocktracker:<version>
docker push byte92/stocktracker:latest
docker push byte92/stocktracker:<version>
```

建议同时发布：

- `latest`：最新稳定版本。
- `x.y.z`：语义化版本标签。

## 数据与隐私

容器内默认数据库路径：

```text
/app/data/finance.sqlite
```

`docker-compose.yml` 会把这个目录挂载到命名 volume。请不要把真实 SQLite 数据库打进镜像，也不要把包含真实 API Key 的 `.env.local` 提交到仓库。

## 架构说明

Docker 镜像使用 Next.js standalone 输出：

```text
npm ci -> npm run build -> .next/standalone -> node server.js
```

这样运行镜像只携带生产服务所需文件，镜像体积和启动路径都更清晰。
