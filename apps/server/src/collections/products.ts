import type { CollectionAfterDeleteHook } from 'payload'
import { assignmentRows } from '../lib/people'
import { col, date, text } from './fields'

const GLOB_SET_NAME = /^[a-z][a-z0-9-]*$/
const validGlob = (x: unknown): boolean => typeof x === 'string' && x.trim() !== '' && !/\s/.test(x)

const pathSetsValid = (v: unknown): true | string =>
  v == null ||
  (typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.entries(v).every(([k, g]) => GLOB_SET_NAME.test(k) && Array.isArray(g) && g.every(validGlob))) ||
  'must map set names (lowercase, dashes) to lists of path globs without spaces'

const dropProductFromAssignments: CollectionAfterDeleteHook = async ({ id, req }) => {
  const { docs } = await req.payload.find({
    collection: 'bauherren',
    where: { 'assignments.products': { equals: id } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  })
  for (const u of docs as { id: number | string; assignments?: unknown }[]) {
    const assignments = assignmentRows(u.assignments).map((r) => ({
      ...r,
      products: r.products.filter((p) => p !== Number(id)),
    }))
    await req.payload.update({
      collection: 'bauherren',
      id: u.id,
      data: { assignments },
      overrideAccess: true,
      depth: 0,
      req,
    })
  }
}

export const products = col(
  'products',
  [
    text('name', { required: true }),
    text('slug', { required: true }),
    text('stagingUrl'),
    text('state', { required: true, defaultValue: 'observing' }),
    date('connectedAt'),
    text('deployChecks', { admin: { description: 'Comma-separated check names that must be green; empty = all.' } }),
    {
      name: 'deployWaitMinutes',
      type: 'number',
      defaultValue: 60,
      admin: { description: 'Minutes after a merge before the owner is asked about a deploy that has not finished.' },
    },
    {
      name: 'productionGate',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Accepting on staging waits for an explicit production approval instead of moving to done; ' +
          "the Product's own pipeline deploys.",
      },
    },
    {
      name: 'riskAreas',
      type: 'json',
      defaultValue: [],
      admin: { description: 'Names of path sets whose changes need an owner-approved Brief.' },
    },
    {
      name: 'intakeExcludedLabels',
      type: 'json',
      defaultValue: ['bauherr:someday'],
      admin: { description: 'Issue labels that keep an issue out of intake. bauherr:someday parks an idea.' },
    },
    {
      name: 'outsideIssuesPerDay',
      type: 'number',
      defaultValue: 5,
      admin: { description: 'Issues per day one outside author may get admitted by label.' },
    },
    {
      name: 'reporterRemindDays',
      type: 'number',
      defaultValue: 7,
      admin: { description: 'Days after a question before one reminder comment.' },
    },
    {
      name: 'reporterSilentDays',
      type: 'number',
      defaultValue: 21,
      admin: { description: 'Days after a question before the reporter counts as silent.' },
    },
    text('executor', {
      defaultValue: 'session',
      admin: { description: 'Who works the runs: session (an agent session over MCP) or runner (the factory).' },
    }),
    {
      name: 'autoClose',
      type: 'checkbox',
      defaultValue: true,
      admin: { description: 'Close an issue on the forge when intake finds a duplicate or declines it.' },
    },
    {
      name: 'backlogBriefLimit',
      type: 'number',
      defaultValue: 5,
      admin: { description: 'Brief cards of backlog tickets waiting on the owner at one time.' },
    },
    text('requiredChecks', {
      admin: { description: 'Comma-separated check names a patch must pass before Verify; empty skips the wait.' },
    }),
    {
      name: 'pathSets',
      type: 'json',
      defaultValue: {},
      validate: pathSetsValid,
      admin: {
        description:
          'Named path sets that conditional workflow steps refer to (`when: {touches: security}`): ' +
          '{name: [globs]}, e.g. {"security": ["src/auth/**"], "ui": ["src/app/**"]}. ' +
          'A set that is empty or not declared never matches.',
      },
    },
  ],
  { hooks: { afterDelete: [dropProductFromAssignments] } },
)
