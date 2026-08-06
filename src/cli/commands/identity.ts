import {
  handleIdentityList, handleIdentityProve, handleIdentityCreate,
  handleBackupShamir, handleRestoreShamir,
  handleIdentityBackup, handleIdentityRestore, handleIdentityMigrate,
  handleTrustProofPublish,
} from '../../exports.js'
import * as fmt from '../../format.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
): Promise<void> {
  const { req, flag, hasFlag, out } = h

  switch (cmd) {
    case 'whoami':
      console.log(ctx.activeNpub)
      break

    case 'create':
      out(handleIdentityCreate())
      break

    case 'list':
      out(await handleIdentityList(ctx), fmt.formatIdentityList)
      break

    case 'derive':
      out(await ctx.derive(req(1, 'derive <purpose> [index]'), parseInt(cmdArgs[2] ?? '0', 10)))
      break

    case 'persona':
      out(await ctx.derivePersona(req(1, 'persona <name> [index]'), parseInt(cmdArgs[2] ?? '0', 10)))
      break

    case 'switch': {
      const target = req(1, 'switch <target> [index]')
      await ctx.switch(target, cmdArgs[2] ? parseInt(cmdArgs[2], 10) : undefined)
      // Name the derivation path, not just the npub. A bare name means the
      // persona path, so `switch work` and `derive work` are different keys;
      // without the path on screen the difference is invisible until something
      // has been signed by the wrong identity.
      console.error(`Now signing as ${ctx.activeNpub} (${ctx.activePurpose})`)
      if (target !== 'master' && !target.includes(':') && ctx.activePurpose === `persona/${target}`) {
        console.error(
          `Note: "${target}" resolved to the persona path. The raw purpose ` +
            `"${target}" is a different key — see \`derive ${target}\`.`,
        )
      }
      // The CLI is one process per command, so this applies to the rest of this
      // invocation only. Say so rather than implying a saved default.
      console.error('This switch applies to this command only; use --key or --bunker to sign as')
      console.error('another identity in a later command.')
      console.log(ctx.activeNpub)
      break
    }

    case 'prove':
      out(await handleIdentityProve(ctx, { mode: (cmdArgs[1] === 'full' ? 'full' : 'blind') }))
      break

    case 'proof-publish': {
      const r = await handleTrustProofPublish(ctx, pool, {
        mode: (cmdArgs[1] === 'full' ? 'full' : 'blind'),
        confirm: hasFlag('confirm'),
      })
      out(r)
      break
    }

    case 'backup':
      out(handleBackupShamir({
        secret: new Uint8Array(ctx.activePrivateKey),
        threshold: parseInt(cmdArgs[2] ?? '3', 10),
        shares: parseInt(cmdArgs[3] ?? '5', 10),
        outputDir: req(1, 'backup <dir> [threshold] [shares]'),
      }))
      break

    case 'restore': {
      const tFlag = flag('t', '3')!
      const files = cmdArgs.slice(1).filter(a => a !== '--t' && a !== `-t` && a !== tFlag)
      out({ masterNpub: handleRestoreShamir({ files, threshold: parseInt(tFlag, 10) }) })
      break
    }

    case 'identity-backup':
      out(await handleIdentityBackup(pool, req(1, 'identity-backup <pubkey-hex>'), ctx.activeNpub))
      break

    case 'identity-restore':
      out(await handleIdentityRestore(ctx, pool,
        await handleIdentityBackup(pool, req(1, 'identity-restore <pubkey-hex>'), ctx.activeNpub)))
      break

    case 'migrate':
      out(await handleIdentityMigrate(ctx, pool, {
        oldPubkeyHex: req(1, 'migrate <old-hex> <old-npub>'),
        oldNpub: req(2, 'migrate <old-hex> <old-npub>'),
        confirm: hasFlag('confirm'),
      }))
      break

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
