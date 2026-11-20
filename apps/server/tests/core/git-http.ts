import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'

export type GitHttp = {
  url: string
  seen: { path: string; credential: string | null }[]
  refuse: { receive: boolean }
  close: () => Promise<void>
}

const credentialOf = (header: string | undefined): string | null =>
  header?.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : null

const backendStoppedReading = (): void => undefined

const cgi = (root: string, request: { method: string; url: string; type: string; encoding: string }, body: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    const [path = '', query = ''] = request.url.split('?')
    const child = spawn('git', ['http-backend'], {
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '',
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REMOTE_USER: 'bauherr',
        REQUEST_METHOD: request.method,
        PATH_INFO: path,
        QUERY_STRING: query,
        CONTENT_TYPE: request.type,
        HTTP_CONTENT_ENCODING: request.encoding,
        GATEWAY_INTERFACE: 'CGI/1.1',
      },
    })
    const out: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.on('error', reject)
    child.on('close', () => resolve(Buffer.concat(out)))
    child.stdin.on('error', backendStoppedReading)
    child.stdin.end(body)
  })

export const startGitHttp = async (bare: string): Promise<GitHttp> => {
  const root = dirname(dirname(bare))
  const seen: GitHttp['seen'] = []
  const refuse = { receive: false }
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const url = req.url ?? '/'
      seen.push({ path: url, credential: credentialOf(req.headers.authorization) })
      if (refuse.receive && url.includes('git-receive-pack')) {
        res.writeHead(403).end('refused')
        return
      }
      const request = {
        method: req.method ?? 'GET',
        url,
        type: req.headers['content-type'] ?? '',
        encoding: req.headers['content-encoding'] ?? '',
      }
      cgi(root, request, Buffer.concat(chunks)).then(
        (output) => {
          const split = output.indexOf('\r\n\r\n')
          const head = output.subarray(0, split).toString().split('\r\n')
          const status = head.find((line) => line.startsWith('Status:'))?.slice(8, 11) ?? '200'
          const headers = Object.fromEntries(
            head.filter((line) => !line.startsWith('Status:')).map((line) => line.split(': ') as [string, string]),
          )
          res.writeHead(Number(status), headers).end(output.subarray(split + 4))
        },
        () => res.writeHead(500).end(),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    refuse,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
