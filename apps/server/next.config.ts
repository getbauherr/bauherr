import { withPayload } from '@payloadcms/next/withPayload'
import path from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  allowedDevOrigins: ['localhost', '127.0.0.1', 'host.docker.internal'],
  serverExternalPackages: ['@bauherr/runner', '@bauherr/adapters'],
  agentRules: false,
  env: { BAUHERR_TEST_BUILD: process.env.BAUHERR_TEST_BUILD ?? '' },
}

export default withPayload(config, { devBundleServerPackages: false })
