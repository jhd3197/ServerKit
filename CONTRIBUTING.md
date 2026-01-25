# Contributing to ServerKit

## Quick Setup

### Windows (WSL2) — Recommended

```powershell
# 1. Install WSL (PowerShell as Admin)
wsl --install -d Ubuntu-22.04
# Restart, create user when prompted
```

```bash
# 2. Run setup script
cd /mnt/c/Users/YOUR_USERNAME/Documents/GitHub/ServerKit
chmod +x ./scripts/dev/*.sh
./scripts/dev/setup-wsl.sh

# 3. Start dev servers
./scripts/dev/start.sh
```

Open http://localhost:5173 — login: `admin` / `admin`

> **Troubleshooting:** If you get `bad interpreter` error, fix line endings:
> ```bash
> sed -i 's/\r$//' ./scripts/dev/*.sh
> ```

### Linux / macOS

```bash
./scripts/dev/setup-linux.sh
./scripts/dev/start.sh
```

### Docker

```bash
./scripts/dev/dev.bat up   # Windows
docker compose -f docker-compose.dev.yml up --build  # Linux/Mac
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Start both | `./scripts/dev/start.sh` |
| Backend only | `cd backend && source venv/bin/activate && python run.py` |
| Frontend only | `cd frontend && npm run dev` |
| Build frontend | `cd frontend && npm run build` |

---

## Manual Setup

<details>
<summary>Click to expand manual setup steps</summary>

### Prerequisites

- Python 3.11+
- Node.js 20+
- Docker (optional)
- Git

### Fork and Clone

```bash
git clone https://github.com/YOUR_USERNAME/ServerKit.git
cd ServerKit
git remote add upstream https://github.com/jhd3197/ServerKit.git
```

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

</details>

---

## Project Structure

```
ServerKit/
├── backend/                 # Flask API
│   ├── app/
│   │   ├── api/            # API route blueprints
│   │   ├── models/         # SQLAlchemy models
│   │   └── services/       # Business logic
│   ├── config.py           # Configuration
│   ├── run.py              # Application entry point
│   └── requirements.txt
│
├── frontend/               # React application
│   ├── src/
│   │   ├── components/    # Reusable components
│   │   ├── pages/         # Page components
│   │   ├── services/      # API client
│   │   └── styles/        # LESS stylesheets
│   ├── package.json
│   └── vite.config.js
│
├── docs/                   # Documentation
├── nginx/                  # Nginx configuration
└── docker-compose.yml
```

### Key Files

**Backend:**
- `backend/app/__init__.py` - Flask app factory
- `backend/app/api/` - API endpoints (one file per feature)
- `backend/app/services/` - Business logic services
- `backend/app/models/` - Database models

**Frontend:**
- `frontend/src/App.jsx` - Main app with routing
- `frontend/src/pages/` - Page components
- `frontend/src/components/` - Shared components
- `frontend/src/services/api.js` - API client
- `frontend/src/styles/` - LESS stylesheets

---

## Making Changes

### Branch Naming

Use descriptive branch names:

```
feature/multi-server-support
fix/login-redirect-loop
docs/api-examples
refactor/notification-service
```

### Commit Messages

Write clear, concise commit messages:

```
Add Discord webhook notification support

- Create NotificationService for webhooks
- Add notification API endpoints
- Implement Discord embed formatting
- Add frontend notification settings
```

Format:
- First line: Brief summary (50 chars max)
- Blank line
- Body: Detailed description (wrap at 72 chars)

---

## Coding Standards

### Python (Backend)

- Follow PEP 8 style guide
- Use type hints where helpful
- Document public functions with docstrings
- Use meaningful variable names

```python
def get_system_stats() -> dict:
    """
    Retrieve current system statistics.

    Returns:
        dict: CPU, memory, disk, and network stats
    """
    cpu_percent = psutil.cpu_percent(interval=1)
    memory = psutil.virtual_memory()
    # ...
```

### JavaScript/React (Frontend)

- Use functional components with hooks
- Use meaningful component and variable names
- Keep components focused and small
- Use LESS for styling (not inline styles)

```jsx
const ServerStats = ({ serverId }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchServerStats(serverId).then(setStats);
  }, [serverId]);

  if (loading) return <LoadingSpinner />;
  return <StatsDisplay stats={stats} />;
};
```

### LESS/CSS (Styles)

- Use the existing design system variables
- Follow BEM-like naming conventions
- Keep specificity low
- Use the component/page file structure

```less
.notification-card {
  background: @card-bg;
  border-radius: @border-radius-md;

  &__header {
    padding: @spacing-md;
  }

  &--expanded {
    border-color: @primary-color;
  }
}
```

---

## Testing

### Backend Tests

```bash
cd backend
pytest
pytest --cov=app  # With coverage
```

### Frontend Tests

```bash
cd frontend
npm test
npm run test:coverage  # With coverage
```

### Manual Testing

Before submitting, test your changes:

1. Run the full application
2. Test the feature in multiple browsers
3. Test error cases and edge cases
4. Verify responsive design (mobile/tablet)

---

## Submitting Changes

### Pull Request Process

1. **Update your fork:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push your branch:**
   ```bash
   git push origin feature/your-feature
   ```

3. **Create Pull Request:**
   - Go to GitHub and create a PR
   - Fill out the PR template
   - Link any related issues

4. **PR Description:**
   - Describe what changed and why
   - Include screenshots for UI changes
   - List testing steps
   - Note any breaking changes

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Self-reviewed the code
- [ ] Added/updated tests if needed
- [ ] Updated documentation if needed
- [ ] No console errors or warnings
- [ ] Tested on multiple browsers (for frontend)

### Review Process

1. Maintainers will review your PR
2. Address any requested changes
3. Once approved, your PR will be merged

---

## Priority Areas

We especially welcome contributions in these areas:

### High Priority

- **Multi-Server Support** - Agent development, remote monitoring
- **Git Deployment** - GitHub/GitLab webhooks, auto-deploy
- **Backup System** - S3/B2 integration, scheduled backups
- **Security Enhancements** - Fail2ban, SSH key management

### Medium Priority

- **Email Server** - Postfix/Dovecot integration
- **API Improvements** - Rate limiting, API keys
- **Team Features** - Multi-user, RBAC

### Always Welcome

- Bug fixes
- Documentation improvements
- Test coverage
- UI/UX improvements
- Performance optimizations
- Accessibility improvements

---

## Questions?

- Open a [GitHub Discussion](https://github.com/jhd3197/ServerKit/discussions)
- Check existing [Issues](https://github.com/jhd3197/ServerKit/issues)
- Review the [Documentation](docs/README.md)

---

Thank you for contributing to ServerKit!
