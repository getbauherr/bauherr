import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { readRecord } from '../../src/core/record/store'
import { BODY_LIMIT, COMMENT_LIMIT, COMMENTS_LIMIT, loadSource } from '../../src/core/run/source'
import { flowHarness } from './modules-harness'

const f = flowHarness('core_run_source')

const comment = (repo: string, n: number, author: string, body: string) =>
  f.h.rows(sql`
    INSERT INTO "mirror_comments" ("workspace_id", "item_id", "forge_id", "author", "body", "forge_created_at")
    SELECT i."workspace_id", i."id", ${`c${n}`}, ${author}, ${body},
      '2026-01-01T00:00:00Z'::timestamptz + ${n} * interval '1 minute'
    FROM "mirror_items" i WHERE i."repo" = ${repo} AND i."number" = 1`)

const sourceOf = async (id: number) => loadSource(f.h.payload(), await readRecord(f.h.payload(), id))

describe('the source of a record in the context pack', () => {
  it('holds the issue and its comments in order, the factory comments marked', async () => {
    const s = await f.start('active')
    await comment(s.repo, 2, 'bot', `${DISCLOSURE}\n\nWhat should change?`)
    await comment(s.repo, 1, 'jo', 'It happens on Monday.')
    const source = await sourceOf(s.id)
    expect(source?.issue).toMatchObject({ number: 1, title: 'list is empty', bodyCut: false })
    expect(source?.issue.body).toContain('The list is empty.')
    expect(source?.comments.map((c) => [c.author, c.factory, c.cut])).toEqual([
      ['jo', false, false],
      ['bot', true, false],
    ])
    expect(source?.comments[0]?.at).toBe('2026-01-01T00:01:00.000Z')
    expect(source?.olderCommentsLeftOut).toBe(0)
    expect(source?.pull).toBeNull()
  })

  it('cuts a long body and a long comment and says so', async () => {
    const s = await f.start('active')
    await f.h.rows(sql`UPDATE "mirror_items" SET "body" = ${'x'.repeat(BODY_LIMIT + 5)} WHERE "repo" = ${s.repo}`)
    await comment(s.repo, 1, 'jo', 'y'.repeat(COMMENT_LIMIT + 1))
    const source = await sourceOf(s.id)
    expect(source?.issue.body).toHaveLength(BODY_LIMIT)
    expect(source?.issue.bodyCut).toBe(true)
    expect(source?.comments[0]).toMatchObject({ cut: true })
    expect(source?.comments[0]?.body).toHaveLength(COMMENT_LIMIT)
  })

  it('keeps the newest comments when there are too many and counts the older ones', async () => {
    const s = await f.start('active')
    for (let n = 1; n <= COMMENTS_LIMIT + 2; n++) await comment(s.repo, n, 'jo', `comment ${n}`)
    const source = await sourceOf(s.id)
    expect(source?.comments).toHaveLength(COMMENTS_LIMIT)
    expect(source?.comments[0]?.body).toBe('comment 3')
    expect(source?.comments.at(-1)?.body).toBe(`comment ${COMMENTS_LIMIT + 2}`)
    expect(source?.olderCommentsLeftOut).toBe(2)
  })

  it('holds the adopted pull request next to the issue', async () => {
    const s = await f.startAdopted('active')
    const source = await sourceOf(s.id)
    expect(source?.pull).toMatchObject({ number: s.pr, title: 'fix the list', bodyCut: false })
    expect(source?.pull?.body).toContain('Closes #1')
  })

  it('is empty without an error when the issue is not mirrored', async () => {
    const s = await f.start('active')
    await f.h.rows(sql`DELETE FROM "mirror_items" WHERE "repo" = ${s.repo}`)
    expect(await sourceOf(s.id)).toBeNull()
  })
})
