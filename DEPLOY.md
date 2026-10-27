# 部署说明（DEPLOY.md）

本项目为**纯前端单页应用**（`src/` 即完整站点，无构建步骤、无后端依赖、无第三方依赖）。以下任选一种方式部署。

---

## 方式一：本地运行（开发 / 内网）

要求：Node.js ≥ 18。

```bash
# 启动（默认 http://localhost:3000）
npm start

# 自定义端口
PORT=8080 npm start
```

> 该方式使用项目自带的零依赖静态服务器 `server.js`，仅用于本地与内网；公网部署请优先使用方式二或方式三。

## 方式二：Docker 部署（推荐生产）

项目内置 `Dockerfile`（Nginx 1.27-alpine 托管静态站点，含 gzip、缓存、SPA 路由回退）与 `docker-compose.yml`。

```bash
# 构建并启动（映射宿主机 8080 → 容器 80）
docker compose up -d --build
# 访问 http://localhost:8080

# 或仅用 docker 命令
docker build -t transfer-fraud-guard .
docker run -d -p 8080:80 --name transfer-guard transfer-fraud-guard
```

常用运维命令：

```bash
docker compose logs -f     # 查看日志
docker compose down        # 停止并删除容器（保留镜像）
docker compose up -d       # 再次启动
```

镜像内置健康检查（每 30s 探测 `/`）。

## 方式三：任意静态托管

由于站点无构建步骤，将 **`src/` 目录内容**上传到任意静态托管即可：

| 平台 | 说明 |
| --- | --- |
| Nginx / Apache | 将 `src/` 内容放置到站点根目录，参考下方 `nginx.conf` |
| GitHub Pages | 仓库内保留 `src/`，Pages 目录指向 `src/` |
| 对象存储 / CDN | 阿里云 OSS、腾讯云 COS、七牛等直接托管 `src/` 文件 |
| 内网共享 / U 盘 | 直接双击 `src/index.html` 亦可离线使用（数据存于本机浏览器） |

### Nginx 站点配置

项目根目录已提供完整 `nginx.conf`（用于 Docker 镜像）。手动部署到自有 Nginx 时，可将 `src/` 复制为站点根目录，并确保：

```nginx
server {
    listen 80;
    root /var/www/transfer-guard;   # 指向 src/ 内容
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 环境与依赖

| 项 | 要求 |
| --- | --- |
| Node.js（本地/测试） | ≥ 18（测试推荐 ≥ 20，使用内置 `node --test` 与 `fetch`） |
| Docker（方式二） | ≥ 20.10，含 compose 插件 |
| 运行时第三方依赖 | **无**（零依赖设计） |
| 浏览器 | 现代浏览器（Chrome / Edge / Firefox / Safari），需支持 ES Modules、`localStorage`、`Intl` |

## 端口与环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 本地服务器（方式一）监听端口 |
| Docker 映射 | `8080:80` | `docker-compose.yml` 中宿主机端口，可自行修改 |

## 部署自检清单

1. ✅ 访问站点根路径，能正常加载「转账主页」；
2. ✅ 提交一笔转账，能弹出风险评估二次确认弹窗；
3. ✅ 历史页可看到记录，刷新页面后记录仍在（localStorage 生效）；
4. ✅ 右下角悬浮 AI 助手可展开、可对话；
5. ✅ 手机 / 平板宽度下布局不破版（响应式）。

## 安全说明

- 本项目为纯前端应用，数据存于用户本机浏览器，**不涉及**任何服务端数据处理；
- 部署方若对外提供服务，建议启用 HTTPS，并在站点显著位置保留反诈提示与 96110 信息；
- 静态服务器 `server.js` 已内置路径穿越防护（403 拦截），生产环境建议直接使用 Nginx 等成熟服务器。
