import { releasePanel } from '../../../../core/releases/panel'
import type { ReleasesView } from '../../../../core/releases/view'
import { payloadClient } from '../../lib/session'
import { ReleaseControl } from './ReleaseControl'

type Props = { workspace: number; view: ReleasesView; refused: string | undefined }

export async function ReleaseSection({ workspace, view, refused }: Props) {
  const product = view.product?.id
  if (product === undefined) return null
  const panel = await releasePanel(await payloadClient(), { workspace, product }, new Date())
  if (panel === null) return null
  return <ReleaseControl panel={panel} product={product} refused={refused ?? null} />
}
