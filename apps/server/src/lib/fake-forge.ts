import { FakeBackend } from '@bauherr/adapters'

const build = (): FakeBackend => {
  const fake = new FakeBackend({ native: true, users: ['fake', 'e2e-admin'] })
  fake.commit('acme/web', 'main', 'README.md', '# Web\n')
  fake.commit('acme/picker', 'main', 'README.md', '# Picker\n')
  const checks = fake.commit('acme/checks', 'main', 'README.md', '# Checks\n')
  fake.setCommits('acme/checks', [{ sha: checks, message: 'Deploy to production' }])
  fake.setChecks('acme/checks', checks, [
    { name: 'deploy-production', status: 'completed', conclusion: 'success' },
    { name: 'lint', status: 'completed', conclusion: 'success' },
  ])
  return fake
}

const g = globalThis as { __bauherrFakeForge?: FakeBackend }
export const fakeForge = (): FakeBackend => {
  if (g.__bauherrFakeForge) return g.__bauherrFakeForge
  const fake = build()
  fake.now = () => new Date().toISOString()
  return (g.__bauherrFakeForge = fake)
}
