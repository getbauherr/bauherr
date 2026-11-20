import type { Payload } from 'payload'

export const stubPayload = (methods: Partial<Payload>): Payload => methods as Payload
