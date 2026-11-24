import { FakeBackend } from '@bauherr/adapters'

const openPull = (fake: FakeBackend, repo: string, title: string) => {
  fake.commit(repo, 'main', 'README.md', `# ${repo}\n`)
  void fake.forge.createBranch(repo, 'button')
  const sha = fake.commit(repo, 'button', 'src/button.ts', 'export {}\n')
  void fake.forge.openPullRequest(repo, { title, head: 'button', base: 'main' })
  return {
    checks: (names: string[]) =>
      fake.setChecks(repo, sha, names.map((name) => ({ name, status: 'completed', conclusion: 'success' }))),
  }
}

const build = (): FakeBackend => {
  const fake = new FakeBackend({ native: true, users: ['fake', 'e2e-admin'] })
  fake.commit('acme/web', 'main', 'README.md', '# Web\n')
  fake.commit('acme/picker', 'main', 'README.md', '# Picker\n')
  fake.commit('check/app', 'main', 'README.md', '# Check\n')
  fake.commit('ready/app', 'main', 'README.md', '# Ready\n')
  fake.commit('ready/app', 'main', 'src/auth/login.ts', 'export {}\n')
  openPull(fake, 'ready/app', 'Add a button').checks(['lint', 'test'])
  void fake.tickets('ready/wait').create({ title: 'Add a button', body: 'The page needs a button.' })
  openPull(fake, 'ready/wait', 'Add a button')
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
