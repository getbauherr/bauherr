import { FakeBackend } from '../src/index.js';
import { contractSuite } from './contract.js';

for (const native of [true, false]) {
  const backend = new FakeBackend({ native, user: 'octo' });
  contractSuite(`fake (${native ? 'native' : 'body-convention'})`, {
    backend, repo: 'acme/app', user: 'octo',
    commitFile: async (branch, path, content) => backend.commit('acme/app', branch, path, content),
  });
}
