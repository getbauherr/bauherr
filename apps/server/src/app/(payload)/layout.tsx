import config from '@payload-config'
import '@payloadcms/next/css'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import { notFound } from 'next/navigation'
import type { ServerFunctionClient } from 'payload'
import type { ReactNode } from 'react'
import { importMap } from './admin/importMap.js'

const serverFunction: ServerFunctionClient = async function (args) {
  'use server'
  if (process.env.BAUHERR_DISABLE_ADMIN === '1') notFound()
  return handleServerFunctions({ ...args, config, importMap })
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  )
}
