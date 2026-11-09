import { randomBytes } from 'node:crypto'
import { buildTemplateDb, templateDbName } from './helpers/test-db'

export default async () => {
  const runTag = `${process.pid}_${randomBytes(2).toString('hex')}`
  process.env.BAUHERR_TEST_TEMPLATE_DB = templateDbName(runTag)
  process.env.VITEST_DB_SUFFIX ??= runTag
  return buildTemplateDb()
}
