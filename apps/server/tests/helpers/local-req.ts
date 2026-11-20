import { createLocalReq, type Payload } from 'payload'

export const localReq = (payload: Payload) => createLocalReq({}, payload)
