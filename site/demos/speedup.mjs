#!/usr/bin/env node
// Compress recorded story GIFs to a watchable pace.
//
// vhs recordings are honest but slow: most of each loop is the assistant
// working, captured as long runs of near-identical spinner frames at ~0.6s
// each. This pass keeps every fast frame (typing, streaming output) at its
// original cadence, thins the slow runs to every third frame at 0.08s, and
// holds the final frame long enough to read: the hold scales with how much
// text is on the last screen (PNG size of the composited frame as proxy),
// clamped to 3-10 seconds. A 90-second loop becomes a 10-20 second one
// without re-recording.
//
// Run on raw recordings, not on already-compressed output: the thinning
// pass is not idempotent.
//
// Usage: node site/demos/speedup.mjs [gif ...]   (defaults to all story GIFs)

import { execFileSync } from 'node:child_process'
import { readdirSync, statSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GIF_DIR = join(dirname(fileURLToPath(import.meta.url)), 'gifs')

const SLOW = 10        // hundredths; anything above this is a wait frame
const SLOW_KEEP = 3    // keep every Nth frame inside a slow run
const SLOW_DELAY = 8   // hundredths for kept wait frames
const MIN_DELAY = 3    // browsers misrender shorter delays
const FIRST_HOLD = 50  // opening beat so the loop restart is perceptible
const MIN_HOLD = 300   // closing hold floor: even a sparse screen gets 3s
const MAX_HOLD = 1000  // and a packed one at most 10s
const HOLD_DIVISOR = 450  // final-frame PNG bytes per hundredth of hold

function frameDelays (gif) {
  const info = execFileSync('gifsicle', ['--info', gif], { encoding: 'utf8' })
  const delays = []
  for (const line of info.split('\n')) {
    if (/^\s+\+ image #\d+/.test(line)) delays.push(0)
    const m = line.match(/delay ([0-9.]+)s/)
    if (m && delays.length) delays[delays.length - 1] = Math.round(parseFloat(m[1]) * 100)
  }
  return delays
}

function plan (delays, lastHold) {
  // Walk the frames, thinning runs of slow frames. Always keep the last
  // frame of a run so each stretch ends on its final state.
  const keep = []   // [frameIndex, newDelay]
  let runPos = -1
  for (let i = 0; i < delays.length; i++) {
    const d = delays[i]
    const slow = d > SLOW
    runPos = slow ? runPos + 1 : -1
    const lastOfRun = slow && (i + 1 >= delays.length || delays[i + 1] <= SLOW)
    if (slow && runPos % SLOW_KEEP !== 0 && !lastOfRun) continue
    keep.push([i, slow ? SLOW_DELAY : Math.max(d, MIN_DELAY)])
  }
  keep[0][1] = Math.max(keep[0][1], FIRST_HOLD)
  keep[keep.length - 1][1] = lastHold
  return keep
}

// How long the final screen deserves: composite the last frame, encode it
// as PNG, and treat the byte count as a proxy for how much there is to
// read. Falls back to the floor if ffmpeg is unavailable.
function endHold (unoptimisedGif) {
  try {
    execFileSync('gifsicle', [unoptimisedGif, '#-1', '-o', unoptimisedGif + '.last.gif'])
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', unoptimisedGif + '.last.gif',
      '-frames:v', '1', '-update', '1', unoptimisedGif + '.last.png'])
    const bytes = statSync(unoptimisedGif + '.last.png').size
    execFileSync('rm', [unoptimisedGif + '.last.gif', unoptimisedGif + '.last.png'])
    return Math.max(MIN_HOLD, Math.min(MAX_HOLD, Math.round(bytes / HOLD_DIVISOR)))
  } catch {
    return MIN_HOLD
  }
}

function duration (pairs) {
  return pairs.reduce((s, [, d]) => s + d, 0) / 100
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(GIF_DIR).filter(f => f.endsWith('.gif')).sort().map(f => join(GIF_DIR, f))

for (const gif of files) {
  const delays = frameDelays(gif)
  const before = delays.reduce((s, d) => s + d, 0) / 100
  const sizeBefore = statSync(gif).size

  const tmp = gif + '.tmp'
  // Unoptimise first: frames are stored as patches, so dropping any frame
  // without expanding them would corrupt everything composited after it.
  execFileSync('gifsicle', ['-U', gif, '-o', tmp])
  const kept = plan(delays, endHold(tmp))
  const args = [tmp, '--loopcount=forever']
  for (const [idx, delay] of kept) args.push('-d' + delay, '#' + idx)
  args.push('-O2', '-o', tmp + '2')
  execFileSync('gifsicle', args)
  renameSync(tmp + '2', gif)
  execFileSync('rm', [tmp])

  const sizeAfter = statSync(gif).size
  console.log(
    gif.split('/').pop().padEnd(38),
    `${before.toFixed(1)}s -> ${duration(kept).toFixed(1)}s`.padEnd(18),
    `${delays.length} -> ${kept.length} frames`.padEnd(20),
    `${(sizeBefore / 1024).toFixed(0)}K -> ${(sizeAfter / 1024).toFixed(0)}K`
  )
}
