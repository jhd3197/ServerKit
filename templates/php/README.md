# PHP Application Template

A Docker-based PHP application setup with nginx and optional MySQL.

## Quick Start

```bash
# Copy .env.example to .env and customize
cp .env.example .env

# Edit your settings
nano .env

# Start the app
docker compose up -d

# View logs
docker compose logs -f
```

## Configuration

Edit `.env` to customize:

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_NAME` | Container name prefix | `my-php-app` |
| `PORT` | External port | `8100` |
| `PHP_VERSION` | PHP version (8.0, 8.1, 8.2, 8.3) | `8.2` |
| `PHP_MEMORY_LIMIT` | Memory limit | `256M` |

## Structure

```
.
├── docker-compose.yml  # Docker configuration
├── nginx.conf          # Nginx configuration
├── php.ini             # PHP configuration
├── .env                # Environment variables
└── src/                # Your PHP code goes here
    └── index.php
```

## Adding Extensions

To add PHP extensions, create a `Dockerfile`:

```dockerfile
FROM php:8.2-fpm

# Install common extensions
RUN docker-php-ext-install pdo pdo_mysql mysqli

# Install composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer
```

Then update `docker-compose.yml`:

```yaml
services:
  app:
    build: .
    # ... rest of config
```

## Using with Database

1. Uncomment the `db` service in `docker-compose.yml`
2. Set database credentials in `.env`
3. Connect from PHP using host `db`

```php
$pdo = new PDO(
    'mysql:host=db;dbname=' . getenv('DB_NAME'),
    getenv('DB_USER'),
    getenv('DB_PASSWORD')
);
```

## Commands

```bash
# Start
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f app

# Shell into PHP container
docker compose exec app bash

# Run composer
docker compose exec app composer install
```
