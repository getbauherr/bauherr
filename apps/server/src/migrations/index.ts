import * as migration_20261029_160655_initial from './20261029_160655_initial';

export const migrations = [
  {
    up: migration_20261029_160655_initial.up,
    down: migration_20261029_160655_initial.down,
    name: '20261029_160655_initial'
  },
];
