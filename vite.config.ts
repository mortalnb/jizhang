import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const resolveMimoKeyPath = () => {
  const candidates = [
    process.env.JIZHANG_MIMO_KEY_FILE,
    path.resolve(process.cwd(), '.local', 'credentials', 'mimo-api-key.txt'),
    path.resolve(process.cwd(), 'key.txt'),
  ]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map(candidate => path.resolve(candidate))

  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0]
}

const readRequestBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

// https://vite.dev/config/
export default defineConfig({
  css: {
    postcss: path.resolve(process.cwd(), 'config'),
  },
  plugins: [
    react(),
    {
      name: 'local-mimo-key-dev-server',
      configureServer(server) {
        server.middlewares.use('/__dev_mimo_key', (_req, res) => {
          const keyPath = resolveMimoKeyPath()
          if (!fs.existsSync(keyPath)) {
            res.statusCode = 404
            res.end('')
            return
          }
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(fs.readFileSync(keyPath, 'utf8').trim())
        })
        server.middlewares.use('/__dev_mimo_chat', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('')
            return
          }

          const keyPath = resolveMimoKeyPath()
          const apiKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8').trim() : ''
          if (!apiKey) {
            res.statusCode = 401
            res.end(JSON.stringify({ error: 'Missing local MiMo key file' }))
            return
          }

          try {
            const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: await readRequestBody(req),
            })
            res.statusCode = response.status
            res.setHeader('Content-Type', response.headers.get('Content-Type') ?? 'application/json')
            res.end(await response.text())
          } catch (error) {
            res.statusCode = 502
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'MiMo proxy failed' }))
          }
        })
      },
    },
  ],
})
