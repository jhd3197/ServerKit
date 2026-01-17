# React Dashboard Template

A modern React dashboard application boilerplate built with Vite, featuring routing, charts, and a sidebar layout for building data-driven web interfaces.

## Features

- **React 18** with functional components and hooks
- **Vite** for fast development and building
- **React Router** for client-side routing
- **Recharts** for data visualization
- **Lucide React** for icons
- **ESLint** for code linting
- Responsive sidebar layout
- Dashboard page with sample components

## Getting Started

### Prerequisites

- Node.js 16+ and npm

### Installation

1. Clone or download this template
2. Install dependencies:

```bash
npm install
```

### Development

Start the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

### Building for Production

Build the app for deployment:

```bash
npm run build
```

The output will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
src/
├── App.jsx              # Main app with routing
├── main.jsx             # Entry point
├── index.css            # Global styles
├── components/
│   └── Sidebar.jsx      # Navigation sidebar
├── layouts/
│   └── DashboardLayout.jsx  # Main layout wrapper
└── pages/
    └── Dashboard.jsx    # Main dashboard page
```

## Customization

- Modify components in `src/components/`
- Add new pages in `src/pages/`
- Update routes in `App.jsx`
- Customize styles in `index.css` or component files

## Environment Variables

Create a `.env` file in the root for environment variables:

```env
VITE_API_URL=https://api.example.com
```

Access them in code via `import.meta.env.VITE_API_URL`.

## Contributing

See the documentation files for AI agent permissions and guidelines.