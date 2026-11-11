import { expect, it } from 'vitest'

it('workflowFor throws until loadWorkflows ran in this process', async () => {
  const { workflowFor } = await import('../src/lib/factory')
  expect(() => workflowFor(1)).toThrow(/before loadWorkflows/)
  expect(() => workflowFor(null)).toThrow(/before loadWorkflows/)
})
