# Python Application Template

A Docker-based Python application setup with optional PostgreSQL and Redis.

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
| `APP_NAME` | Container name prefix | `my-python-app` |
| `PORT` | External port | `8200` |
| `APP_PORT` | Internal app port | `8000` |
| `PYTHON_VERSION` | Python version (3.9-3.12) | `3.12` |
| `ENTRYPOINT` | Main Python file | `app.py` |

## Structure

```
.
├── docker-compose.yml  # Docker configuration
├── .env                # Environment variables
└── src/                # Your Python code
    ├── app.py          # Main application
    └── requirements.txt
```

## Using Different Frameworks

### Flask (default)
```python
from flask import Flask
app = Flask(__name__)

@app.route('/')
def home():
    return 'Hello World'

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
```

### FastAPI
Update `requirements.txt`:
```
fastapi>=0.109.0
uvicorn>=0.27.0
```

Update `.env`:
```
ENTRYPOINT=main.py
```

Create `src/main.py`:
```python
from fastapi import FastAPI
import uvicorn

app = FastAPI()

@app.get('/')
def home():
    return {'message': 'Hello World'}

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8000)
```

### Django
Update `docker-compose.yml` command:
```yaml
command: >
  sh -c "pip install -r requirements.txt &&
         python manage.py runserver 0.0.0.0:8000"
```

## Using with Database

1. Uncomment the `db` service in `docker-compose.yml`
2. Set database credentials in `.env`
3. Connect from Python using host `db`

```python
import psycopg2

conn = psycopg2.connect(
    host='db',
    database=os.environ['DB_NAME'],
    user=os.environ['DB_USER'],
    password=os.environ['DB_PASSWORD']
)
```

## Commands

```bash
# Start
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f app

# Shell into container
docker compose exec app bash

# Install new package
docker compose exec app pip install package-name

# Run Python command
docker compose exec app python -c "print('hello')"
```
