import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';

export type Proxy = { url: string; close(): Promise<void> };

/** Localhost forwarder to the gateway that injects the key; bodies are piped untouched. */
export async function startProxy(o: { gatewayUrl: string; gatewayKey: string; runId: string; stage: string }): Promise<Proxy> {
  const target = new URL(o.gatewayUrl);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const basePath = target.pathname.replace(/\/$/, '');

  const server: Server = createServer((req, res) => {
    const headers: IncomingHttpHeaders = { ...req.headers, host: target.host };
    delete headers.authorization;
    headers['x-api-key'] = o.gatewayKey;
    headers['x-bauherr-run'] = o.runId;
    headers['x-bauherr-stage'] = o.stage;
    const up = send(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: basePath + (req.url ?? '/'), headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
