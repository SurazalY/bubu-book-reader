import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function isPublicBooksPath(url) {
  const path = (url || '').split('?')[0]
  return path === '/books' || path.startsWith('/books/')
}

function blockPublicBooksInDev() {
  return {
    name: 'block-public-books-in-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isPublicBooksPath(req.url)) {
          next()
          return
        }
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Not Found')
      })
    },
  }
}

// BrowserRouter 的深链接由 Express 回退到 index.html，静态资源必须始终从站点根加载。
export default defineConfig({
  plugins: [react(), blockPublicBooksInDev()],
  base: '/',
  server: {
    port: 5190,
    host: '127.0.0.1',
    // dev：/api 代理到本地 AI 后端（server/，端口 5191）；生产由 server serve dist 同源，相对 /api 直达
    proxy: { '/api': 'http://127.0.0.1:5191' },
  },
  build: {
    rollupOptions: {
      output: {
        // Plan_2 P9：页面已按路由懒加载，但第三方库仍全压在主包里。
        // 图标库和 React 运行时几乎不随业务改动，单独成包后可以被浏览器长期缓存，
        // 改一行业务代码不再让学校平板重下整包。只影响分包，不改任何运行行为。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'vendor-react'
          }
          return undefined
        },
      },
    },
  },
})
