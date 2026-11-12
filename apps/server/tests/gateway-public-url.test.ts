import { afterEach, expect, it, vi } from 'vitest'
import { gatewayPublicUrl } from '../src/lib/gateway'

afterEach(() => vi.unstubAllEnvs())

it('defaults to loopback port 4000, follows GATEWAY_PORT and lets GATEWAY_PUBLIC_URL win', () => {
  vi.stubEnv('GATEWAY_PORT', '')
  vi.stubEnv('GATEWAY_PUBLIC_URL', '')
  expect(gatewayPublicUrl()).toBe('http://127.0.0.1:4000')
  vi.stubEnv('GATEWAY_PORT', '4010')
  expect(gatewayPublicUrl()).toBe('http://127.0.0.1:4010')
  vi.stubEnv('GATEWAY_PUBLIC_URL', 'https://gw.example.com/')
  expect(gatewayPublicUrl()).toBe('https://gw.example.com')
})
