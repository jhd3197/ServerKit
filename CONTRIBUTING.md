# Contributing to ServerKit

Thank you for your interest in contributing to ServerKit! This guide will help you get started.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Priority Areas](#priority-areas)

---

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the issue, not the person
- Help others learn and grow

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 20+
- Docker (optional, for testing)
- Git

### Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/ServerKit.git
cd ServerKit
git remote add upstream https://github.com/jhd3197/ServerKit.git
```

---

## Development Setup

### Backend Setup

```bash
# Create virtual environment
cd backend
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt  # Development dependencies

# Copy environment file
cp ../.env.example .env
# Edit .env with your settings

# Run development server
python run.py
```

The backend will be available at `http://localhost:5000`.

### Frontend Setup

```bash
# In a new terminal
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

The frontend will be available at `http://localhost:5173` with hot-reload.

### Running Both Together

For development, run both the backend and frontend servers:

```bash
# Terminal 1 - Backend
cd backend && python run.py

# Terminal 2 - Frontend
cd frontend && npm run dev
```

Or use Docker:

```bash
docker compose -f docker-compose.dev.yml up
```

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
