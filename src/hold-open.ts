/**
 * Keep the process alive until released.
 *
 * A long-running daemon must not end with `await new Promise(() => {})`: that
 * promise holds no event-loop handle, so the moment the last socket closes
 * Node finds nothing left to wait for and exits with code 13 ("unsettled
 * top-level await"). A timer is a handle, so this holds the loop open however
 * the sockets behave. Release it from the shutdown path.
 */
export function holdProcessOpen(): { done: Promise<void>; release: () => void } {
  let release!: () => void
  const done = new Promise<void>(resolve => {
    const timer = setInterval(() => {}, 60_000)
    release = () => {
      clearInterval(timer)
      resolve()
    }
  })
  return { done, release }
}
