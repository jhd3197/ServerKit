# How It Works

This project was bootstrapped with a modern React boilerplate using **Vite**.

## 📂 Project Structure

```text
project_name/
├── index.html             # Entry HTML file
├── package.json           # Dependencies and scripts
├── vite.config.js         # Vite configuration
└── src/
    ├── App.jsx            # Main App component
    ├── main.jsx           # Entry point
    └── index.css          # Global styles
```

## 🚀 Getting Started

### Installation

Install dependencies using npm:

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

## 🛠 Features

- **Vite**: Ultra-fast development server and bundler.
- **React**: Modern UI library.
- **ESLint**: Code linting.
- **Prettier**: Code formatting.

## 🔄 Customization

### Project Metadata

The project name and authors are automatically configured in `package.json` and generated files during initialization.

### Environment Variables

Create a `.env` file in the root for environment variables:

```env
VITE_API_URL=https://api.example.com
```

Access them in code via `import.meta.env.VITE_API_URL`.
