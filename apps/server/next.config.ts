import { withPayload } from '@payloadcms/next/withPayload'
import path from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  allowedDevOrigins: ['localhost', '127.0.0.1', 'host.docker.internal'],
  serverExternalPackages: ['@bauherr/runner', '@bauherr/adapters'],
  agentRules: false,
}

export default withPayload(config, { devBundleServerPackages: false })
