import type { Forge } from './contracts.js';
import { linkLabel } from './contracts.js';
import type { FakeBackend } from './fake.js';
import { fakeBranchOps } from './fake-forge-branches.js';
import { fakeFactOps } from './fake-forge-facts.js';
import { fakeFileOps } from './fake-forge-files.js';
import { makeFakeKit } from './fake-forge-kit.js';
import { fakeMergeOps } from './fake-forge-merges.js';
import { fakePullListOps } from './fake-forge-pull-lists.js';
import { fakePullOps } from './fake-forge-pulls.js';
import { fakeReleaseOps } from './fake-forge-releases.js';
import { fakeReviewOps } from './fake-forge-reviews.js';
import type { FakeAccess } from './fake-state.js';

export const makeFakeForge = (b: FakeBackend, access: FakeAccess): Forge => {
  const kit = makeFakeKit(b, access);
  return {
    linkLabel: (pr) => linkLabel('github', pr.number),
    ...fakeBranchOps(kit),
    ...fakeFileOps(kit),
    ...fakeFactOps(kit),
    ...fakePullOps(kit),
    ...fakePullListOps(kit),
    ...fakeReviewOps(kit),
    ...fakeMergeOps(kit),
    ...fakeReleaseOps(kit),
  };
};
