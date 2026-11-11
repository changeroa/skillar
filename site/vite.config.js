import { defineConfig } from 'vite';
import prefixSelector from 'postcss-prefix-selector';

// local/dashboard/styles.css styles a whole document; on skillar.sh it must only
// style the embedded views, with its :root tokens replaced by src/dashboard/embed.css.
const localDashboardStyles = /[\\/]local[\\/]dashboard[\\/]styles\.css$/;
const embedPrefix = '.dash-embed';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        landing: 'index.html',
        notFound: '404.html',
        login: 'login/index.html',
        connect: 'connect/index.html',
        connections: 'connections/index.html',
        dashboard: 'dashboard/index.html',
        skills: 'skills/index.html',
      },
    },
  },
  resolve: {
    // The local views live outside the site package; their bare imports must
    // resolve from site/node_modules so CI builds without local/node_modules.
    dedupe: ['preact', 'd3-sankey', 'zod', 'prismjs'],
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  server: { fs: { allow: ['..'] } },
  css: {
    postcss: {
      plugins: [
        prefixSelector({
          prefix: embedPrefix,
          includeFiles: [localDashboardStyles],
          transform(prefix, selector, prefixedSelector) {
            if (selector === ':root') return `${prefix}-root-tokens-unused`;
            if (selector === 'html' || selector === 'body') return prefix;
            return prefixedSelector;
          },
        }),
      ],
    },
  },
});
