import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startRelay } from '../src/serve.js'
import { startBunker } from '../src/bunker.js'
import { IdentityContext } from '../src/context.js'
import { BunkerContext } from '../src/bunker-context.js'
import { HeartwoodContext } from '../src/heartwood-context.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

let relay: ReturnType<typeof startRelay>
let bunkerServer: ReturnType<typeof startBunker>
let ctx: IdentityContext

describe('HeartwoodContext', () => {
  beforeAll(() => {
    relay = startRelay({ port: 19649, quiet: true })
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
    bunkerServer = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
    })
  })

  afterAll(() => {
    bunkerServer.close()
    ctx.destroy()
    relay.close()
  })

  it('probe returns null for a standard NIP-46 bunker', async () => {
    const base = await BunkerContext.connect(bunkerServer.url)
    const hw = await HeartwoodContext.probe(base)
    expect(hw).toBeNull()
    base.destroy()
  }, 15_000)
})
