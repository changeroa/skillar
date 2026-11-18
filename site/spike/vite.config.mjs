import react from '@vitejs/plugin-react';
export default {root: new URL('.', import.meta.url).pathname, plugins: [react()], build: {outDir: 'dist', emptyOutDir: true}};
