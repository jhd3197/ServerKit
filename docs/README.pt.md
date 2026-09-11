<div align="center">

<img width="100%" alt="ServerKit — Implante, gerencie e monitore servidores" src="screenshots/poster.png" />

# ServerKit

**Implante, gerencie e monitore servidores.**

Um painel de controle de servidores leve e moderno para gerenciar aplicações web, bancos de dados,
containers Docker e segurança — sem a complexidade do Kubernetes
ou o custo de plataformas gerenciadas.

[English](../README.md) | [Español](README.es.md) | [中文版](README.zh-CN.md) | Português

<br>

![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
[![Discord](https://img.shields.io/discord/1470639209059455008?style=for-the-badge&logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/ZKk6tkCQfG)
[![Ver a demo](https://img.shields.io/badge/Ver_a_Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=TXfXFz6bVjs&list=PLShBdCqh2m8E)

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

[Início Rápido](#-início-rápido) · [Guia em vídeo](#guia-em-vídeo) · [Capturas de Tela](#-capturas-de-tela) · [Funcionalidades](#-funcionalidades) · [Arquitetura](#-arquitetura) · [Roadmap](#-roadmap) · [Documentação](#-documentação) · [Contribuindo](#-contribuindo) · [Discord](#-comunidade)

</div>

---

## Guia em vídeo

Escolha um template ou use seu próprio código. Veja as duas formas de implantar no YouTube.

<table>
  <tr>
    <th width="50%">Do template ao app no ar</th>
    <th width="50%">Qualquer repositório Git em 3 passos</th>
  </tr>
  <tr>
    <td valign="top">
      <a href="https://youtu.be/TXfXFz6bVjs"><img src="videos/template-to-live-app.png" width="100%" alt="Do template ao app no ar" /></a>
      <p>Implante o AgentSite pelo catálogo de templates, confira a capacidade e acompanhe a compilação ao vivo.</p>
      <p><strong><a href="https://youtu.be/TXfXFz6bVjs">▶ Assistir no YouTube · 4:16</a></strong></p>
      <p><a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=27s">Catálogo</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=71s">Painel de implantação</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=123s">Capacidade</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=151s">Compilação ao vivo</a></p>
    </td>
    <td valign="top">
      <a href="https://youtu.be/Fv28qMERYDU"><img src="videos/deploy-git-repo.png" width="100%" alt="Qualquer repositório Git em 3 passos" /></a>
      <p>Conecte um repositório Git, revise as configurações detectadas e implante com o assistente de novo serviço.</p>
      <p><strong><a href="https://youtu.be/Fv28qMERYDU">▶ Assistir no YouTube · 3:45</a></strong></p>
      <p><a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=25s">Fontes</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=70s">Conectar repositório</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=117s">Revisar configurações</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=160s">Implantação automática</a></p>
    </td>
  </tr>
</table>

---

## 📊 Em Números

<!-- BEGIN GENERATED MEASUREMENTS -->
Registro: **2026-09-05**. [Definições, medições e comandos de reprodução](METRICS.md).

| | |
|---|---|
| **1.212** declarações de rotas do núcleo | em **104** declarações de blueprints em `backend/app/api`; inventário do código, sem extensões |
| **118** templates de apps incluídos | arquivos YAML de apps no diretório raiz; templates de extensões de banco são contados separadamente |
| **5.089** casos de teste de backend coletados | coleta de um checkout limpo; não significa que todos executaram ou passaram |
| **3,31 MB** de JS/CSS no total, comprimido com gzip | inclui módulos sob demanda, idiomas e adaptadores de dependências; exclui fontes e imagens |
| **$0** de licença | Licença MIT, sem assinaturas ou taxas por usuário |

Os valores gzip somam arquivos comprimidos separadamente no nível 9; não são tempos de carregamento medidos. A RAM e o tamanho da imagem dependem da compilação, plataforma e carga de trabalho.
<!-- END GENERATED MEASUREMENTS -->

---

## 🚀 Início Rápido

> O tempo de instalação depende do servidor, da rede e dos pacotes necessários.

### Opção 1: Instalação em Uma Linha (Recomendado)

```bash
curl -fsSL https://serverkit.ai/install.sh | bash
```

> Funciona no Ubuntu 22.04+, Debian 12+, Fedora e RHEL/Rocky/AlmaLinux 9+. Configura tudo automaticamente.
>
> Opcional: `PANEL_DOMAIN=panel.example.com` define o domínio e tenta usar o Let's Encrypt; `SERVERKIT_OFFLINE_TARBALL=...` instala a partir de um tarball local.

### Atualização

```bash
sudo serverkit update
```

Atualização atômica blue/green com verificações prévias, backup do banco de dados, migração e
rollback automático. Use `--dry-run` para pré-visualizar, `--branch dev` para builds de desenvolvimento
ou `--release [versão]` para tarballs de release.

### Opção 2: Docker

```bash
git clone https://github.com/jhd3197/ServerKit.git
cd ServerKit
cp .env.example .env       # depois edite o .env com suas chaves secretas
docker compose up -d       # acesse em http://localhost:5000
```

Executa o painel como um único contêiner. Note que um painel em contêiner **não
consegue gerenciar o próprio host** — sem systemd, sem nginx do host, sem vhosts
de sites gerenciados; para isso use a Opção 1. Ele não inclui nginx e nunca
redireciona para HTTPS, o que o torna o alvo ideal para colocar seu próprio proxy
reverso na frente — consulte
[Rodar atrás do seu próprio proxy reverso](INSTALLATION.md#running-behind-your-own-reverse-proxy).

### Opção 3: Instalação Manual

Consulte o [Guia de Instalação](INSTALLATION.md) para instruções passo a passo.

### Requisitos

| | Mínimo | Recomendado |
|---|---------|-------------|
| **SO** | Ubuntu 22.04+ · Debian 12+ · Fedora · RHEL/Rocky/AlmaLinux 9+ | Ubuntu 24.04 LTS |
| **Arquitetura** | x86_64 · ARM64 | x86_64 · ARM64 |
| **CPU** | 1 vCPU | 2+ vCPU |
| **RAM** | 1 GB | 2+ GB |
| **Disco** | 10 GB | 20+ GB |
| **Docker** | 24.0+ (opcional para o painel) | Mais recente |

> Estes requisitos orientam o dimensionamento; não são um teste de capacidade. Reserve RAM e disco adicionais para apps, imagens, bancos, logs e backups. Consulte o [guia de medição](METRICS.md) para medir sua carga de trabalho.

---

## 📸 Capturas de Tela

> Capturadas em um build de demonstração com dados fictícios — todos os hostnames, IPs, domínios e métricas abaixo são fictícios.

|                            Dashboard                             |                            Serviços                            |
| :--------------------------------------------------------------: | :------------------------------------------------------------: |
|      ![Dashboard](screenshots/dashboard.png)       |      ![Serviços](screenshots/services.png)       |
|   _Métricas do servidor em tempo real, cartões de KPI e atividade recente_   |   _Aplicações estáticas, Node.js, Python, PHP e Docker_   |

|                             Docker                              |                           WordPress                            |
| :-------------------------------------------------------------: | :------------------------------------------------------------: |
|         ![Docker](screenshots/docker.png)         |      ![WordPress](screenshots/wordpress.png)     |
| _Containers, imagens, volumes e redes com CPU/RAM em tempo real_ | _Status por site, Ações Rápidas e verificações de saúde ao vivo_ |

|                           Frota de Agentes                            |                           Marketplace                           |
| :--------------------------------------------------------------: | :-------------------------------------------------------------: |
|            ![Frota de Agentes](screenshots/fleet.png)            |      ![Marketplace](screenshots/marketplace.png)      |
|      _Saúde da frota, distribuição de versões e fila de comandos_      |     _Templates de aplicações em um clique e extensões instaláveis_     |

|                           Monitoramento                            |                            Segurança                             |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|      ![Monitoramento](screenshots/monitoring.png)      |         ![Segurança](screenshots/security.png)         |
|   _Medidores ao vivo, regras de alerta e canais de notificação_   | _Pontuação de postura, ClamAV, integridade de arquivos, firewall, Fail2Ban_ |

<details>
<summary><strong>Ver todas as capturas de tela</strong></summary>

<br>

|                          Assistente de IA                           |                          Detalhe do Serviço                          |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|            ![Assistente de IA](screenshots/ai.png)             |   ![Detalhe do Serviço](screenshots/service-detail.png)   |
|     _Assistente com tecnologia Prompture que executa ferramentas na sua infraestrutura_     | _Deploys, conexão git, uso em tempo real, logs e configurações_ |

|                            Bancos de Dados                            |                           Console SQL                            |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|        ![Bancos de Dados](screenshots/databases.png)        |            ![Console SQL](screenshots/sql.png)            |
|   _Explorador MySQL / PostgreSQL / SQLite com árvore de origem_   |     _Execute SQL pelo navegador com uma grade de resultados tipada_     |

|                             Domínios                             |                            Zonas DNS                             |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|          ![Domínios](screenshots/domains.png)          |              ![Zonas DNS](screenshots/dns.png)              |
|      _Status SSL, acompanhamento de expiração e renovação automática_      | _Cloudflare, Route 53, DigitalOcean — edição completa de registros_ |

|                             Backups                             |                               E-mail                               |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|          ![Backups](screenshots/backups.png)          |               ![E-mail](screenshots/email.png)               |
|     _Backups agendados com sincronização S3/B2 e restauração em um clique_     |   _Postfix, Dovecot, OpenDKIM, SpamAssassin e Roundcube_   |

|                            Cron Jobs                            |                          Gerenciador de Arquivos                           |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|            ![Cron Jobs](screenshots/cron.png)            |           ![Gerenciador de Arquivos](screenshots/files.png)           |
|       _Editor visual de cron com agendamento legível por humanos_       |    _Navegue, edite e envie arquivos com uso de disco por ponto de montagem_    |

|                         Logs & Terminal                         |                             Servidores                             |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|         ![Logs & Terminal](screenshots/terminal.png)         |           ![Servidores](screenshots/servers.png)           |
|      _Visualizador de logs, lista de processos, journald e sessões SSH_      |   _Todos os servidores em um painel com telemetria de CPU/RAM/disco ao vivo_   |

|                          Acesso Remoto                           |                             Configurações                            |
| :--------------------------------------------------------------: | :-------------------------------------------------------------: |
|    ![Acesso Remoto](screenshots/remote-access.png)    |          ![Configurações](screenshots/settings.png)          |
| _Exponha publicamente serviços atrás de NAT via agentes pareados por WireGuard_ |  _Perfil, aparência/identidade visual, usuários e conexões_  |

|                              Login                              |                                                                 |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|              ![Login](screenshots/login.png)              |                                                                 |
|    _Login com e-mail/senha, com suporte a SSO e 2FA_    |                                                                 |

</details>

## 🎯 Funcionalidades

> **O núcleo está completo em funcionalidades.** Novos recursos são entregues como **extensões** instaláveis pelo Marketplace integrado — o núcleo permanece enxuto e estável, com o trabalho em andamento focado em refinamentos de UI e correções reportadas pela comunidade.

### 🚀 Aplicações & Deploy

| | |
|---|---|
| **WordPress em Um Clique**<br>Sites PHP-FPM 8.x publicados em subdomínios reais, com pré-visualizações por troca de URL, domínios personalizados e HTTPS wildcard. | **Qualquer Stack**<br>Flask/Django no Gunicorn, Node.js no PM2, sites estáticos — a partir do Git, Docker, um caminho manual ou um upload zip. |
| **Docker & Compose**<br>Detecção de atualizações de imagem com aplicação em um clique, suspensão automática de containers ociosos, auto-escalonamento orientado por CPU, logs ao vivo e acesso ao terminal. | **Marketplace**<br>Mais de 100 templates de aplicações em um clique sobre um schema declarativo com secrets, hosts e URLs resolvidos automaticamente — nada fixo no código. |
| **Build Packs**<br>Deploys sem Dockerfile: inspeciona um repositório e gera um Dockerfile + compose a partir de um plano de build. | **Automações**<br>Automação visual baseada em nós para tarefas, deploys e CI/CD — gatilhos de cron, webhook e eventos, executando em um container gerenciado. Entregue como extensão. |
| **Prévias & Snapshots**<br>Ambientes efêmeros de prévia de PR, além de snapshots de configuração imutáveis e com secrets mascarados, com diff e restauração em um clique. | **Projetos & Ambientes**<br>Agrupamento Workspace → Projeto → Ambiente, e um pipeline WordPress prod/staging/dev com promoção de código e banco de dados. |

### 🏗️ Infraestrutura

| | |
|---|---|
| **Domínios & SSL**<br>Virtual hosts Nginx, Let's Encrypt automático com renovação, TLS 1.2+/AEAD reforçado, configurações compatíveis com Cloudflare, CAA automático. | **Zonas DNS**<br>Gerenciamento completo de registros no Cloudflare, Route 53 e DigitalOcean — verificações de propagação e DNS dinâmico para IPs que mudam. |
| **Bancos de Dados**<br>MySQL/MariaDB e PostgreSQL com gerenciamento de usuários, árvore de origem ao vivo e um console SQL no navegador. | **Provisionamento em Nuvem**<br>Crie servidores na DigitalOcean, Hetzner, Vultr e Linode com acompanhamento de custos. |
| **Hub de Conexões**<br>Provedores Git, nuvens, DNS, registradores, relays SMTP e armazenamento S3/B2 — todas as contas externas em um só lugar, criptografadas em repouso. | **Backups**<br>Backups agendados de aplicações/bancos de dados/arquivos para S3, B2 ou local, com políticas de retenção, restauração em um clique e criptografia opcional do lado do cliente. |
| **Arquivos, FTP & Cron**<br>Gerenciador de arquivos web com navegação de buckets S3/B2, gerenciamento de usuários vsftpd e um editor visual de cron. | **Servidor de E-mail**<br>Postfix + Dovecot com DKIM/SPF/DMARC, SpamAssassin, webmail Roundcube e regras de encaminhamento. |

### 🔒 Segurança

| | |
|---|---|
| **Firewall de Aplicações Web**<br>ModSecurity v3 + OWASP Core Rule Set por aplicação, com modos de detecção/bloqueio e paranoia ajustável. | **Passkeys & 2FA**<br>Login sem senha com WebAuthn (chaves de hardware, Touch ID, Windows Hello) mais TOTP com códigos de recuperação. |
| **Malware & Integridade**<br>Varredura com ClamAV e quarentena, monitoramento de integridade de arquivos e auditorias de vulnerabilidades com Lynis. | **SSH & Reforço**<br>Fail2ban, gerenciamento de chaves SSH, listas de permissão/bloqueio de IP e atualizações automáticas de segurança do SO. |
| **Varredura de Containers**<br>Varredura de CVEs por imagem com grype e geração de SBOM com syft. | **Secrets Criptografados**<br>Credenciais de provedores e secrets selados com Fernet, além de um gateway de webhooks de entrada para automação externa. |

### 🖥️ Multi-Servidor

| | |
|---|---|
| **Agente Multiplataforma**<br>Agente em Go para Linux, Windows e macOS — autenticação HMAC-SHA256 sobre um gateway WebSocket em tempo real. Serviço nativo do Windows + MSI, `.deb`/`.rpm`, ARM64. [Mais →](https://github.com/jhd3197/serverkit-agent) | **Gerenciamento de Frota**<br>Inventário, fila de aprovação, distribuição escalonada de versões, descoberta automática na LAN e uma fila de comandos offline. |
| **Registro Fácil**<br>Pareamento por código curto com verificação de fingerprint ou tokens pré-compartilhados; credenciais de host armazenadas com criptografia AES-GCM. [Mais →](pairing.md) | **Monitor de Frota**<br>Mapas de calor entre servidores, comparações de métricas, limiares de alerta, detecção de anomalias e previsão de capacidade. |
| **Templates de Servidor**<br>Templates de estado esperado com detecção de desvio, dashboards de conformidade e correção automática. | **Túneis de Acesso Remoto**<br>Exponha um serviço privado/atrás de NAT através de um servidor de borda usando WireGuard gerenciado pelo agente — sem redirecionamento de portas. |
| **Onboarding Guiado**<br>Validar → pré-requisitos → Docker → parear agente, com um log de progresso ao vivo. | **Proxy por Servidor**<br>Traefik ou Caddy dockerizados e opcionais por servidor, com prévia do compose; o nginx do host continua sendo o padrão. |

### 📊 Monitoramento & Alertas

| | |
|---|---|
| **Métricas em Tempo Real**<br>CPU, RAM, disco e rede via WebSocket, com retenção histórica e acompanhamento de uptime. | **Monitoramento de GPU**<br>Utilização, memória e temperatura de GPUs NVIDIA, além de uso por processo e por container. |
| **Páginas de Status**<br>Páginas públicas com verificações HTTP/TCP/DNS/Ping, monitoramento de componentes e gerenciamento de incidentes. | **Notificações**<br>Discord, Slack, Telegram, e-mail HTML e webhooks — canais por usuário, filtros de severidade e horários de silêncio. |

### 👥 Equipe & Acesso

| | |
|---|---|
| **Workspaces**<br>Isolamento multi-tenant com quotas e gerenciamento de membros. | **RBAC**<br>Papéis de admin/desenvolvedor/visualizador com permissões granulares de leitura/escrita por funcionalidade. |
| **SSO & OAuth**<br>Google, GitHub, OpenID Connect e SAML 2.0 com vinculação de contas. | **Chaves de API**<br>Chaves em camadas com rate limiting, escopos refinados, análise de uso e documentação OpenAPI. |
| **Log de Auditoria**<br>Cada ação do usuário registrada, com um dashboard detalhado de atividades. | **Webhooks & Configuração Compartilhada**<br>Assinaturas de saída com assinaturas HMAC e retentativas, além de tags e grupos de variáveis compartilhados. |

### 🎨 Personalização

| | |
|---|---|
| **Enxuto por Padrão**<br>O assistente de configuração instala apenas as extensões que correspondem aos seus casos de uso — adicione mais quando quiser pelo Marketplace. | **Presets de Barra Lateral**<br>Visões Completa, Hospedagem Web, Admin de E-mail, DevOps ou Mínima, com grupos recolhíveis e layouts por usuário. |
| **Sua Marca**<br>8 cores de destaque predefinidas mais um seletor hexadecimal personalizado, e logo, nome ou banner white-label. | **Widgets do Dashboard**<br>Ative e reordene widgets para se adequar ao seu fluxo de trabalho. |

---

## 🏗️ Arquitetura

<img width="100%" alt="Arquitetura do ServerKit: clientes e visitantes públicos chegam a uma camada de borda nginx que divide o tráfego do painel para a API Flask e o tráfego público para os containers das aplicações; o painel ServerKit contém a SPA React, a API REST, o gateway de agentes Socket.IO, os serviços, models, jobs, notificações e o runtime de extensões; uma camada de runtime no mesmo servidor contém os containers Docker das aplicações, os bancos de dados e o estado do painel; uma frota remota de agentes em Go se conecta de volta pelo namespace /agent." src="images/architecture/system-overview.png" />

O **Nginx** termina o TLS e divide o tráfego em dois caminhos: as requisições do painel vão para a **API Flask**, todo o resto é encaminhado por proxy para o **container Docker** que serve aquele domínio. O painel mantém seu próprio estado em SQLite ou PostgreSQL, executa trabalho em segundo plano através de um agendador de jobs e de um barramento de notificações, e carrega funcionalidades opcionais a partir do **runtime de extensões**. Servidores remotos são gerenciados por um **agente em Go** que se conecta de volta através de um namespace Socket.IO.

<details>
<summary><strong>Ver como diagrama ASCII</strong></summary>

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

**[Ver Documentação Completa da Arquitetura →](ARCHITECTURE.md)** — Fluxo de requisições, plataforma de extensões, sistema de templates, alocação de portas, jobs, notificações e a frota de agentes.

---

## 🗺️ Roadmap

**O núcleo do ServerKit está completo em funcionalidades** — todas as fases centrais planejadas foram entregues, desde a infraestrutura inicial em Flask + React até frotas multi-servidor, SSO, o motor de automação e o marketplace de extensões.

O desenvolvimento agora acontece em duas frentes:

- **🧩 Extensões** — novas funcionalidades são entregues como extensões instaláveis pelo Marketplace (mais de 100 templates em um clique, e crescendo). O núcleo permanece enxuto; você instala apenas o que precisa.
- **✨ Refinamento do núcleo** — refinamentos contínuos de UI/UX e correções para problemas reportados pela comunidade. Nenhuma nova funcionalidade central está planejada.

Histórico completo: [ROADMAP.md](../ROADMAP.md)

---

## 📖 Documentação

| Documento | Descrição |
|----------|-------------|
| [Arquitetura](ARCHITECTURE.md) | Design do sistema, fluxo de requisições, diagramas |
| [Guia de Instalação](INSTALLATION.md) | Instruções completas de configuração |
| [Guia de Deploy](DEPLOYMENT.md) | Comandos CLI e deploy em produção |
| [Agente](https://github.com/jhd3197/serverkit-agent) | Instale e execute o agente multi-servidor (Linux/Windows/macOS) — repositório separado |
| [Pareamento de Agentes](pairing.md) | Registro seguro de agentes por código curto |
| [Referência da API](API.md) | Endpoints da API REST |
| [Novas Funcionalidades](NEW_FEATURES.md) | Referência de endpoints e páginas das funcionalidades mais recentes de `dev` |
| [Melhorias](ENHANCEMENTS.md) | Guia das dez capacidades de experiência do desenvolvedor, equipe/escala, frota e segurança |
| [Changelog](../CHANGELOG.md) | Histórico de releases e mudanças notáveis |
| [Roadmap](../ROADMAP.md) | Roadmap de desenvolvimento e funcionalidades planejadas |
| [Contribuindo](../CONTRIBUTING.md) | Como contribuir |

---

## 🧱 Stack Tecnológica

| Camada | Tecnologia |
|-------|------------|
| Backend | Python 3.11, Flask, SQLAlchemy, Flask-SocketIO, Flask-Migrate |
| Frontend | React 18, Vite, SCSS, Recharts |
| Banco de Dados | SQLite / PostgreSQL |
| Servidor Web | Nginx, Gunicorn (worker único com threads — `-w 1 --threads N`) |
| Containers | Docker, Docker Compose |
| Segurança | ClamAV, Lynis, Fail2ban, ModSecurity v3 + OWASP CRS, grype, syft, TOTP (pyotp), criptografia Fernet |
| Autenticação | JWT, OAuth 2.0, OIDC, SAML 2.0, WebAuthn / passkeys |
| E-mail | Postfix, Dovecot, SpamAssassin, Roundcube |
| Agente | Go (multi-servidor), HMAC-SHA256, WebSocket |

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor, leia o [CONTRIBUTING.md](../CONTRIBUTING.md) primeiro.

```
fork → branch de feature → commit → push → pull request
```

**Áreas prioritárias:** Extensões do Marketplace, melhorias de UI/UX, documentação, cobertura de testes.

---

## 💛 Apoie o ServerKit

O ServerKit é gratuito e de código aberto. Se ele economiza o seu tempo, você pode ajudar a mantê-lo:

- ⭐ [Dê uma estrela ao repositório](https://github.com/jhd3197/ServerKit) — não custa nada e ajuda muito
- 💖 [GitHub Sponsors](https://github.com/sponsors/jhd3197)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/jhd3197)

### 💎 Criptomoedas

| | Ativo | Rede | Endereço |
|:---:|---|---|---|
| <img src="images/funding/usdt-trc20.png" width="110" alt="Código QR do endereço de doação USDT TRC-20" /> | **USDT** | **TRC-20** · Tron | `TTiCtqLauF1iSW2YGB3b78KmRxRqoLCgeL` |
| <img src="images/funding/usdt-erc20.png" width="110" alt="Código QR do endereço de doação USDT e ETH ERC-20" /> | **USDT / ETH** | **ERC-20** · Ethereum | `0xD13D5355Fa214e8317fea2ff192a065BaeC13527` |
| <img src="images/funding/btc.png" width="110" alt="Código QR do endereço de doação de Bitcoin" /> | **BTC** | **Bitcoin** | `bc1qatx67n3qxdvuv3arc9j8aytk34f22g02k9c7vr` |
| <img src="images/funding/sol.png" width="110" alt="Código QR do endereço de doação de Solana" /> | **SOL** | **Solana** | `AWXzqtBEgUfteHPQtDegsZ6D5y57M3GGdKPD8rR7h6xu` |

A TRC-20 tem as taxas mais baixas — normalmente menos de um dólar — e por isso é a
opção mais prática para uma doação pequena. O gas da ERC-20 pode custar mais do que
a própria doação.

<sub>Os códigos QR são gerados localmente por [`scripts/generate-funding-qr.mjs`](../scripts/generate-funding-qr.mjs), que valida o checksum de cada endereço antes de codificá-lo.</sub>

---

## 🔭 Projetos Relacionados

**[Faro](https://github.com/jhd3197/faro)** — Um cliente de desktop moderno para SFTP, FTP, SSH e armazenamento compatível com S3, do mesmo autor. Salve um servidor uma vez e depois navegue pelos seus arquivos em uma visão de painel duplo e abra um terminal sobre a mesma sessão SSH — além de transferências com arrastar e soltar, sincronização de diretórios em um sentido e edição no lugar. Ele ainda tem um **Agent Bridge** que permite ao Claude Code (ou qualquer agente MCP) executar comandos em um servidor através da sua sessão autenticada, com aprovação por comando e sem compartilhar credenciais.

> O ServerKit gerencia seus servidores pelo navegador; o Faro é o companheiro de desktop para transferência de arquivos, shells e trabalho pontual em todos os seus servidores. [Baixe uma versão →](https://github.com/jhd3197/faro/releases/latest)

**[LocalKit](https://github.com/jhd3197/LocalKit)** — Crie sites WordPress locais em um clique. Cada site roda como seu próprio projeto Docker Compose isolado, e você pode enviar código ou enviar/baixar bancos de dados diretamente para o seu servidor ServerKit através da extensão `serverkit-localkit`.

**[DeviceKit](https://github.com/jhd3197/DeviceKit)** — Uma plataforma unificada de frota de dispositivos Android e automação de testes. Controle uma frota de dispositivos a partir de um único dashboard — execute automações, transmita telas em tempo real, detecte regressões visuais e depure falhas com análise assistida por IA.

---

## 💬 Comunidade

[![Discord](https://img.shields.io/badge/Discord-Junte--se_a_Nós-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/ZKk6tkCQfG)

Entre no Discord para tirar dúvidas, compartilhar feedback ou obter ajuda com sua configuração.

---

<div align="center">

**ServerKit** — Simples. Moderno. Auto-hospedado.

[Reportar Bug](https://github.com/jhd3197/ServerKit/issues) · [Solicitar Funcionalidade](https://github.com/jhd3197/ServerKit/issues)

Feito com ❤️ por [Juan Denis](https://juandenis.com)

</div>
