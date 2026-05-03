# Docker 部署

本文档说明如何把 StockTracker 作为 Docker 服务运行，并为后续发布到 Docker Hub 预留流程。

## 本地构建并启动

如果需要修改宿主机端口，可以准备 Docker 编排配置：

```bash
cd docker
cp .env.example .env
```

没有 `docker/.env` 时也可以直接启动，宿主机端口默认使用 `3218`：

```bash
cd docker
docker compose up -d --build
```

启动后访问：

- 默认端口：[http://localhost:3218](http://localhost:3218)
- 如果 `docker/.env` 中设置了 `HOST_PORT`，访问 `http://localhost:${HOST_PORT}`

如果需要 AI/API Key 等业务配置，请在项目根目录准备 `.env.local`：

```bash
cp .env.example .env.local
```

`docker/docker-compose.yml` 会可选读取 `../.env.local` 并把这些业务变量注入容器。应用代码仍然通过 `process.env.AI_API_KEY`、`process.env.AI_MODEL` 等方式读取。

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
HOST_PORT=${HOST_PORT:-3218}

docker run -d \
  --name stocktracker \
  --restart unless-stopped \
  -p "${HOST_PORT}:3218" \
  -e PORT=3218 \
  -v stocktracker-data:/app/data \
  byte92/stocktracker:latest
```

如果需要传入 AI/API Key 等业务配置，可以额外加上 `--env-file ../.env.local`。

## 发布到 Docker Hub

维护者发布镜像时可以使用：

```bash
docker build -f Dockerfile -t byte92/stocktracker:latest ..
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

`docker/docker-compose.yml` 会把这个目录挂载到命名 volume。请不要把真实 SQLite 数据库打进镜像，也不要把包含真实 API Key 的 `.env.local` 或包含本地编排偏好的 `docker/.env` 提交到仓库。

## 架构说明

Docker 镜像使用 Next.js standalone 输出：

```text
pnpm install --frozen-lockfile -> pnpm build -> Chromium headless shell -> .next/standalone -> node server.js
```

应用运行时需要 Playwright 的 Chromium 来执行 `web.search` 等公开网页检索能力。镜像不会直接基于完整的 Playwright 官方镜像，而是基于 Node slim，并在运行层只安装 Chromium headless shell 和它需要的系统依赖：

- 避免打包 Firefox / WebKit 等当前业务未使用的浏览器。
- 保持 Playwright package 版本和浏览器版本由 `pnpm-lock.yaml` 统一锁定。
- 使用 Docker BuildKit cache 缓存 pnpm store 和 Next.js build cache，让重复构建更快。

`docker-compose.yml` 同时启用了 `init: true` 和 `shm_size: "1gb"`，用于减少长时间运行或 Chromium 启动时的僵尸进程和共享内存问题。
