import type { PostgresAdapter } from '@payloadcms/db-postgres'

export const hasSessions = (db: object): db is Pick<PostgresAdapter, 'sessions'> => 'sessions' in db
