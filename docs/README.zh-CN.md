<div align="center">

<img width="100%" alt="ServerKit — 部署、管理和监控服务器" src="screenshots/poster.png" />

# ServerKit

**部署、管理和监控服务器。**

一款轻量、现代的服务器控制面板，用于管理 Web 应用、数据库、
Docker 容器和安全策略——无需 Kubernetes 的复杂性，
也没有托管平台的高昂成本。

[English](../README.md) | [Español](README.es.md) | 中文版 | [Português](README.pt.md)

<br>

![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
[![Discord](https://img.shields.io/discord/1470639209059455008?style=for-the-badge&logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/ZKk6tkCQfG)
[![观看演示](https://img.shields.io/badge/%E8%A7%82%E7%9C%8B%E6%BC%94%E7%A4%BA-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=TXfXFz6bVjs&list=PLShBdCqh2m8E)

<a href="https://trendshift.io/repositories/21908?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-21908" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/21908/daily?language=JavaScript" alt="jhd3197/ServerKit | Trendshift" height="55" align="middle" /></a>
<a href="https://www.uneed.best/tool/serverkit" target="_blank" rel="noopener noreferrer">
  <img src="https://www.uneed.best/POTD3.png" height="55" align="middle" alt="Uneed POTD3 Badge" />
</a>

[![GitHub Stars](https://img.shields.io/github/stars/jhd3197/ServerKit?style=flat-square&color=f5c542)](https://github.com/jhd3197/ServerKit/stargazers)
[![Downloads](https://img.shields.io/github/downloads/jhd3197/ServerKit/total?style=flat-square)](https://github.com/jhd3197/ServerKit/releases)
[![Docker Pulls](https://img.shields.io/docker/pulls/jhd3197/serverkit?style=flat-square&logo=docker&logoColor=white&label=docker%20pulls)](https://hub.docker.com/r/jhd3197/serverkit)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](../LICENSE)
[![Python](https://img.shields.io/badge/python-3.11+-3776AB.svg?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/react-18-61DAFB.svg?style=flat-square&logo=react&logoColor=black)](https://reactjs.org)
[![Flask](https://img.shields.io/badge/flask-3.0-000000.svg?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![Nginx](https://img.shields.io/badge/nginx-reverse_proxy-009639.svg?style=flat-square&logo=nginx&logoColor=white)](https://nginx.org)
[![Let's Encrypt](https://img.shields.io/badge/SSL-Let's_Encrypt-003A70.svg?style=flat-square&logo=letsencrypt&logoColor=white)](https://letsencrypt.org)

<br>

[快速开始](#-快速开始) · [视频教程](#视频教程) · [截图预览](#-截图预览) · [功能特性](#-功能特性) · [系统架构](#-系统架构) · [路线图](#-路线图) · [文档](#-文档) · [参与贡献](#-参与贡献) · [Discord](#-社区)

</div>

---

## 视频教程

选择模板或使用自己的代码，在 YouTube 上观看两种部署方式。

<table>
  <tr>
    <th width="50%">从模板到应用上线</th>
    <th width="50%">3 步部署 Git 仓库</th>
  </tr>
  <tr>
    <td valign="top">
      <a href="https://youtu.be/TXfXFz6bVjs"><img src="videos/template-to-live-app.png" width="100%" alt="从模板到应用上线" /></a>
      <p>从模板目录部署 AgentSite，检查可用资源并实时查看构建过程。</p>
      <p><strong><a href="https://youtu.be/TXfXFz6bVjs">▶ 在 YouTube 上观看 · 4:16</a></strong></p>
      <p><a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=27s">模板目录</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=71s">部署面板</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=123s">资源检查</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=151s">实时构建</a></p>
    </td>
    <td valign="top">
      <a href="https://youtu.be/Fv28qMERYDU"><img src="videos/deploy-git-repo.png" width="100%" alt="3 步部署 Git 仓库" /></a>
      <p>连接 Git 仓库，检查自动识别的配置，然后使用新建服务向导完成部署。</p>
      <p><strong><a href="https://youtu.be/Fv28qMERYDU">▶ 在 YouTube 上观看 · 3:45</a></strong></p>
      <p><a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=25s">代码来源</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=70s">连接仓库</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=117s">检查配置</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=160s">自动部署</a></p>
    </td>
  </tr>
</table>

---

## 📊 数据一览

<!-- BEGIN GENERATED MEASUREMENTS -->
测量快照：**2026-09-05**。[定义、原始测量结果和复现命令](METRICS.md)。

| | |
|---|---|
| **1,212** 个核心路由声明 | 来自 `backend/app/api` 中 **104** 个蓝图声明；这是源码清单，不包括扩展 |
| **118** 个内置应用模板 | 模板目录根层级的应用 YAML 文件；数据库扩展模板另计 |
| **5,089** 个已收集的后端测试用例 | 基于干净检出的测试收集结果；不代表所有用例均已运行或通过 |
| **3.31 MB** 全部 JS/CSS 的 gzip 压缩总大小 | 包括按需模块、语言包和依赖适配文件；不含字体和图片 |
| **$0** 许可费用 | MIT 许可证，无订阅或席位费用 |

gzip 数值为各文件分别按级别 9 压缩后的总和，并非实测页面加载时间。内存占用与镜像大小取决于构建、平台和工作负载，不作通用占用保证。
<!-- END GENERATED MEASUREMENTS -->

---

## 🚀 快速开始

> 安装时间取决于服务器、网络和所需的软件包。

### 方式一：一键安装（推荐）

```bash
curl -fsSL https://serverkit.ai/install.sh | bash
```

> 支持 Ubuntu 22.04+、Debian 12+、Fedora 以及 RHEL/Rocky/AlmaLinux 9+，自动完成所有配置。
>
> 可选项：`PANEL_DOMAIN=panel.example.com` 用于设置域名并尝试签发 Let's Encrypt 证书；`SERVERKIT_OFFLINE_TARBALL=...` 用于从本地 tarball 安装。

### 更新

```bash
sudo serverkit update
```

原子化的蓝绿更新，包含预检、数据库备份、迁移以及自动回滚。
使用 `--dry-run` 预览，`--branch dev` 安装开发版构建，
或 `--release [version]` 安装发布版 tarball。

### 方式二：Docker

```bash
git clone https://github.com/jhd3197/ServerKit.git
cd ServerKit
cp .env.example .env       # 编辑 .env 文件，填入你的密钥
docker compose up -d       # 访问 http://localhost:5000
```

以单容器方式运行面板。请注意，容器化的面板**无法管理它自己的宿主机**——没有 systemd、
没有宿主机 nginx、没有托管站点的 vhost；需要这些功能请使用方式一。该镜像不含 nginx，
也从不重定向到 HTTPS，因此非常适合放在你自己的反向代理后面——参阅
[在你自己的反向代理后运行](INSTALLATION.md#running-behind-your-own-reverse-proxy)。

### 方式三：手动安装

参阅 [安装指南](INSTALLATION.md) 获取详细的分步说明。

### 系统要求

| | 最低配置 | 推荐配置 |
|---|---------|-------------|
| **操作系统** | Ubuntu 22.04+ · Debian 12+ · Fedora · RHEL/Rocky/AlmaLinux 9+ | Ubuntu 24.04 LTS |
| **架构** | x86_64 · ARM64 | x86_64 · ARM64 |
| **CPU** | 1 vCPU | 2+ vCPU |
| **内存** | 1 GB | 2+ GB |
| **磁盘** | 10 GB | 20+ GB |
| **Docker** | 24.0+（面板本身可选） | 最新版 |

> 这些要求是资源规划建议，并非容量基准测试。请为托管应用、镜像、数据库、日志和备份预留额外内存与磁盘空间。可参考[测量指南](METRICS.md)评估自己的工作负载。

---

## 📸 截图预览

> 截图取自使用模拟数据的演示构建——下方所有主机名、IP、域名和指标均为虚构。

|                            仪表盘                             |                            服务                            |
| :--------------------------------------------------------------: | :------------------------------------------------------------: |
|      ![Dashboard](screenshots/dashboard.png)       |      ![Services](screenshots/services.png)       |
|   _实时服务器指标、KPI 卡片与近期活动_   |   _静态站点、Node.js、Python、PHP 与 Docker 应用_   |

|                             Docker                              |                           WordPress                            |
| :-------------------------------------------------------------: | :------------------------------------------------------------: |
|         ![Docker](screenshots/docker.png)         |      ![WordPress](screenshots/wordpress.png)     |
| _容器、镜像、卷与网络，并实时显示 CPU/内存_ | _各站点状态、快捷操作与实时健康检查_ |

|                           Agent 集群                            |                           应用市场                           |
| :--------------------------------------------------------------: | :-------------------------------------------------------------: |
|            ![Agent Fleet](screenshots/fleet.png)            |      ![Marketplace](screenshots/marketplace.png)      |
|      _集群健康状况、版本灰度发布与命令队列_      |     _一键应用模板与可安装扩展_     |

|                           监控                            |                            安全                             |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|      ![Monitoring](screenshots/monitoring.png)      |         ![Security](screenshots/security.png)         |
|   _实时仪表盘、告警规则与通知渠道_   | _安全评分、ClamAV、文件完整性、防火墙、Fail2Ban_ |

<details>
<summary><strong>查看全部截图</strong></summary>

<br>

|                          AI 助手                           |                          服务详情                          |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|            ![AI Assistant](screenshots/ai.png)             |   ![Service Detail](screenshots/service-detail.png)   |
|     _由 Prompture 驱动、可在你的基础设施上调用工具的助手_     | _部署记录、Git 连接、实时用量、日志与设置_ |

|                            数据库                            |                           SQL 控制台                            |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|        ![Databases](screenshots/databases.png)        |            ![SQL Console](screenshots/sql.png)            |
|   _带源码树的 MySQL / PostgreSQL / SQLite 浏览器_   |     _在浏览器中执行 SQL，并以带类型的结果表格展示_     |

|                             域名                             |                            DNS 区域                             |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|          ![Domains](screenshots/domains.png)          |              ![DNS Zones](screenshots/dns.png)              |
|      _SSL 状态、到期追踪与自动续期_      | _Cloudflare、Route 53、DigitalOcean——完整记录编辑_ |

|                             备份                             |                               邮件                               |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|          ![Backups](screenshots/backups.png)          |               ![Mail](screenshots/email.png)               |
|     _定时备份，支持 S3/B2 同步与一键恢复_     |   _Postfix、Dovecot、OpenDKIM、SpamAssassin 与 Roundcube_   |

|                            定时任务                            |                          文件管理器                           |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|            ![Cron Jobs](screenshots/cron.png)            |           ![File Manager](screenshots/files.png)           |
|       _可视化 Cron 编辑器，时间表达式可读性强_       |    _浏览、编辑与上传文件，并按挂载点显示磁盘用量_    |

|                         日志与终端                         |                             服务器                             |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|         ![Logs & Terminal](screenshots/terminal.png)         |           ![Servers](screenshots/servers.png)           |
|      _日志查看器、进程列表、journald 与 SSH 会话_      |   _在同一面板中管理所有服务器，实时展示 CPU/内存/磁盘遥测_   |

|                          远程访问                           |                             设置                            |
| :--------------------------------------------------------------: | :-------------------------------------------------------------: |
|    ![Remote Access](screenshots/remote-access.png)    |          ![Settings](screenshots/settings.png)          |
| _通过 WireGuard 配对的 Agent 将 NAT 后的服务对外暴露_ |  _个人资料、外观/品牌、用户与连接_  |

|                              登录                              |                                                                 |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|              ![Login](screenshots/login.png)              |                                                                 |
|    _邮箱/密码登录，支持 SSO 与双因素认证_    |                                                                 |

</details>

## 🎯 功能特性

> **核心功能已臻完备。** 新能力以可安装的**扩展**形式通过内置应用市场发布——核心保持精简稳定，后续工作聚焦于 UI 打磨与社区反馈的问题修复。

### 🚀 应用与部署

| | |
|---|---|
| **一键 WordPress**<br>PHP-FPM 8.x 站点发布在真实子域名上，支持 URL 替换预览、自定义域名与通配符 HTTPS。 | **任意技术栈**<br>基于 Gunicorn 的 Flask/Django、基于 PM2 的 Node.js、静态站点——支持从 Git、Docker、手动路径或 zip 上传部署。 |
| **Docker 与 Compose**<br>镜像更新检测与一键应用、空闲容器自动休眠、基于 CPU 的自动扩缩容、实时日志与终端访问。 | **应用市场**<br>100+ 一键应用模板，基于声明式 schema，自动解析密钥、主机与 URL——没有任何硬编码。 |
| **Build Packs**<br>零 Dockerfile 部署：检查代码仓库并依据构建计划生成 Dockerfile + compose。 | **自动化**<br>基于节点的可视化自动化，用于任务、部署与 CI/CD——支持 cron、Webhook 与事件触发，运行在托管容器中。以扩展形式发布。 |
| **预览与快照**<br>临时的 PR 预览环境，以及不可变、密钥已脱敏的配置快照，支持差异对比与一键恢复。 | **项目与环境**<br>工作区 → 项目 → 环境的分组结构，并提供 WordPress 生产/预发/开发流水线，支持代码与数据库晋级。 |

### 🏗️ 基础设施

| | |
|---|---|
| **域名与 SSL**<br>Nginx 虚拟主机、自动签发与续期的 Let's Encrypt 证书、强化的 TLS 1.2+/AEAD、Cloudflare 感知配置、自动 CAA。 | **DNS 区域**<br>在 Cloudflare、Route 53 与 DigitalOcean 上进行完整记录管理——支持传播检查与应对 IP 变动的动态 DNS。 |
| **数据库**<br>MySQL/MariaDB 与 PostgreSQL，支持用户管理、实时源码树与浏览器端 SQL 控制台。 | **云端开通**<br>在 DigitalOcean、Hetzner、Vultr 与 Linode 上创建服务器，并跟踪成本。 |
| **连接中心**<br>Git 提供商、云平台、DNS、域名注册商、SMTP 中继与 S3/B2 存储——所有外部账户集中管理，静态加密存储。 | **备份**<br>将应用/数据库/文件定时备份到 S3、B2 或本地，支持保留策略、一键恢复与可选的客户端加密。 |
| **文件、FTP 与 Cron**<br>Web 文件管理器，支持浏览 S3/B2 存储桶、vsftpd 用户管理以及可视化 Cron 编辑器。 | **邮件服务器**<br>Postfix + Dovecot，支持 DKIM/SPF/DMARC、SpamAssassin、Roundcube 网页邮箱与转发规则。 |

### 🔒 安全

| | |
|---|---|
| **Web 应用防火墙**<br>应用级 ModSecurity v3 + OWASP Core Rule Set，支持检测/拦截模式与可调偏执级别。 | **Passkeys 与双因素认证**<br>WebAuthn 无密码登录（硬件密钥、Touch ID、Windows Hello），以及带备用码的 TOTP。 |
| **恶意软件与完整性**<br>ClamAV 扫描与隔离、文件完整性监控，以及 Lynis 漏洞审计。 | **SSH 与系统加固**<br>Fail2ban、SSH 密钥管理、IP 允许/阻止列表，以及自动操作系统安全更新。 |
| **容器扫描**<br>使用 grype 进行逐镜像 CVE 扫描，并用 syft 生成 SBOM。 | **加密密钥**<br>提供商凭据与密钥使用 Fernet 加密封存，另有面向外部自动化的入站 Webhook 网关。 |

### 🖥️ 多服务器

| | |
|---|---|
| **跨平台 Agent**<br>适用于 Linux、Windows 和 macOS 的 Go Agent——通过实时 WebSocket 网关进行 HMAC-SHA256 认证。原生 Windows 服务 + MSI、`.deb`/`.rpm`、ARM64。[了解更多 →](https://github.com/jhd3197/serverkit-agent) | **集群管理**<br>资产清单、审批队列、分阶段版本灰度、局域网自动发现，以及离线命令队列。 |
| **轻松接入**<br>带指纹校验的短码配对或预共享令牌；主机凭据以 AES-GCM 加密存储。[了解更多 →](pairing.md) | **集群监控**<br>跨服务器热力图、指标对比、告警阈值、异常检测与容量预测。 |
| **服务器模板**<br>预期状态模板，支持漂移检测、合规仪表盘与自动修复。 | **远程访问隧道**<br>通过边缘服务器上由 Agent 托管的 WireGuard 暴露私有/NAT 后的服务——无需端口转发。 |
| **引导式接入**<br>校验 → 前置依赖 → Docker → 配对 Agent，并提供实时进度日志。 | **按服务器代理**<br>可选为每台服务器启用 Docker 化的 Traefik 或 Caddy，并提供 compose 预览；主机 nginx 仍为默认方案。 |

### 📊 监控与告警

| | |
|---|---|
| **实时指标**<br>通过 WebSocket 监控 CPU、内存、磁盘与网络，并提供历史留存与运行时间追踪。 | **GPU 监控**<br>NVIDIA 利用率、显存、温度，以及按进程/按容器的用量统计。 |
| **状态页**<br>公开状态页，支持 HTTP/TCP/DNS/Ping 检查、组件监控与事故管理。 | **通知推送**<br>Discord、Slack、Telegram、HTML 邮件与 Webhook——支持按用户配置渠道、严重级别过滤与免打扰时段。 |

### 👥 团队与权限

| | |
|---|---|
| **工作区**<br>多租户隔离，支持配额与成员管理。 | **RBAC**<br>管理员/开发者/查看者角色，支持按功能细分的读/写权限。 |
| **SSO 与 OAuth**<br>Google、GitHub、OpenID Connect 与 SAML 2.0，支持账户关联。 | **API 密钥**<br>分级密钥，支持速率限制、细粒度作用域、用量分析与 OpenAPI 文档。 |
| **审计日志**<br>记录每一次用户操作，并提供详细的活动仪表盘。 | **Webhook 与共享配置**<br>出站订阅，支持 HMAC 签名与重试，另有共享标签与变量组。 |

### 🎨 自定义

| | |
|---|---|
| **默认精简**<br>安装向导只安装与你的使用场景相匹配的扩展——随时可从应用市场添加更多。 | **侧边栏预设**<br>完整、Web 托管、邮件管理、DevOps 或极简视图，支持可折叠分组与按用户布局。 |
| **你的品牌**<br>8 种预设主题色外加自定义 hex 取色器，以及白标 logo、名称或横幅。 | **仪表盘小组件**<br>可开关与重排小组件，以贴合你的工作流。 |

---

## 🏗️ 系统架构

<img width="100%" alt="ServerKit 架构：客户端与公网访客先抵达 nginx 边缘层，由其将面板流量分发到 Flask API，将公开流量代理到应用容器；ServerKit 面板包含 React SPA、REST API、Socket.IO Agent 网关、服务层、模型层、任务、通知与扩展运行时；同一台服务器上的运行时层承载 Docker 应用容器、数据库与面板状态；远程 Go Agent 集群通过 /agent 命名空间回连。" src="images/architecture/system-overview.png" />

**Nginx** 终止 TLS 并将流量一分为二：面板请求转发到 **Flask API**，其余请求代理到为该域名提供服务的 **Docker 容器**。面板将自身状态保存在 SQLite 或 PostgreSQL 中，通过任务调度器与通知总线运行后台工作，并从**扩展运行时**加载可选功能。远程服务器由 **Go Agent** 管理，它通过 Socket.IO 命名空间回连。

<details>
<summary><strong>查看 ASCII 图</strong></summary>

```
                          ┌──────────────────┐
                          │     INTERNET     │
                          └────────┬─────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            YOUR SERVER                                    │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                      NGINX (Reverse Proxy)                          │ │
│  │                         :80 / :443                                  │ │
│  │                                                                     │ │
│  │    app1.com ──┐   app2.com ──┐   api.app3.com ──┐   /api/v1/ ──┐   │ │
│  └───────────────┼──────────────┼──────────────────┼──────────────┼────┘ │
│                  │ proxy_pass   │ proxy_pass       │ proxy_pass   │      │
│                  ▼              ▼                  ▼              │      │
│  ┌────────────────────────────────────────────────────────────┐  │      │
│  │                    DOCKER CONTAINERS                       │  │      │
│  │                                                            │  │      │
│  │    ┌───────────┐    ┌───────────┐    ┌───────────┐        │  │      │
│  │    │ WordPress │    │   Flask   │    │  Node.js  │  ...   │  │      │
│  │    │   :8001   │    │   :8002   │    │   :8003   │        │  │      │
│  │    └─────┬─────┘    └───────────┘    └───────────┘        │  │      │
│  └──────────┼─────────────────────────────────────────────────┘  │      │
│             │                                                     ▼      │
│             │                        ┌─────────────────────────────────┐ │
│             │                        │       SERVERKIT PANEL           │ │
│             │                        │   React SPA · Flask REST API    │ │
│             │                        │   Socket.IO · Jobs · Notify     │ │
│             │                        │   Extension runtime             │ │
│             │                        │   Gunicorn -w 1 (threaded)      │ │
│             │                        └────────────────┬────────────────┘ │
│             ▼                                         │                  │
│  ┌──────────────────────────────────┐   ┌─────────────▼────────────────┐ │
│  │            DATABASES             │   │        PANEL STATE           │ │
│  │  MySQL :3306   PostgreSQL :5432  │   │  SQLite (default) or         │ │
│  │  Redis :6379   MongoDB :27017    │   │  PostgreSQL · Alembic        │ │
│  └──────────────────────────────────┘   └──────────────────────────────┘ │
└───────────────────────────────────────────────────────┼──────────────────┘
                                                        │
                          Socket.IO /agent (HMAC)       │
                          + HTTP long-poll fallback     ▼
                       ┌──────────────────────────────────────┐
                       │   REMOTE SERVERS — Go agent fleet    │
                       │   server A  ·  server B  ·  server C │
                       └──────────────────────────────────────┘
```

</details>

**[查看完整架构文档 →](ARCHITECTURE.md)** — 请求流程、扩展平台、模板系统、端口分配、任务、通知与 Agent 集群。

---

## 🗺️ 路线图

**ServerKit 的核心功能已臻完备**——从最初的 Flask + React 基础设施，到多服务器集群、SSO、自动化引擎与扩展应用市场，所有规划中的核心阶段均已交付。

后续开发集中在两个方向：

- **🧩 扩展** — 新功能以可安装扩展的形式通过应用市场发布（100+ 一键模板并持续增加）。核心保持精简；你只安装自己需要的部分。
- **✨ 核心打磨** — 持续的 UI/UX 优化，以及针对社区反馈问题的修复。不再规划新的核心功能。

完整历史：[ROADMAP.md](../ROADMAP.md)

---

## 📖 文档

| 文档 | 说明 |
|----------|-------------|
| [系统架构](ARCHITECTURE.md) | 系统设计、请求流程、架构图 |
| [安装指南](INSTALLATION.md) | 完整的安装配置说明 |
| [部署指南](DEPLOYMENT.md) | CLI 命令与生产环境部署 |
| [Agent](https://github.com/jhd3197/serverkit-agent) | 安装并运行多服务器 Agent（Linux/Windows/macOS）——独立仓库 |
| [Agent 配对](pairing.md) | 安全的短码 Agent 接入 |
| [API 参考](API.md) | REST API 接口文档 |
| [新功能](NEW_FEATURES.md) | 最新 `dev` 功能的接口与页面参考 |
| [增强能力](ENHANCEMENTS.md) | 十项开发者体验、团队/规模化、集群与安全能力的说明指南 |
| [更新日志](../CHANGELOG.md) | 发布历史与重要变更 |
| [路线图](../ROADMAP.md) | 开发路线图与规划功能 |
| [参与贡献](../CONTRIBUTING.md) | 如何参与贡献 |

---

## 🧱 技术栈

| 层级 | 技术 |
|-------|------------|
| 后端 | Python 3.11, Flask, SQLAlchemy, Flask-SocketIO, Flask-Migrate |
| 前端 | React 18, Vite, SCSS, Recharts |
| 数据库 | SQLite / PostgreSQL |
| Web 服务器 | Nginx, Gunicorn（单进程多线程 worker —— `-w 1 --threads N`） |
| 容器 | Docker, Docker Compose |
| 安全 | ClamAV, Lynis, Fail2ban, ModSecurity v3 + OWASP CRS, grype, syft, TOTP (pyotp), Fernet 加密 |
| 认证 | JWT, OAuth 2.0, OIDC, SAML 2.0, WebAuthn / passkeys |
| 邮件 | Postfix, Dovecot, SpamAssassin, Roundcube |
| Agent | Go（多服务器）, HMAC-SHA256, WebSocket |

---

## 🤝 参与贡献

欢迎贡献代码！请先阅读 [CONTRIBUTING.md](../CONTRIBUTING.md)。

```
fork → feature branch → commit → push → pull request
```

**优先领域：** 应用市场扩展、UI/UX 改进、文档完善、测试覆盖率。

---

## 💛 支持 ServerKit

ServerKit 是免费且开源的。如果它为你节省了时间，你可以这样帮助它持续发展：

- ⭐ [给仓库点个 Star](https://github.com/jhd3197/ServerKit) — 分文不花，却帮助很大
- 💖 [GitHub Sponsors](https://github.com/sponsors/jhd3197)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/jhd3197)

### 💎 加密货币

| | 币种 | 网络 | 地址 |
|:---:|---|---|---|
| <img src="images/funding/usdt-trc20.png" width="110" alt="USDT TRC-20 捐赠地址二维码" /> | **USDT** | **TRC-20** · 波场 Tron | `TTiCtqLauF1iSW2YGB3b78KmRxRqoLCgeL` |
| <img src="images/funding/usdt-erc20.png" width="110" alt="USDT 与 ETH ERC-20 捐赠地址二维码" /> | **USDT / ETH** | **ERC-20** · 以太坊 | `0xD13D5355Fa214e8317fea2ff192a065BaeC13527` |
| <img src="images/funding/btc.png" width="110" alt="比特币捐赠地址二维码" /> | **BTC** | **比特币 Bitcoin** | `bc1qatx67n3qxdvuv3arc9j8aytk34f22g02k9c7vr` |
| <img src="images/funding/sol.png" width="110" alt="Solana 捐赠地址二维码" /> | **SOL** | **Solana** | `AWXzqtBEgUfteHPQtDegsZ6D5y57M3GGdKPD8rR7h6xu` |

TRC-20 手续费最低——通常不到 1 美元——因此最适合小额捐赠。ERC-20 的 gas 费有时会
超过捐赠金额本身。

<sub>二维码由 [`scripts/generate-funding-qr.mjs`](../scripts/generate-funding-qr.mjs) 在本地生成，编码前会对每个地址做校验和验证。</sub>

---

## 🔭 相关项目

**[Faro](https://github.com/jhd3197/faro)** — 同一作者打造的现代桌面客户端，支持 SFTP、FTP、SSH 和兼容 S3 的存储。保存一次服务器后，即可在双面板视图中浏览其文件，并在同一 SSH 会话上打开终端 — 还支持拖放传输、单向目录同步以及原地编辑。它甚至内置 **Agent Bridge**，让 Claude Code（或任何 MCP 智能体）通过你已认证的会话在服务器上执行命令，逐条命令审批，且无需共享凭据。

> ServerKit 在浏览器中管理你的服务器；Faro 则是桌面端的得力搭档，用于动手进行文件传输、终端操作以及跨服务器的临时任务。[获取构建版本 →](https://github.com/jhd3197/faro/releases/latest)

**[LocalKit](https://github.com/jhd3197/LocalKit)** — 一键创建本地 WordPress 站点。每个站点都作为独立隔离的 Docker Compose 项目运行，你还可以通过 `serverkit-localkit` 扩展，直接把代码推送、或把数据库推送/拉取到你的 ServerKit 服务器。

**[DeviceKit](https://github.com/jhd3197/DeviceKit)** — 统一的 Android 设备集群与测试自动化平台。在一个仪表盘中控制整个设备集群——运行自动化任务、实时串流屏幕、捕捉视觉回归，并借助 AI 驱动的分析排查故障。

---

## 💬 社区

[![Discord](https://img.shields.io/badge/Discord-加入我们-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/ZKk6tkCQfG)

加入 Discord 社区，提出问题、分享反馈，或获取安装部署方面的帮助。

---

<div align="center">

**ServerKit** — 简洁。现代。自托管。

[报告 Bug](https://github.com/jhd3197/ServerKit/issues) · [功能建议](https://github.com/jhd3197/ServerKit/issues)

由 [Juan Denis](https://juandenis.com) 用 ❤️ 打造

</div>
