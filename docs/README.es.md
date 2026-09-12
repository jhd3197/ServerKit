<div align="center">

<img width="100%" alt="ServerKit — Despliega, gestiona y monitorea servidores" src="screenshots/poster.png" />

# ServerKit

**Despliega, gestiona y monitorea servidores.**

Un panel de control de servidores ligero y moderno para gestionar aplicaciones web, bases de datos,
contenedores Docker y seguridad — sin la complejidad de Kubernetes
ni el coste de las plataformas gestionadas.

[English](../README.md) | Español | [中文版](README.zh-CN.md) | [Português](README.pt.md)

<br>

![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
[![Discord](https://img.shields.io/discord/1470639209059455008?style=for-the-badge&logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/ZKk6tkCQfG)
[![Ver la demo](https://img.shields.io/badge/Ver_la_Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=TXfXFz6bVjs&list=PLShBdCqh2m8E)

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

[Inicio Rápido](#-inicio-rápido) · [Guía en video](#guía-en-video) · [Capturas](#-capturas-de-pantalla) · [Funcionalidades](#-funcionalidades) · [Arquitectura](#-arquitectura) · [Hoja de Ruta](#-hoja-de-ruta) · [Documentación](#-documentación) · [Contribuir](#-contribuir) · [Discord](#-comunidad)

</div>

---

## Guía en video

Elige una plantilla o usa tu propio código. Mira ambas formas de desplegar en YouTube.

<table>
  <tr>
    <th width="50%">De una plantilla a una app en funcionamiento</th>
    <th width="50%">Cualquier repositorio Git en 3 pasos</th>
  </tr>
  <tr>
    <td valign="top">
      <a href="https://youtu.be/TXfXFz6bVjs"><img src="videos/template-to-live-app.png" width="100%" alt="De una plantilla a una app en funcionamiento" /></a>
      <p>Despliega AgentSite desde el catálogo de plantillas, comprueba la capacidad y sigue la compilación en directo.</p>
      <p><strong><a href="https://youtu.be/TXfXFz6bVjs">▶ Ver en YouTube · 4:16</a></strong></p>
      <p><a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=27s">Catálogo</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=71s">Panel de despliegue</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=123s">Capacidad</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=151s">Compilación en directo</a></p>
    </td>
    <td valign="top">
      <a href="https://youtu.be/Fv28qMERYDU"><img src="videos/deploy-git-repo.png" width="100%" alt="Cualquier repositorio Git en 3 pasos" /></a>
      <p>Conecta un repositorio Git, revisa la configuración detectada y despliega con el asistente de nuevo servicio.</p>
      <p><strong><a href="https://youtu.be/Fv28qMERYDU">▶ Ver en YouTube · 3:45</a></strong></p>
      <p><a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=25s">Fuentes</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=70s">Conectar repositorio</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=117s">Revisar configuración</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=160s">Despliegue automático</a></p>
    </td>
  </tr>
</table>

---

## 📊 En Números

<!-- BEGIN GENERATED MEASUREMENTS -->
Instantánea: **2026-09-05**. [Definiciones, medidas y comandos para reproducirlas](METRICS.md).

| | |
|---|---|
| **1.212** declaraciones de rutas del núcleo | en **104** declaraciones de blueprints de `backend/app/api`; inventario del código, sin extensiones |
| **118** plantillas de apps incluidas | archivos YAML de apps en el directorio raíz; las plantillas de extensiones de bases de datos se cuentan aparte |
| **5.089** casos de prueba de backend recopilados | recopilación de un checkout limpio; no significa que todos se hayan ejecutado o aprobado |
| **3,31 MB** de JS/CSS en total, comprimido con gzip | incluye módulos diferidos, idiomas y adaptadores de dependencias; excluye fuentes e imágenes |
| **$0** de licencia | Licencia MIT, sin suscripciones ni tarifas por usuario |

Los valores gzip suman archivos comprimidos por separado a nivel 9; no son tiempos de carga medidos. La RAM y el tamaño de imagen dependen de la compilación, plataforma y carga de trabajo.
<!-- END GENERATED MEASUREMENTS -->

---

## 🚀 Inicio Rápido

> El tiempo de instalación depende del servidor, la red y los paquetes necesarios.

### Opción 1: Instalación en Una Línea (Recomendada)

```bash
curl -fsSL https://serverkit.ai/install.sh | bash
```

> Funciona en Ubuntu 22.04+, Debian 12+, Fedora y RHEL/Rocky/AlmaLinux 9+. Configura todo automáticamente.
>
> Opcional: `PANEL_DOMAIN=panel.example.com` establece el dominio e intenta obtener un certificado de Let's Encrypt; `SERVERKIT_OFFLINE_TARBALL=...` instala desde un tarball local.

### Actualización

```bash
sudo serverkit update
```

Actualización atómica blue/green con comprobaciones previas, copia de seguridad de la
base de datos, migración y rollback automático. Usa `--dry-run` para previsualizar,
`--branch dev` para compilaciones de desarrollo o `--release [versión]` para tarballs de release.

### Opción 2: Docker

```bash
git clone https://github.com/jhd3197/ServerKit.git
cd ServerKit
cp .env.example .env       # luego edita .env con tus claves
docker compose up -d       # accede en http://localhost:5000
```

Ejecuta el panel como un único contenedor. Ten en cuenta que un panel en
contenedor **no puede administrar su propio host** — sin systemd, sin nginx del
host, sin vhosts de sitios gestionados; para eso usa la Opción 1. No incluye
nginx y nunca redirige a HTTPS, así que es el destino ideal para poner tu propio
proxy inverso delante — consulta
[Ejecutar detrás de tu propio proxy inverso](INSTALLATION.md#running-behind-your-own-reverse-proxy).

### Opción 3: Instalación Manual

Consulta la [Guía de Instalación](INSTALLATION.md) para instrucciones paso a paso.

### Requisitos

| | Mínimo | Recomendado |
|---|---------|-------------|
| **SO** | Ubuntu 22.04+ · Debian 12+ · Fedora · RHEL/Rocky/AlmaLinux 9+ | Ubuntu 24.04 LTS |
| **Arquitectura** | x86_64 · ARM64 | x86_64 · ARM64 |
| **CPU** | 1 vCPU | 2+ vCPU |
| **RAM** | 1 GB | 2+ GB |
| **Disco** | 10 GB | 20+ GB |
| **Docker** | 24.0+ (opcional para el panel) | Última versión |

> Estos requisitos orientan el dimensionamiento; no son una prueba de capacidad. Reserva RAM y disco adicionales para apps, imágenes, bases de datos, registros y copias de seguridad. Consulta la [guía de medición](METRICS.md) para medir tu carga de trabajo.

---

## 📸 Capturas de Pantalla

> Capturadas desde una compilación de demostración con datos ficticios — todos los nombres de host, IP, dominios y métricas que se ven a continuación son inventados.

|                            Panel Principal                             |                            Servicios                            |
| :--------------------------------------------------------------: | :------------------------------------------------------------: |
|      ![Panel Principal](screenshots/dashboard.png)       |      ![Servicios](screenshots/services.png)       |
|   _Métricas del servidor en vivo, tarjetas KPI y actividad reciente_   |   _Aplicaciones estáticas, Node.js, Python, PHP y Docker_   |

|                             Docker                              |                           WordPress                            |
| :-------------------------------------------------------------: | :------------------------------------------------------------: |
|         ![Docker](screenshots/docker.png)         |      ![WordPress](screenshots/wordpress.png)     |
| _Contenedores, imágenes, volúmenes y redes con CPU/RAM en vivo_ | _Estado por sitio, Acciones Rápidas y comprobaciones de salud en vivo_ |

|                           Flota de Agentes                            |                           Marketplace                           |
| :--------------------------------------------------------------: | :-------------------------------------------------------------: |
|            ![Flota de Agentes](screenshots/fleet.png)            |      ![Marketplace](screenshots/marketplace.png)      |
|      _Salud de la flota, despliegues de versiones y cola de comandos_      |     _Plantillas de aplicaciones en un clic y extensiones instalables_     |

|                           Monitorización                            |                            Seguridad                             |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|      ![Monitorización](screenshots/monitoring.png)      |         ![Seguridad](screenshots/security.png)         |
|   _Indicadores en vivo, reglas de alerta y canales de notificación_   | _Puntuación de postura, ClamAV, integridad de archivos, firewall, Fail2Ban_ |

<details>
<summary><strong>Ver todas las capturas</strong></summary>

<br>

|                          Asistente de IA                           |                          Detalle de Servicio                          |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|            ![Asistente de IA](screenshots/ai.png)             |   ![Detalle de Servicio](screenshots/service-detail.png)   |
|     _Asistente impulsado por Prompture que ejecuta herramientas sobre tu infraestructura_     | _Despliegues, conexión con Git, uso en vivo, logs y ajustes_ |

|                            Bases de Datos                            |                           Consola SQL                            |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|        ![Bases de Datos](screenshots/databases.png)        |            ![Consola SQL](screenshots/sql.png)            |
|   _Explorador de MySQL / PostgreSQL / SQLite con árbol de orígenes_   |     _Ejecuta SQL desde el navegador con una tabla de resultados tipada_     |

|                             Dominios                             |                            Zonas DNS                             |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|          ![Dominios](screenshots/domains.png)          |              ![Zonas DNS](screenshots/dns.png)              |
|      _Estado SSL, seguimiento de caducidad y renovación automática_      | _Cloudflare, Route 53, DigitalOcean — edición completa de registros_ |

|                             Copias de Seguridad                             |                               Correo                               |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|          ![Copias de Seguridad](screenshots/backups.png)          |               ![Correo](screenshots/email.png)               |
|     _Copias programadas con sincronización a S3/B2 y restauración en un clic_     |   _Postfix, Dovecot, OpenDKIM, SpamAssassin y Roundcube_   |

|                            Tareas Programadas                            |                          Gestor de Archivos                           |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|            ![Tareas Programadas](screenshots/cron.png)            |           ![Gestor de Archivos](screenshots/files.png)           |
|       _Editor visual de cron con horarios legibles por humanos_       |    _Navega, edita y sube archivos con uso de disco por punto de montaje_    |

|                         Logs y Terminal                         |                             Servidores                             |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|         ![Logs y Terminal](screenshots/terminal.png)         |           ![Servidores](screenshots/servers.png)           |
|      _Visor de logs, lista de procesos, journald y sesiones SSH_      |   _Todos los servidores en un panel con telemetría de CPU/RAM/disco en vivo_   |

|                          Acceso Remoto                           |                             Ajustes                            |
| :--------------------------------------------------------------: | :-------------------------------------------------------------: |
|    ![Acceso Remoto](screenshots/remote-access.png)    |          ![Ajustes](screenshots/settings.png)          |
| _Expón públicamente servicios tras NAT mediante agentes emparejados con WireGuard_ |  _Perfil, apariencia/marca, usuarios y conexiones_  |

|                              Inicio de Sesión                              |                                                                 |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|              ![Inicio de Sesión](screenshots/login.png)              |                                                                 |
|    _Acceso con email/contraseña, con soporte para SSO y 2FA_    |                                                                 |

</details>

## 🎯 Funcionalidades

> **El núcleo está completo.** Las nuevas capacidades se distribuyen como **extensiones** instalables desde el Marketplace integrado — el núcleo se mantiene ligero y estable, y el trabajo en curso se centra en pulir la UI y corregir lo que reporta la comunidad.

### 🚀 Aplicaciones y Despliegue

| | |
|---|---|
| **WordPress en Un Clic**<br>Sitios PHP-FPM 8.x publicados en subdominios reales, con vistas previas mediante intercambio de URL, dominios personalizados y HTTPS comodín. | **Cualquier Stack**<br>Flask/Django sobre Gunicorn, Node.js sobre PM2, sitios estáticos — desde Git, Docker, una ruta manual o la subida de un zip. |
| **Docker y Compose**<br>Detección de actualizaciones de imagen con aplicación en un clic, suspensión automática de contenedores inactivos, autoescalado según la CPU, logs en vivo y acceso a terminal. | **Marketplace**<br>Más de 100 plantillas de aplicaciones en un clic sobre un esquema declarativo con secretos, hosts y URLs resueltos automáticamente — nada codificado a mano. |
| **Build Packs**<br>Despliegues sin Dockerfile: inspecciona un repositorio y genera un Dockerfile + compose a partir de un plan de compilación. | **Automatizaciones**<br>Automatización visual basada en nodos para tareas, despliegues y CI/CD — disparadores por cron, webhook y eventos, ejecutándose en un contenedor gestionado. Se distribuye como extensión. |
| **Vistas Previas e Instantáneas**<br>Entornos de vista previa efímeros para PRs, además de instantáneas de configuración inmutables y con secretos enmascarados, con diff y restauración en un clic. | **Proyectos y Entornos**<br>Agrupación Espacio de trabajo → Proyecto → Entorno, y un flujo de WordPress prod/staging/dev con promoción de código y base de datos. |

### 🏗️ Infraestructura

| | |
|---|---|
| **Dominios y SSL**<br>Hosts virtuales Nginx, Let's Encrypt automático con renovación, TLS 1.2+/AEAD reforzado, configuraciones compatibles con Cloudflare y CAA automático. | **Zonas DNS**<br>Gestión completa de registros en Cloudflare, Route 53 y DigitalOcean — comprobaciones de propagación y DNS dinámico para IPs cambiantes. |
| **Bases de Datos**<br>MySQL/MariaDB y PostgreSQL con gestión de usuarios, un árbol de orígenes en vivo y una consola SQL en el navegador. | **Aprovisionamiento en la Nube**<br>Levanta servidores en DigitalOcean, Hetzner, Vultr y Linode con seguimiento de costes. |
| **Centro de Conexiones**<br>Proveedores Git, nubes, DNS, registradores, relés SMTP y almacenamiento S3/B2 — todas las cuentas externas en un solo lugar, cifradas en reposo. | **Copias de Seguridad**<br>Copias programadas de aplicaciones, bases de datos y archivos hacia S3, B2 o local, con políticas de retención, restauración en un clic y cifrado opcional en el cliente. |
| **Archivos, FTP y Cron**<br>Gestor de archivos web con navegación de buckets S3/B2, gestión de usuarios de vsftpd y un editor visual de cron. | **Servidor de Correo**<br>Postfix + Dovecot con DKIM/SPF/DMARC, SpamAssassin, webmail Roundcube y reglas de reenvío. |

### 🔒 Seguridad

| | |
|---|---|
| **Firewall de Aplicaciones Web**<br>ModSecurity v3 + OWASP Core Rule Set por aplicación, con modos de detección/bloqueo y paranoia ajustable. | **Passkeys y 2FA**<br>Inicio de sesión sin contraseña con WebAuthn (llaves de hardware, Touch ID, Windows Hello) más TOTP con códigos de respaldo. |
| **Malware e Integridad**<br>Análisis con ClamAV y cuarentena, monitorización de integridad de archivos y auditorías de vulnerabilidades con Lynis. | **SSH y Refuerzo**<br>Fail2ban, gestión de claves SSH, listas de IPs permitidas/bloqueadas y actualizaciones de seguridad automáticas del sistema. |
| **Análisis de Contenedores**<br>Análisis de CVE por imagen con grype y generación de SBOM con syft. | **Secretos Cifrados**<br>Credenciales de proveedores y secretos sellados con Fernet, además de una pasarela de webhooks entrantes para automatización externa. |

### 🖥️ Multi-Servidor

| | |
|---|---|
| **Agente Multiplataforma**<br>Agente en Go para Linux, Windows y macOS — autenticación HMAC-SHA256 sobre una pasarela WebSocket en tiempo real. Servicio nativo de Windows + MSI, `.deb`/`.rpm`, ARM64. [Más →](https://github.com/jhd3197/serverkit-agent) | **Gestión de Flota**<br>Inventario, cola de aprobación, despliegues escalonados de versiones, descubrimiento automático en LAN y una cola de comandos sin conexión. |
| **Enrolamiento Sencillo**<br>Emparejamiento con código corto y verificación de huella o tokens precompartidos; las credenciales del host se almacenan cifradas con AES-GCM. [Más →](pairing.md) | **Monitor de Flota**<br>Mapas de calor entre servidores, comparación de métricas, umbrales de alerta, detección de anomalías y previsión de capacidad. |
| **Plantillas de Servidor**<br>Plantillas de estado esperado con detección de desviaciones, paneles de cumplimiento y auto-remediación. | **Túneles de Acceso Remoto**<br>Expón un servicio privado o tras NAT a través de un servidor de borde mediante WireGuard gestionado por el agente — sin redirección de puertos. |
| **Onboarding Guiado**<br>Validar → prerrequisitos → Docker → emparejar agente, con un registro de progreso en vivo. | **Proxy por Servidor**<br>Traefik o Caddy dockerizados y opcionales por servidor, con vista previa del compose; el nginx del host sigue siendo el predeterminado. |

### 📊 Monitorización y Alertas

| | |
|---|---|
| **Métricas en Tiempo Real**<br>CPU, RAM, disco y red vía WebSocket, con retención histórica y seguimiento de disponibilidad. | **Monitorización de GPU**<br>Utilización, memoria y temperatura de NVIDIA, con uso por proceso y por contenedor. |
| **Páginas de Estado**<br>Páginas públicas con comprobaciones HTTP/TCP/DNS/Ping, monitorización de componentes y gestión de incidentes. | **Notificaciones**<br>Discord, Slack, Telegram, email HTML y webhooks — canales por usuario, filtros de severidad y horas de silencio. |

### 👥 Equipo y Acceso

| | |
|---|---|
| **Espacios de Trabajo**<br>Aislamiento multi-inquilino con cuotas y gestión de miembros. | **RBAC**<br>Roles de administrador/desarrollador/observador con permisos granulares de lectura/escritura por funcionalidad. |
| **SSO y OAuth**<br>Google, GitHub, OpenID Connect y SAML 2.0 con vinculación de cuentas. | **Claves de API**<br>Claves por niveles con limitación de tasa, ámbitos detallados, analíticas de uso y documentación OpenAPI. |
| **Registro de Auditoría**<br>Cada acción de usuario queda registrada, con un panel de actividad detallado. | **Webhooks y Configuración Compartida**<br>Suscripciones salientes con firmas HMAC y reintentos, además de etiquetas y grupos de variables compartidos. |

### 🎨 Personalización

| | |
|---|---|
| **Ligero por Defecto**<br>El asistente de configuración instala solo las extensiones que encajan con tus casos de uso — añade más cuando quieras desde el Marketplace. | **Presets de Barra Lateral**<br>Vistas Completa, Hosting Web, Administración de Correo, DevOps o Mínima, con grupos plegables y diseños por usuario. |
| **Tu Marca**<br>8 colores de acento predefinidos más un selector hexadecimal personalizado, y logotipo, nombre o banner de marca blanca. | **Widgets del Panel**<br>Activa y reordena widgets para adaptarlos a tu flujo de trabajo. |

---

## 🏗️ Arquitectura

<img width="100%" alt="Arquitectura de ServerKit: los clientes y visitantes públicos llegan a una capa de borde nginx que dirige el tráfico del panel a la API de Flask y el tráfico público a los contenedores de aplicaciones; el panel de ServerKit contiene la SPA de React, la API REST, la pasarela de agentes Socket.IO, los servicios, modelos, trabajos, notificaciones y el runtime de extensiones; una capa de runtime en el mismo servidor alberga los contenedores Docker de aplicaciones, las bases de datos y el estado del panel; una flota remota de agentes en Go se conecta de vuelta a través del namespace /agent." src="images/architecture/system-overview.png" />

**Nginx** termina TLS y divide el tráfico en dos: las peticiones del panel van a la **API de Flask** y todo lo demás se redirige al **contenedor Docker** que sirve ese dominio. El panel mantiene su propio estado en SQLite o PostgreSQL, ejecuta trabajo en segundo plano mediante un planificador de tareas y un bus de notificaciones, y carga funcionalidad opcional desde el **runtime de extensiones**. Los servidores remotos se gestionan con un **agente en Go** que se conecta de vuelta a través de un namespace de Socket.IO.

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

**[Ver Documentación Completa de Arquitectura →](ARCHITECTURE.md)** — Flujo de peticiones, plataforma de extensiones, sistema de plantillas, asignación de puertos, trabajos, notificaciones y la flota de agentes.

---

## 🗺️ Hoja de Ruta

**El núcleo de ServerKit está completo** — todas las fases previstas del núcleo se han entregado, desde la primera infraestructura Flask + React hasta las flotas multi-servidor, SSO, el motor de automatización y el marketplace de extensiones.

El desarrollo ocurre ahora en dos frentes:

- **🧩 Extensiones** — la nueva funcionalidad se distribuye como extensiones instalables desde el Marketplace (más de 100 plantillas en un clic y creciendo). El núcleo se mantiene ligero; instalas solo lo que necesitas.
- **✨ Pulido del núcleo** — refinamientos continuos de UI/UX y correcciones de problemas reportados por la comunidad. No hay nuevas funcionalidades de núcleo planificadas.

Historial completo: [ROADMAP.md](../ROADMAP.md)

---

## 📖 Documentación

| Documento | Descripción |
|----------|-------------|
| [Arquitectura](ARCHITECTURE.md) | Diseño del sistema, flujo de peticiones, diagramas |
| [Guía de Instalación](INSTALLATION.md) | Instrucciones completas de configuración |
| [Guía de Despliegue](DEPLOYMENT.md) | Comandos CLI y despliegue en producción |
| [Agente](https://github.com/jhd3197/serverkit-agent) | Instala y ejecuta el agente multi-servidor (Linux/Windows/macOS) — repositorio aparte |
| [Emparejamiento del Agente](pairing.md) | Enrolamiento seguro del agente con código corto |
| [Referencia de la API](API.md) | Endpoints de la API REST |
| [Nuevas Funcionalidades](NEW_FEATURES.md) | Referencia de endpoints y páginas de las últimas funcionalidades de `dev` |
| [Mejoras](ENHANCEMENTS.md) | Guía de las diez capacidades de experiencia de desarrollo, equipo/escala, flota y seguridad |
| [Registro de Cambios](../CHANGELOG.md) | Historial de versiones y cambios destacados |
| [Hoja de Ruta](../ROADMAP.md) | Hoja de ruta de desarrollo y funcionalidades planificadas |
| [Contribuir](../CONTRIBUTING.md) | Cómo contribuir |

---

## 🧱 Stack Tecnológico

| Capa | Tecnología |
|-------|------------|
| Backend | Python 3.11, Flask, SQLAlchemy, Flask-SocketIO, Flask-Migrate |
| Frontend | React 18, Vite, SCSS, Recharts |
| Base de Datos | SQLite / PostgreSQL |
| Servidor Web | Nginx, Gunicorn (worker único con hilos — `-w 1 --threads N`) |
| Contenedores | Docker, Docker Compose |
| Seguridad | ClamAV, Lynis, Fail2ban, ModSecurity v3 + OWASP CRS, grype, syft, TOTP (pyotp), cifrado Fernet |
| Autenticación | JWT, OAuth 2.0, OIDC, SAML 2.0, WebAuthn / passkeys |
| Correo | Postfix, Dovecot, SpamAssassin, Roundcube |
| Agente | Go (multi-servidor), HMAC-SHA256, WebSocket |

---

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Por favor, lee primero [CONTRIBUTING.md](../CONTRIBUTING.md).

```
fork → feature branch → commit → push → pull request
```

**Áreas prioritarias:** Extensiones para el Marketplace, mejoras de UI/UX, documentación, cobertura de tests.

---

## 💛 Apoya a ServerKit

ServerKit es libre y de código abierto. Si te ahorra tiempo, puedes ayudar a mantenerlo en marcha:

- ⭐ [Dale una estrella al repositorio](https://github.com/jhd3197/ServerKit) — no cuesta nada y ayuda mucho
- 💖 [GitHub Sponsors](https://github.com/sponsors/jhd3197)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/jhd3197)

### 💎 Criptomonedas

| | Activo | Red | Dirección |
|:---:|---|---|---|
| <img src="images/funding/usdt-trc20.png" width="110" alt="Código QR de la dirección de donación USDT TRC-20" /> | **USDT** | **TRC-20** · Tron | `TTiCtqLauF1iSW2YGB3b78KmRxRqoLCgeL` |
| <img src="images/funding/usdt-erc20.png" width="110" alt="Código QR de la dirección de donación USDT y ETH ERC-20" /> | **USDT / ETH** | **ERC-20** · Ethereum | `0xD13D5355Fa214e8317fea2ff192a065BaeC13527` |
| <img src="images/funding/btc.png" width="110" alt="Código QR de la dirección de donación de Bitcoin" /> | **BTC** | **Bitcoin** | `bc1qatx67n3qxdvuv3arc9j8aytk34f22g02k9c7vr` |
| <img src="images/funding/sol.png" width="110" alt="Código QR de la dirección de donación de Solana" /> | **SOL** | **Solana** | `AWXzqtBEgUfteHPQtDegsZ6D5y57M3GGdKPD8rR7h6xu` |

TRC-20 tiene las comisiones más bajas — normalmente menos de un dólar — así que es
la opción más cómoda para una donación pequeña. El gas de ERC-20 puede costar más
que la propia donación.

<sub>Los códigos QR se generan localmente con [`scripts/generate-funding-qr.mjs`](../scripts/generate-funding-qr.mjs), que valida la suma de verificación de cada dirección antes de codificarla.</sub>

---

## 🔭 Proyectos Relacionados

**[Faro](https://github.com/jhd3197/faro)** — Un cliente de escritorio moderno para SFTP, FTP, SSH y almacenamiento compatible con S3, del mismo autor. Guarda un servidor una vez y luego explora sus archivos en una vista de doble panel y abre una terminal sobre la misma sesión SSH — además de transferencias con arrastrar y soltar, sincronización de directorios en un sentido y edición in situ. Incluso tiene un **Agent Bridge** que permite a Claude Code (o cualquier agente MCP) ejecutar comandos en un servidor a través de tu sesión autenticada, con aprobación por comando y sin compartir credenciales.

> ServerKit gestiona tus servidores desde el navegador; Faro es el compañero de escritorio para transferencias de archivos, shells y trabajo puntual en todos tus servidores. [Descarga una versión →](https://github.com/jhd3197/faro/releases/latest)

**[LocalKit](https://github.com/jhd3197/LocalKit)** — Levanta sitios WordPress locales en un clic. Cada sitio se ejecuta como su propio proyecto aislado de Docker Compose, y puedes enviar código o enviar/traer bases de datos directamente a tu servidor ServerKit mediante la extensión `serverkit-localkit`.

**[DeviceKit](https://github.com/jhd3197/DeviceKit)** — Una plataforma unificada de flota de dispositivos Android y automatización de pruebas. Controla una flota de dispositivos desde un solo panel — ejecuta automatizaciones, transmite pantallas en tiempo real, detecta regresiones visuales y depura fallos con análisis asistido por IA.

---

## 💬 Comunidad

[![Discord](https://img.shields.io/badge/Discord-Únete-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/ZKk6tkCQfG)

Únete al Discord para hacer preguntas, compartir comentarios u obtener ayuda con tu configuración.

---

<div align="center">

**ServerKit** — Simple. Moderno. Autoalojado.

[Reportar un Error](https://github.com/jhd3197/ServerKit/issues) · [Solicitar una Funcionalidad](https://github.com/jhd3197/ServerKit/issues)

Hecho con ❤️ por [Juan Denis](https://juandenis.com)

</div>
