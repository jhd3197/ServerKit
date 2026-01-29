import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5274,
        // Enable polling for WSL (Windows filesystem doesn't support inotify)
        watch: {
            usePolling: true,
            interval: 1000,
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-charts': ['recharts'],
                    'vendor-flow': ['@xyflow/react'],
                    'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
                    'vendor-icons': ['lucide-react'],
                },
            },
        },
    },
})
