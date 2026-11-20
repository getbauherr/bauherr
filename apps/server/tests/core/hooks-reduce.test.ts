import { describe, expect, it } from 'vitest'
import { reduceGithub, reduceGitlab } from '../../src/core/hooks/reduce'

const repository = { full_name: 'acme/web' }
const item = (kind: 'issue' | 'pr', number: number) => ({ items: [{ repo: 'acme/web', kind, number }], heads: [] })
const head = (sha: string) => ({ items: [], heads: [{ repo: 'acme/web', sha }] })
const nothing = { items: [], heads: [] }

describe('the GitHub reducer', () => {
  it('reduces an issues event to its issue', () => {
    expect(reduceGithub('issues', { repository, issue: { number: 4 } })).toEqual(item('issue', 4))
  })

  it('reduces an issue_comment on an issue to the issue', () => {
    expect(reduceGithub('issue_comment', { repository, issue: { number: 5 } })).toEqual(item('issue', 5))
  })

  it('reduces an issue_comment on a pull request to the pull request', () => {
    const issue = { number: 6, pull_request: { url: 'x' } }
    expect(reduceGithub('issue_comment', { repository, issue })).toEqual(item('pr', 6))
  })

  it('reduces a pull_request event to its pull request', () => {
    expect(reduceGithub('pull_request', { repository, pull_request: { number: 7 } })).toEqual(item('pr', 7))
  })

  it('reduces a pull_request_review event to its pull request', () => {
    expect(reduceGithub('pull_request_review', { repository, pull_request: { number: 8 } })).toEqual(item('pr', 8))
  })

  it('reduces a check_run to the pull requests it names', () => {
    const body = { repository, check_run: { pull_requests: [{ number: 9 }, { number: 10 }] } }
    expect(reduceGithub('check_run', body).items.map((i) => i.number)).toEqual([9, 10])
    expect(reduceGithub('check_run', { repository, check_run: { pull_requests: [] } })).toEqual(nothing)
  })

  it('reduces a check_suite to the pull requests it names', () => {
    const check_suite = { pull_requests: [{ number: 11 }] }
    expect(reduceGithub('check_suite', { repository, check_suite })).toEqual(item('pr', 11))
  })

  it('reduces a status to the head commit it names', () => {
    expect(reduceGithub('status', { repository, sha: 'abc' })).toEqual(head('abc'))
  })

  it('reduces an unknown event, and a body of the wrong shape, to nothing', () => {
    expect(reduceGithub('ping', { repository, zen: 'x' })).toEqual(nothing)
    expect(reduceGithub('issues', { repository })).toEqual(nothing)
    expect(reduceGithub('issues', null)).toEqual(nothing)
  })
})

describe('the GitLab reducer', () => {
  const project = { path_with_namespace: 'acme/web' }

  it('reduces an Issue Hook to its issue', () => {
    expect(reduceGitlab('Issue Hook', { project, object_attributes: { iid: 4 } })).toEqual(item('issue', 4))
  })

  it('reduces a Note Hook on an issue to the issue', () => {
    const body = { project, object_attributes: { noteable_type: 'Issue' }, issue: { iid: 5 } }
    expect(reduceGitlab('Note Hook', body)).toEqual(item('issue', 5))
  })

  it('reduces a Note Hook on a merge request to the merge request', () => {
    const body = { project, object_attributes: { noteable_type: 'MergeRequest' }, merge_request: { iid: 6 } }
    expect(reduceGitlab('Note Hook', body)).toEqual(item('pr', 6))
  })

  it('reduces a Note Hook on a commit to nothing', () => {
    expect(reduceGitlab('Note Hook', { project, object_attributes: { noteable_type: 'Commit' } })).toEqual(nothing)
  })

  it('reduces a Merge Request Hook to its merge request', () => {
    expect(reduceGitlab('Merge Request Hook', { project, object_attributes: { iid: 7 } })).toEqual(item('pr', 7))
  })

  it('reduces a Pipeline Hook to its merge request, or else to its commit', () => {
    const attributes = { sha: 'abc' }
    const onMergeRequest = { project, merge_request: { iid: 8 }, object_attributes: attributes }
    expect(reduceGitlab('Pipeline Hook', onMergeRequest)).toEqual(item('pr', 8))
    const onBranch = { project, merge_request: null, object_attributes: attributes }
    expect(reduceGitlab('Pipeline Hook', onBranch)).toEqual(head('abc'))
  })

  it('reduces an unknown event to nothing', () => {
    expect(reduceGitlab('Push Hook', { project, object_attributes: { iid: 1 } })).toEqual(nothing)
  })
})
