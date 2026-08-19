import { describe, expect, test } from 'bun:test'
import { getOwnedSessionWatcherPaths } from './session-file-changes'

describe('getOwnedSessionWatcherPaths', () => {
  test('does not attribute paths for a missing session', () => {
    expect(getOwnedSessionWatcherPaths(
      ['/workspaces/current-session/generated/file.txt'],
      {
        sessionExists: false,
        sessionPath: '/workspaces/current-session',
        sessionAttachedDirectories: [],
        sessionAttachedFiles: [],
        workspaceAttachmentsComplete: true,
        workspaceFilesPath: '/workspaces/workspace-files',
        workspaceAttachedDirectories: [],
        workspaceAttachedFiles: [],
      },
    )).toEqual([])
  })

  test('retains session-local paths when workspace attachments are unavailable', () => {
    expect(getOwnedSessionWatcherPaths(
      [
        '/workspaces/current-session/generated/file.txt',
        '/external/session-directory/file.txt',
        '/external/session-file.md',
        '/workspaces/workspace-files/shared.md',
        '/external/workspace-directory/file.txt',
        '/external/workspace-file.md',
      ],
      {
        sessionExists: true,
        sessionPath: '/workspaces/current-session',
        sessionAttachedDirectories: ['/external/session-directory'],
        sessionAttachedFiles: ['/external/session-file.md'],
        workspaceAttachmentsComplete: false,
        workspaceFilesPath: '/workspaces/workspace-files',
        workspaceAttachedDirectories: ['/external/workspace-directory'],
        workspaceAttachedFiles: ['/external/workspace-file.md'],
      },
    )).toEqual([
      '/workspaces/current-session/generated/file.txt',
      '/external/session-directory/file.txt',
      '/external/session-file.md',
    ])
  })

  test('includes complete workspace scope without crossing root boundaries', () => {
    expect(getOwnedSessionWatcherPaths(
      [
        '/workspaces/current-session/generated/file.txt',
        '/workspaces/current-session-copy/file.txt',
        '/workspaces/workspace-files/shared.md',
        '/external/workspace-directory/file.txt',
        '/external/workspace-file.md',
        '/external/unattached.md',
      ],
      {
        sessionExists: true,
        sessionPath: '/workspaces/current-session',
        sessionAttachedDirectories: [],
        sessionAttachedFiles: [],
        workspaceAttachmentsComplete: true,
        workspaceFilesPath: '/workspaces/workspace-files',
        workspaceAttachedDirectories: ['/external/workspace-directory'],
        workspaceAttachedFiles: ['/external/workspace-file.md'],
      },
    )).toEqual([
      '/workspaces/current-session/generated/file.txt',
      '/workspaces/workspace-files/shared.md',
      '/external/workspace-directory/file.txt',
      '/external/workspace-file.md',
    ])
  })
})
