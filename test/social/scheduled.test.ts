import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IdentityContext } from '../../src/context.js'
import {
  handlePostSchedule,
  handlePostQueueList,
  handlePostQueueCancel,
  handlePublishScheduled,
} from '../../src/social/scheduled.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

let tempDir: string
let ctx: IdentityContext

beforeEach(() => {
  tempDir = join(tmpdir(), `bray-scheduled-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
  ctx = new IdentityContext(TEST_NSEC, 'nsec')
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function mockPool(success = true) {
  return {
    query: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({
      success,
      allAccepted: success,
      accepted: success ? ['wss://relay.example.com'] : [],
      rejected: success ? [] : ['wss://relay.example.com'],
      errors: [],
    }),
    reconfigure: vi.fn(),
  }
}

describe('handlePostSchedule', () => {
  it('writes a valid JSON file with correct name format', async () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600
    const result = await handlePostSchedule(ctx, {
      content: 'gm nostr',
      scheduledAt: futureTs,
    }, tempDir)

    expect(result.scheduled).toBe(true)
    expect(result.scheduledAt).toBe(futureTs)
    expect(result.eventId).toBeDefined()
    expect(result.filePath).toContain(tempDir)

    // Check file exists and has correct name format
    const files = readdirSync(tempDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d+-[a-f0-9]{8}\.json$/)

    // Check file contents
    const data = JSON.parse(readFileSync(result.filePath, 'utf-8'))
    expect(data.scheduledAt).toBe(futureTs)
    expect(data.event.content).toBe('gm nostr')
    expect(data.event.kind).toBe(1)
    expect(data.event.id).toBeDefined()
    expect(data.event.sig).toBeDefined()
    expect(data.relays).toEqual([])
  })

  it('accepts ISO datetime strings', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const result = await handlePostSchedule(ctx, {
      content: 'hello',
      scheduledAt: future,
    }, tempDir)

    expect(result.scheduled).toBe(true)
    expect(result.scheduledAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('rejects past timestamps', async () => {
    const pastTs = Math.floor(Date.now() / 1000) - 3600
    await expect(
      handlePostSchedule(ctx, { content: 'too late', scheduledAt: pastTs }, tempDir),
    ).rejects.toThrow('scheduledAt must be in the future')
  })

  it('creates the queue directory if it does not exist', async () => {
    const nestedDir = join(tempDir, 'nested', 'queue')
    const futureTs = Math.floor(Date.now() / 1000) + 3600
    await handlePostSchedule(ctx, {
      content: 'test',
      scheduledAt: futureTs,
    }, nestedDir)

    const files = readdirSync(nestedDir)
    expect(files).toHaveLength(1)
  })

  it('supports custom kind and tags', async () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600
    const result = await handlePostSchedule(ctx, {
      content: 'my article',
      scheduledAt: futureTs,
      kind: 30023,
      tags: [['d', 'my-article'], ['t', 'bitcoin']],
    }, tempDir)

    const data = JSON.parse(readFileSync(result.filePath, 'utf-8'))
    expect(data.event.kind).toBe(30023)
    expect(data.event.tags).toEqual([['d', 'my-article'], ['t', 'bitcoin']])
  })

  it('stores relays in the file', async () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600
    const result = await handlePostSchedule(ctx, {
      content: 'test',
      scheduledAt: futureTs,
      relays: ['wss://relay1.example.com', 'wss://relay2.example.com'],
    }, tempDir)

    const data = JSON.parse(readFileSync(result.filePath, 'utf-8'))
    expect(data.relays).toEqual(['wss://relay1.example.com', 'wss://relay2.example.com'])
  })
})

describe('handlePostQueueList', () => {
  it('reads and sorts files by scheduledAt ascending', async () => {
    const ts1 = Math.floor(Date.now() / 1000) + 7200
    const ts2 = Math.floor(Date.now() / 1000) + 3600
    const ts3 = Math.floor(Date.now() / 1000) + 10800

    await handlePostSchedule(ctx, { content: 'second', scheduledAt: ts1 }, tempDir)
    await handlePostSchedule(ctx, { content: 'first', scheduledAt: ts2 }, tempDir)
    await handlePostSchedule(ctx, { content: 'third', scheduledAt: ts3 }, tempDir)

    const entries = handlePostQueueList(tempDir)
    expect(entries).toHaveLength(3)
    expect(entries[0].scheduledAt).toBe(ts2)
    expect(entries[0].content).toBe('first')
    expect(entries[1].scheduledAt).toBe(ts1)
    expect(entries[2].scheduledAt).toBe(ts3)
  })

  it('returns empty array for missing directory', () => {
    const entries = handlePostQueueList(join(tempDir, 'nonexistent'))
    expect(entries).toEqual([])
  })

  it('returns empty array for empty directory', () => {
    const entries = handlePostQueueList(tempDir)
    expect(entries).toEqual([])
  })

  it('truncates content to 80 characters', async () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600
    const longContent = 'x'.repeat(200)
    await handlePostSchedule(ctx, { content: longContent, scheduledAt: futureTs }, tempDir)

    const entries = handlePostQueueList(tempDir)
    expect(entries[0].content).toHaveLength(80)
  })
})

describe('handlePostQueueCancel', () => {
  it('deletes the correct file', async () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600
    const result = await handlePostSchedule(ctx, { content: 'cancel me', scheduledAt: futureTs }, tempDir)

    const cancelled = handlePostQueueCancel(result.eventId, tempDir)
    expect(cancelled.cancelled).toBe(true)
    expect(cancelled.eventId).toBe(result.eventId)

    const files = readdirSync(tempDir)
    expect(files).toHaveLength(0)
  })

  it('throws for unknown event ID', () => {
    expect(() => handlePostQueueCancel('deadbeef', tempDir)).toThrow('Scheduled post not found: deadbeef')
  })

  it('throws when directory does not exist', () => {
    expect(() => handlePostQueueCancel('deadbeef', join(tempDir, 'nope'))).toThrow('Scheduled post not found')
  })
})

describe('handlePublishScheduled', () => {
  it('publishes due events and deletes files', async () => {
    // Write a file that is already due (scheduledAt in the past)
    const pastTs = Math.floor(Date.now() / 1000) - 60
    const sign = ctx.getSigningFunction()
    const event = await sign({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'due post',
    })
    const fileName = `${pastTs}-${event.id.slice(0, 8)}.json`
    writeFileSync(join(tempDir, fileName), JSON.stringify({
      scheduledAt: pastTs,
      event,
      relays: ['wss://relay.example.com'],
    }))

    const pool = mockPool(true)
    const result = await handlePublishScheduled(pool as any, 'npub1test', tempDir)

    expect(result.published).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.remaining).toBe(0)
    expect(pool.reconfigure).toHaveBeenCalledWith('npub1test', {
      read: ['wss://relay.example.com'],
      write: ['wss://relay.example.com'],
    })
    expect(pool.publish).toHaveBeenCalledOnce()
    const [calledNpub, calledEvent] = pool.publish.mock.calls[0]
    expect(calledNpub).toBe('npub1test')
    expect(calledEvent.id).toBe(event.id)
    expect(calledEvent.sig).toBe(event.sig)
    expect(calledEvent.content).toBe('due post')

    const files = readdirSync(tempDir)
    expect(files).toHaveLength(0)
  })

  it('skips future events', async () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600
    await handlePostSchedule(ctx, { content: 'not yet', scheduledAt: futureTs }, tempDir)

    const pool = mockPool()
    const result = await handlePublishScheduled(pool as any, 'npub1test', tempDir)

    expect(result.published).toBe(0)
    expect(result.remaining).toBe(1)
    expect(pool.publish).not.toHaveBeenCalled()

    // File should still exist
    const files = readdirSync(tempDir)
    expect(files).toHaveLength(1)
  })

  it('handles publish failures gracefully', async () => {
    const pastTs = Math.floor(Date.now() / 1000) - 60
    const sign = ctx.getSigningFunction()
    const event = await sign({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'will fail',
    })
    writeFileSync(join(tempDir, `${pastTs}-${event.id.slice(0, 8)}.json`), JSON.stringify({
      scheduledAt: pastTs,
      event,
      relays: [],
    }))

    const pool = mockPool(false)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await handlePublishScheduled(pool as any, 'npub1test', tempDir)
    consoleSpy.mockRestore()

    expect(result.published).toBe(0)
    expect(result.failed).toBe(1)

    // File should still exist (not deleted on failure)
    const files = readdirSync(tempDir)
    expect(files).toHaveLength(1)
  })

  it('returns zero counts for empty queue', async () => {
    const pool = mockPool()
    const result = await handlePublishScheduled(pool as any, 'npub1test', tempDir)

    expect(result.published).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.remaining).toBe(0)
  })

  it('returns zero counts for missing directory', async () => {
    const pool = mockPool()
    const result = await handlePublishScheduled(pool as any, 'npub1test', join(tempDir, 'missing'))

    expect(result.published).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.remaining).toBe(0)
  })

  it('publishes due events and leaves future events', async () => {
    const pastTs = Math.floor(Date.now() / 1000) - 60
    const futureTs = Math.floor(Date.now() / 1000) + 3600

    const sign = ctx.getSigningFunction()
    const dueEvent = await sign({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'due',
    })
    writeFileSync(join(tempDir, `${pastTs}-${dueEvent.id.slice(0, 8)}.json`), JSON.stringify({
      scheduledAt: pastTs,
      event: dueEvent,
      relays: [],
    }))

    await handlePostSchedule(ctx, { content: 'future', scheduledAt: futureTs }, tempDir)

    const pool = mockPool(true)
    const result = await handlePublishScheduled(pool as any, 'npub1test', tempDir)

    expect(result.published).toBe(1)
    expect(result.remaining).toBe(1)

    const files = readdirSync(tempDir)
    expect(files).toHaveLength(1)
  })
})
