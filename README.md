# wecom-glichtip-webhook

将 [GlitchTip](https://glitchtip.com/) / [Sentry](https://sentry.io/) 的 Webhook 告警转发到[企业微信消息推送](https://developer.work.weixin.qq.com/document/path/99110)（原「群机器人」）。

灵感来自钉钉版 [glichtip-webhook](https://github.com/lly-ke/glichtip-webhook)，本仓库面向企业微信场景。

```text
GlitchTip / Sentry  ──POST /webhook──►  本服务  ──POST──►  企业微信群
```

## 特性

- 兼容 GlitchTip / Sentry 常见 Webhook 载荷（`attachments` + `text`）
- 支持企业微信 `markdown` / `news` / `text` 三种消息类型
- 可按 `Environment` 过滤，只推送指定环境
- 零额外 IM SDK，仅用 Node 内置 `fetch` 调用官方 webhook
- 提供 Docker / Compose 一键部署

## 快速开始

### 1. 准备企业微信 Webhook

在目标群聊中添加「消息推送」，复制 webhook 地址：

```text
https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<YOUR_KEY>
```

> **安全提示：** webhook 地址等同于发消息凭证。请勿提交到公开仓库、截图或博客；泄露后任何人都能往群里发消息。详见[官方文档](https://developer.work.weixin.qq.com/document/path/99110)。

### 2. 启动服务

```bash
cp .env.example .env
# 编辑 .env，设置 GW_WEBHOOK_URL

npm install
npm start
```

默认监听 `3123`。健康检查：

```bash
curl http://localhost:3123/health
```

### 3. 配置 GlitchTip

在 GlitchTip 的 **Alerts / Integrations → Webhook** 中填入：

```text
http://<本服务可访问地址>:3123/webhook
```

本机调试可用 `http://localhost:3123/webhook`。若 GlitchTip 运行在 Docker、本服务在宿主机，可尝试 `http://host.docker.internal:3123/webhook`（视平台而定）。

应用侧将 Sentry SDK / GlitchTip DSN 指向 GlitchTip 后，异常经 GlitchTip 回调本服务，再推送到企微群。

## Docker

镜像已发布至 Docker Hub：[nicebaiqing/wecom-glichtip-webhook](https://hub.docker.com/r/nicebaiqing/wecom-glichtip-webhook)

### 直接拉取运行

```bash
docker pull nicebaiqing/wecom-glichtip-webhook:latest

docker run -d --name wecom-glichtip-webhook -p 3123:3123 \
  -e GW_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<YOUR_KEY>' \
  -e GW_MSGTYPE=markdown \
  nicebaiqing/wecom-glichtip-webhook:latest
```

### 本地构建

```bash
docker compose up -d --build
```

或：

```bash
docker build -t wecom-glichtip-webhook .
docker run -d --name wecom-glichtip-webhook -p 3123:3123 \
  -e GW_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<YOUR_KEY>' \
  -e GW_MSGTYPE=markdown \
  wecom-glichtip-webhook
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `GW_WEBHOOK_URL` | 与 `GW_KEY` 二选一 | 企业微信 webhook 完整 URL |
| `GW_KEY` | 与 `GW_WEBHOOK_URL` 二选一 | 仅 key，将自动拼接官方 send 地址 |
| `GW_MSGTYPE` | 否 | `markdown`（默认）/ `news` / `text` |
| `GW_ONLY_ENV` | 否 | 仅转发这些 Environment，逗号分隔，如 `production,prod` |
| `GW_MENTIONED_MOBILES` | 否 | `text` 类型时 @ 的手机号列表；`@all` 表示提醒全员 |
| `GW_PIC_URL` | 否 | `news` 类型的封面图 URL |
| `PORT` | 否 | 监听端口，默认 `3123` |

## 消息类型

依据[企业微信消息推送文档](https://developer.work.weixin.qq.com/document/path/99110)：

| 类型 | 说明 |
| --- | --- |
| `markdown` | 默认。含标题、环境/项目信息、详情链接，适合告警阅读 |
| `news` | 图文卡片，点击跳转 Issue 页面 |
| `text` | 纯文本，可配合 `GW_MENTIONED_MOBILES` 提醒成员 |

## 自测

模拟一条 GlitchTip 风格载荷：

```bash
curl -X POST 'http://localhost:3123/webhook' \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "ReferenceError: foo is not defined",
    "attachments": [{
      "title": "ReferenceError: foo is not defined",
      "title_link": "https://glitchtip.example.com/issues/1",
      "fields": [
        { "title": "Project", "value": "my-frontend" },
        { "title": "Environment", "value": "production" }
      ]
    }]
  }'
```

成功时 HTTP 响应为 `Data received and processed`，企微群应收到对应告警。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/` | 服务信息（消息类型、环境过滤等） |
| `GET` | `/health` | 健康检查 |
| `POST` | `/webhook` | 接收 GlitchTip / Sentry Webhook |

## 致谢

- [lly-ke/glichtip-webhook](https://github.com/lly-ke/glichtip-webhook) — 钉钉转发实现与整体思路参考
- [企业微信开发者中心 · 消息推送配置说明](https://developer.work.weixin.qq.com/document/path/99110)

## License

[MIT](./LICENSE)
