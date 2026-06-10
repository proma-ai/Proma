import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'bun:test'
import { BackgroundTasksPanel } from './BackgroundTasksPanel'

describe('BackgroundTasksPanel', () => {
  test('renders workflow progress metadata from task_progress events', () => {
    const markup = renderToStaticMarkup(
      <BackgroundTasksPanel
        tasks={[{
          id: 'task-123456789',
          type: 'workflow',
          toolUseId: 'tool-123',
          startTime: 0,
          elapsedSeconds: 329,
          intent: 'deep-research',
          description: 'Verify source claims across independent searches',
          lastToolName: 'WebSearch',
          usage: {
            totalTokens: 1190133,
            toolUses: 384,
            durationMs: 329000,
          },
        }]}
      />
    )

    expect(markup).toContain('Verify source claims across independent searches')
    expect(markup).toContain('WebSearch')
    expect(markup).toContain('1,190,133 tokens')
    expect(markup).toContain('384 tools')
    expect(markup).toContain('5m 29s')
  })
})
