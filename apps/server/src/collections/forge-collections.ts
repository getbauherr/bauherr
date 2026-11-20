import { col, date, json, rel, text } from './fields'

export const repositories = col('repositories', [
  text('fullName', { required: true }),
  rel('product', 'products', { required: true }),
])

export const ticketSources = col('ticket_sources', [
  text('repo', { required: true }),
  rel('product', 'products', { required: true }),
  rel('connection', 'connections', { required: true }),
  text('cursor'),
  date('lastPolledAt'),
  text('lastError'),
  date('lookbackAt'),
  date('reconciledAt'),
  date('importedAt'),
  text('defaultBranch'),
  text('branchProtected'),
  json('requiredCheckNames'),
  { name: 'hasAgentsFile', type: 'checkbox' },
  { name: 'agentsFile', type: 'textarea' },
  { name: 'agentsFileCut', type: 'checkbox' },
  { name: 'issueFormCount', type: 'number' },
  date('factsAt'),
])
