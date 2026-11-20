import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';

export type Proxy = { url: string; close(): Promise<void> };

type ProxyOptions = {
  gatewayUrl: string;
  gatewayKey: string;
  runId: string;
  stage: string;
  product?: string;
  ticket?: string;
  onBudgetExceeded?: () => void;
};

const upstreamHeaders = (o: ProxyOptions, target: URL, req: IncomingMessage): IncomingHttpHeaders => {
  const headers: IncomingHttpHeaders = { ...req.headers, host: target.host };
  delete headers['x-api-key'];
  headers.authorization = `Bearer ${o.gatewayKey}`;
  headers['x-bauherr-run'] = o.runId;
  headers['x-bauherr-stage'] = o.stage;
  if (o.product) headers['x-bauherr-product'] = o.product;
  if (o.ticket) headers['x-bauherr-ticket'] = o.ticket;
  return headers;
};

const relay = (upRes: IncomingMessage, res: ServerResponse, onFailureBody: (status: number, body: Buffer) => void) => {
  const status = upRes.statusCode ?? 502;
  res.writeHead(status, upRes.headers);
  if (status >= 200 && status < 300) {
    upRes.pipe(res);
    return;
  }
  const chunks: Buffer[] = [];
  upRes.on('data', (c: Buffer) => chunks.push(c));
  upRes.on('end', () => {
    const body = Buffer.concat(chunks);
    res.end(body);
    onFailureBody(status, body);
  });
};

export async function startProxy(o: ProxyOptions): Promise<Proxy> {
  const target = new URL(o.gatewayUrl);
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const basePath = target.pathname.replace(/\/$/, '');
  const BUDGET_BODY = JSON.stringify({
    type: 'error',
    error: { type: 'rate_limit_error', code: 'budget_exceeded', message: 'budget_exceeded' },
  });
  let exhausted = false;

  const forward = (req: IncomingMessage, res: ServerResponse) => {
    const headers = upstreamHeaders(o, target, req);
    const up = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: basePath + (req.url ?? '/'),
        headers,
      },
      (upRes) =>
        relay(upRes, res, (status, body) => {
          if (status === 429 && !exhausted && body.includes('"budget_exceeded"')) {
            exhausted = true;
            o.onBudgetExceeded?.();
          }
        }),
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  };

  const server: Server = createServer((req, res) => {
    if (exhausted) {
      req.resume();
      res.writeHead(429, { 'content-type': 'application/json' }).end(BUDGET_BODY);
      return;
    }
    forward(req, res);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
