import {
  KIND_REGISTRY_COMMIT,
  KIND_REGISTRY_SHA256,
  KIND_REGISTRY_SOURCE,
  PINNED_KIND_REGISTRY,
} from './registry.generated.js'
import type { RegistryContentSpec, RegistryKindSchema, RegistryTagSpec } from './registry-types.js'

export type EventValidationMode = 'strict-known' | 'off'
export type EventValidationSeverity = 'error' | 'warning'
export type EventValidationPath = Array<string | number>

export interface EventValidationIssue {
  code: string
  path: EventValidationPath
  severity: EventValidationSeverity
  message: string
  suggestion?: string
}

export interface EventValidationResult {
  valid: boolean
  knownKind: boolean
  status: 'known-valid' | 'known-invalid' | 'unknown' | 'validation-off'
  kind?: number
  description?: string
  mode: EventValidationMode
  schema: {
    source: string
    commit: string
    sha256: string
  }
  issues: EventValidationIssue[]
}

export interface SemanticEventInput {
  kind?: unknown
  content?: unknown
  tags?: unknown
  created_at?: unknown
  pubkey?: unknown
  id?: unknown
  sig?: unknown
}

const HEX_64 = /^[0-9a-f]{64}$/
const HEX_128 = /^[0-9a-f]{128}$/
const GEOHASH = /^[0-9bcdefghjkmnpqrstuvwxyz]+$/
const MAX_CONTENT_BYTES = 1024 * 1024
const MAX_TAGS = 2048
const MAX_TAG_ITEMS = 64
const MAX_TAG_ITEM_BYTES = 8192

const schemaIdentity = {
  source: KIND_REGISTRY_SOURCE,
  commit: KIND_REGISTRY_COMMIT,
  sha256: KIND_REGISTRY_SHA256,
}

function issue(
  code: string,
  path: EventValidationPath,
  severity: EventValidationSeverity,
  message: string,
  suggestion?: string,
): EventValidationIssue {
  return { code, path, severity, message, ...(suggestion ? { suggestion } : {}) }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function isAddressableKind(kind: number): boolean {
  return kind >= 30_000 && kind < 40_000
}

function isTrimmed(value: string): boolean {
  return value.trim() === value
}

function validateBasicShape(input: SemanticEventInput, issues: EventValidationIssue[]): {
  kind?: number
  content?: string
  tags?: string[][]
} {
  const kind = input.kind
  if (!Number.isInteger(kind) || (kind as number) < 0 || (kind as number) > 65_535) {
    issues.push(issue(
      'event.invalid_kind', ['kind'], 'error',
      'Event kind must be an integer from 0 to 65535.',
      'Provide the numeric event kind defined by the target protocol.',
    ))
  }

  const content = input.content
  if (typeof content !== 'string') {
    issues.push(issue('event.invalid_content', ['content'], 'error', 'Event content must be a string.'))
  } else if (byteLength(content) > MAX_CONTENT_BYTES) {
    issues.push(issue(
      'event.content_too_large', ['content'], 'error',
      `Event content exceeds Bray's ${MAX_CONTENT_BYTES}-byte safety limit.`,
      'Move large payloads to Blossom and publish a reference instead.',
    ))
  }

  const tags = input.tags
  let normalisedTags: string[][] | undefined
  if (!Array.isArray(tags)) {
    issues.push(issue('event.invalid_tags', ['tags'], 'error', 'Event tags must be an array of string arrays.'))
  } else if (tags.length > MAX_TAGS) {
    issues.push(issue(
      'event.too_many_tags', ['tags'], 'error',
      `Event has more than Bray's ${MAX_TAGS}-tag safety limit.`,
      'Reduce the tag set or split the data across multiple events.',
    ))
  } else {
    normalisedTags = []
    tags.forEach((tag, tagIndex) => {
      if (!Array.isArray(tag)) {
        issues.push(issue('tag.invalid_shape', ['tags', tagIndex], 'error', 'Each tag must be an array of strings.'))
        return
      }
      if (tag.length === 0) {
        issues.push(issue(
          'tag.empty', ['tags', tagIndex], 'error',
          'Tags must contain at least a tag name.',
          'Remove the empty tag or add its protocol-defined name and values.',
        ))
        return
      }
      if (tag.length > MAX_TAG_ITEMS) {
        issues.push(issue('tag.too_many_items', ['tags', tagIndex], 'error', `Tag has more than ${MAX_TAG_ITEMS} items.`))
      }
      const values: string[] = []
      tag.forEach((value, itemIndex) => {
        if (typeof value !== 'string') {
          issues.push(issue('tag.non_string_item', ['tags', tagIndex, itemIndex], 'error', 'Every tag item must be a string.'))
          return
        }
        if (byteLength(value) > MAX_TAG_ITEM_BYTES) {
          issues.push(issue('tag.item_too_large', ['tags', tagIndex, itemIndex], 'error', `Tag item exceeds ${MAX_TAG_ITEM_BYTES} bytes.`))
        }
        values.push(value)
      })
      if (values.length === tag.length) normalisedTags!.push(values)
    })
  }

  if (input.created_at !== undefined && (!Number.isInteger(input.created_at) || (input.created_at as number) < 0)) {
    issues.push(issue('event.invalid_created_at', ['created_at'], 'error', 'created_at must be a non-negative Unix timestamp.'))
  }
  if (input.pubkey !== undefined && (typeof input.pubkey !== 'string' || !HEX_64.test(input.pubkey))) {
    issues.push(issue('event.invalid_pubkey', ['pubkey'], 'error', 'pubkey must be 64 lowercase hexadecimal characters.'))
  }
  if (input.id !== undefined && (typeof input.id !== 'string' || !HEX_64.test(input.id))) {
    issues.push(issue('event.invalid_id', ['id'], 'error', 'id must be 64 lowercase hexadecimal characters.'))
  }
  if (input.sig !== undefined && (typeof input.sig !== 'string' || !HEX_128.test(input.sig))) {
    issues.push(issue('event.invalid_signature', ['sig'], 'error', 'sig must be 128 lowercase hexadecimal characters.'))
  }

  return {
    kind: Number.isInteger(kind) ? kind as number : undefined,
    content: typeof content === 'string' ? content : undefined,
    tags: normalisedTags,
  }
}

function validateUrl(value: string, schemes?: Set<string>): boolean {
  try {
    const parsed = new URL(value)
    return Boolean(parsed.hostname) && (!schemes || schemes.has(parsed.protocol))
  } catch {
    return false
  }
}

function valueError(value: string, spec: RegistryContentSpec): { code: string; message: string; suggestion?: string } | undefined {
  switch (spec.type) {
    case undefined:
    case 'free':
      return undefined
    case 'empty':
      return value.length === 0 ? undefined : { code: 'value.not_empty', message: 'Value must be empty.', suggestion: 'Use an empty string at this position.' }
    case 'id':
      return HEX_64.test(value) ? undefined : { code: 'value.invalid_event_id', message: 'Expected a 64-character lowercase hexadecimal event ID.', suggestion: 'Decode note/nevent references to their hexadecimal event ID.' }
    case 'pubkey':
      return HEX_64.test(value) ? undefined : { code: 'value.invalid_pubkey', message: 'Expected a 64-character lowercase hexadecimal public key.', suggestion: 'Decode npub/nprofile references to their hexadecimal public key.' }
    case 'addr': {
      const first = value.indexOf(':')
      const second = value.indexOf(':', first + 1)
      if (first <= 0 || second <= first + 1) return { code: 'value.invalid_address', message: 'Expected an address in kind:pubkey:identifier form.' }
      const kind = Number(value.slice(0, first))
      const pubkey = value.slice(first + 1, second)
      return Number.isInteger(kind) && kind >= 0 && kind <= 65_535 && HEX_64.test(pubkey)
        ? undefined
        : { code: 'value.invalid_address', message: 'Expected an address containing a valid kind and hexadecimal public key.' }
    }
    case 'kind': {
      const kind = Number(value)
      return /^\d+$/.test(value) && Number.isInteger(kind) && kind <= 65_535
        ? undefined
        : { code: 'value.invalid_kind', message: 'Expected a decimal event kind from 0 to 65535.' }
    }
    case 'relay':
      return validateUrl(value, new Set(['ws:', 'wss:']))
        ? undefined
        : { code: 'value.invalid_relay', message: 'Expected a ws:// or wss:// relay URL.', suggestion: 'Use a canonical WebSocket relay URL.' }
    case 'url':
      return validateUrl(value)
        ? undefined
        : { code: 'value.invalid_url', message: 'Expected an absolute URL.' }
    case 'giturl': {
      const scpStyle = /^[^\s@]+@[^\s:]+:[^\s]+$/.test(value)
      return scpStyle || validateUrl(value, new Set(['git:', 'ssh:', 'http:', 'https:']))
        ? undefined
        : { code: 'value.invalid_git_url', message: 'Expected a Git, SSH or HTTP(S) repository URL.' }
    }
    case 'json':
      try {
        JSON.parse(value)
        return undefined
      } catch {
        return { code: 'value.invalid_json', message: 'Expected valid JSON content.', suggestion: 'Serialise the content with JSON.stringify before publishing.' }
      }
    case 'constrained':
      return spec.either?.includes(value)
        ? undefined
        : { code: 'value.not_allowed', message: `Expected one of: ${(spec.either ?? []).join(', ')}.`, suggestion: 'Use one of the protocol-defined values.' }
    case 'hex': {
      if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return { code: 'value.invalid_hex', message: 'Expected an even-length hexadecimal value.' }
      if (spec.min && value.length < spec.min) return { code: 'value.hex_too_short', message: `Hex value must contain at least ${spec.min} characters.` }
      if (spec.max && value.length > spec.max) return { code: 'value.hex_too_long', message: `Hex value must contain at most ${spec.max} characters.` }
      return undefined
    }
    case 'lowercase':
      return value.toLowerCase() === value ? undefined : { code: 'value.not_lowercase', message: 'Expected a lowercase value.', suggestion: `Use ${JSON.stringify(value.toLowerCase())}.` }
    case 'timestamp':
      return /^\d+$/.test(value) ? undefined : { code: 'value.invalid_timestamp', message: 'Expected an unsigned Unix timestamp string.' }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { code: 'value.invalid_date', message: 'Expected a date in YYYY-MM-DD form.' }
      const parsed = new Date(`${value}T00:00:00Z`)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
        ? undefined
        : { code: 'value.invalid_date', message: 'Expected a real calendar date in YYYY-MM-DD form.' }
    }
    case 'geohash':
      return GEOHASH.test(value) ? undefined : { code: 'value.invalid_geohash', message: 'Expected a lowercase base32 geohash.' }
    case 'imeta':
      return value.trim().split(/\s+/, 2).length === 2
        ? undefined
        : { code: 'value.invalid_imeta', message: 'Expected a space-separated imeta key and value.' }
    default:
      return { code: 'schema.unknown_type', message: `The pinned registry uses unsupported value type ${JSON.stringify(spec.type)}.` }
  }
}

function validateSpec(
  tag: string[],
  tagIndex: number,
  itemIndex: number,
  spec: RegistryContentSpec,
): EventValidationIssue[] {
  if (itemIndex >= tag.length) {
    return spec.required
      ? [issue(
          'tag.missing_item', ['tags', tagIndex, itemIndex], 'error',
          `Tag ${JSON.stringify(tag[0])} is missing required item ${itemIndex}.`,
          'Add the protocol-defined value at this position.',
        )]
      : []
  }

  const indices = spec.variadic
    ? Array.from({ length: tag.length - itemIndex }, (_, offset) => itemIndex + offset)
    : [itemIndex]
  const issues: EventValidationIssue[] = []

  for (const index of indices) {
    const value = tag[index]!
    if (!isTrimmed(value)) {
      issues.push(issue(
        'tag.dangling_space', ['tags', tagIndex, index], 'error',
        'Tag values must not have leading or trailing whitespace.',
        `Trim the value to ${JSON.stringify(value.trim())}.`,
      ))
      continue
    }
    if (value === '' && !spec.required) continue
    const invalid = valueError(value, spec)
    if (invalid) issues.push(issue(invalid.code, ['tags', tagIndex, index], 'error', invalid.message, invalid.suggestion))
  }

  if (!spec.variadic && spec.next) {
    issues.push(...validateSpec(tag, tagIndex, itemIndex + 1, spec.next))
  }
  return issues
}

function matchingSpecs(tagName: string, schema: RegistryKindSchema): RegistryTagSpec[] {
  return (schema.tags ?? []).filter(spec =>
    spec.name === tagName || Boolean(spec.prefix && tagName.startsWith(spec.prefix)),
  )
}

function validateKnownKind(
  kind: number,
  content: string,
  tags: string[][],
  schema: RegistryKindSchema,
  issues: EventValidationIssue[],
): void {
  const contentSpec = schema.content
  if (contentSpec) {
    const invalid = valueError(content, contentSpec)
    if (invalid) issues.push(issue(invalid.code, ['content'], 'error', invalid.message, invalid.suggestion))
  }

  const names = tags.map(tag => tag[0]!)
  const required = new Set(schema.required ?? [])
  if (isAddressableKind(kind)) required.add('d')
  for (const name of required) {
    if (!names.includes(name)) {
      issues.push(issue(
        'tag.required_missing', ['tags'], 'error',
        `Kind ${kind} requires a ${JSON.stringify(name)} tag.`,
        `Add a ${JSON.stringify([name, '<value>'])} tag with the protocol-defined value.`,
      ))
    }
  }

  const multiple = new Set(schema.multiple ?? [])
  const seen = new Map<string, number>()
  tags.forEach((tag, tagIndex) => {
    const tagName = tag[0]!
    const prior = seen.get(tagName)
    if (prior !== undefined && !multiple.has(tagName)) {
      issues.push(issue(
        'tag.duplicate', ['tags', tagIndex], 'error',
        `Kind ${kind} does not allow multiple ${JSON.stringify(tagName)} tags.`,
        `Keep one ${JSON.stringify(tagName)} tag or confirm the target protocol permits multiples.`,
      ))
    } else {
      seen.set(tagName, tagIndex)
    }

    const candidates = matchingSpecs(tagName, schema)
    if (candidates.length > 0) {
      const candidateIssues = candidates.map(spec => spec.next ? validateSpec(tag, tagIndex, 1, spec.next) : [])
      if (!candidateIssues.some(result => result.length === 0)) {
        issues.push(...candidateIssues.sort((a, b) => a.length - b.length)[0]!)
      }
      return
    }

    const generic = PINNED_KIND_REGISTRY.generic_tags[tagName]
    if (generic) {
      issues.push(...validateSpec(tag, tagIndex, 1, generic))
      return
    }

    issues.push(issue(
      'tag.unknown_for_kind', ['tags', tagIndex], 'warning',
      `The pinned registry does not define tag ${JSON.stringify(tagName)} for kind ${kind}.`,
      'Confirm this extension tag is intentional and supported by the receiving implementation.',
    ))
  })
}

export function handleValidateEvent(
  event: SemanticEventInput,
  mode: EventValidationMode = 'strict-known',
): EventValidationResult {
  if (mode === 'off') {
    const issues: EventValidationIssue[] = []
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      issues.push(issue('event.invalid_shape', [], 'error', 'Event must be an object.'))
    } else {
      validateBasicShape(event, issues)
    }
    issues.push(issue(
      'validation.off', [], 'warning',
      'Protocol-specific semantic event validation was explicitly disabled.',
      'Use strict-known unless interoperability testing requires an escape hatch.',
    ))
    const kind = Number.isInteger(event?.kind) ? event.kind as number : undefined
    const knownKind = kind !== undefined && Boolean(PINNED_KIND_REGISTRY.kinds[String(kind)])
    return {
      valid: !issues.some(entry => entry.severity === 'error'),
      knownKind,
      status: 'validation-off',
      kind,
      mode,
      schema: schemaIdentity,
      issues,
    }
  }

  const issues: EventValidationIssue[] = []
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    issues.push(issue('event.invalid_shape', [], 'error', 'Event must be an object.'))
    return {
      valid: false,
      knownKind: false,
      status: 'known-invalid',
      mode,
      schema: schemaIdentity,
      issues,
    }
  }

  const basic = validateBasicShape(event, issues)
  const kindSchema = basic.kind === undefined ? undefined : PINNED_KIND_REGISTRY.kinds[String(basic.kind)]
  const knownKind = Boolean(kindSchema)

  if (kindSchema && basic.content !== undefined && basic.tags !== undefined) {
    validateKnownKind(basic.kind!, basic.content, basic.tags, kindSchema, issues)
    if (kindSchema.in_use === false) {
      issues.push(issue(
        'kind.not_in_use', ['kind'], 'warning',
        `The pinned registry marks kind ${basic.kind} as not in use.`,
        'Confirm the receiving implementation still supports this event kind.',
      ))
    }
  } else if (basic.kind !== undefined && !knownKind) {
    issues.push(issue(
      'kind.unknown', ['kind'], 'warning',
      `Kind ${basic.kind} is not present in Bray's pinned Registry of Kinds snapshot.`,
      'Unknown and experimental kinds are allowed, but confirm their schema with the receiving protocol.',
    ))
  }

  const valid = !issues.some(entry => entry.severity === 'error')
  return {
    valid,
    knownKind,
    status: knownKind ? (valid ? 'known-valid' : 'known-invalid') : 'unknown',
    kind: basic.kind,
    description: kindSchema?.description,
    mode,
    schema: schemaIdentity,
    issues,
  }
}

/** Public, protocol-focused name; handler alias retained for Bray's internal conventions. */
export const validateEventSemantics = handleValidateEvent

export class EventSemanticValidationError extends Error {
  readonly validation: EventValidationResult

  constructor(validation: EventValidationResult) {
    const summary = validation.issues
      .filter(entry => entry.severity === 'error')
      .map(entry => `${entry.code} at ${entry.path.join('.') || '<event>'}: ${entry.message}`)
      .join('; ')
    super(`Event semantic validation failed: ${summary}`)
    this.name = 'EventSemanticValidationError'
    this.validation = validation
  }
}

export function assertEventSemanticallyValid(
  event: SemanticEventInput,
  mode: EventValidationMode = 'strict-known',
): EventValidationResult {
  const validation = handleValidateEvent(event, mode)
  if (!validation.valid) throw new EventSemanticValidationError(validation)
  return validation
}
