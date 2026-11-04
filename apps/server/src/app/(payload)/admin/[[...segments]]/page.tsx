import config from '@payload-config'
import { generatePageMetadata, RootPage } from '@payloadcms/next/views'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { importMap } from '../importMap.js'

type Args = { params: Promise<{ segments: string[] }>; searchParams: Promise<{ [key: string]: string | string[] }> }

export const generateMetadata = ({ params, searchParams }: Args): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams })

export default function Page({ params, searchParams }: Args) {
  if (process.env.BAUHERR_ENABLE_ADMIN !== '1') redirect('/settings')
  return RootPage({ config, params, searchParams, importMap })
}
