import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        landing: 'index.html',
        login: 'login/index.html',
        connect: 'connect/index.html',
        dashboard: 'dashboard/index.html',
      },
    },
  },
});
