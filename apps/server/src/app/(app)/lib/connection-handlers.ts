import { verifyForge } from '../../../lib/adapters'
import { connectionInput, credentialName, forgeConfig } from '../../../lib/connection'
import { PRESET_FIELDS } from '../../../lib/providers'
import { id, inWorkspace, inWs, s, type Ctx } from './action-context'
import { only } from './settings'

const connectionData = async (c: Ctx, fd: FormData) => {
  const kind = s(fd, 'kind')
  const data: Record<string, unknown> = { name: s(fd, 'name'), kind }
  if (kind === 'llm-provider') {
    data.provider = s(fd, 'provider')
    for (const k of PRESET_FIELDS) if (fd.has(k)) data[k] = s(fd, k)
  }
  if (kind !== 'llm-provider') data.config = await forgeConfig(c.payload, id(fd), kind, (k) => s(fd, k))
  if (s(fd, 'secret')) data.secret = s(fd, 'secret')
  return { kind, data }
}

export const saveConnection = async (c: Ctx, fd: FormData) => {
  only(c.user)
  const { kind, data } = await connectionData(c, fd)
  if (id(fd)) {
    await inWs(c, 'connections', id(fd))
    if (kind !== 'llm-provider' && s(fd, 'secret'))
      data.capabilities = {
        ...(await connectionInput(c.payload, id(fd))).capabilities,
        verifiedAt: undefined,
        lastError: undefined,
      }
    await c.payload.update({ collection: 'connections', id: id(fd), data, ...c.w })
  } else await c.payload.create({ collection: 'connections', data: { ...data, workspace: inWorkspace(c) }, ...c.w })
}

type Failure = { message: string; refused: boolean }

const verificationFailure = async (conn: Awaited<ReturnType<typeof connectionInput>>): Promise<Failure | null> => {
  try {
    await verifyForge(conn, { maxRetries: 0, timeoutMs: 10_000 })
    return null
  } catch (e) {
    return { message: (e as Error).message, refused: [401, 403].includes((e as { status?: number }).status ?? 0) }
  }
}

export const verifyConnection = async (c: Ctx, fd: FormData) => {
  only(c.user)
  await inWs(c, 'connections', id(fd))
  const conn = await connectionInput(c.payload, id(fd))
  if (conn.kind === 'llm-provider') {
    await c.payload.update({ collection: 'connections', id: id(fd), data: {}, ...c.w })
    return
  }
  const failure = await verificationFailure(conn)
  await c.payload.update({
    collection: 'connections',
    id: id(fd),
    data: {
      capabilities: {
        ...conn.capabilities,
        verifiedAt: failure ? null : new Date().toISOString(),
        lastError: failure?.message ?? null,
      },
    },
    overrideAccess: true,
  })
  if (failure) {
    const rejection = failure.refused ? 'The forge did not accept' : 'Could not verify'
    throw new Error(`${rejection} ${credentialName(conn)}: ${failure.message}`)
  }
}
