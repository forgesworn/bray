export interface RegistryContentSpec {
  type?: string
  required?: boolean
  min?: number
  max?: number
  either?: string[]
  next?: RegistryContentSpec
  variadic?: boolean
}

export interface RegistryTagSpec {
  name?: string
  prefix?: string
  next?: RegistryContentSpec
  description?: string
}

export interface RegistryKindSchema {
  description?: string
  in_use?: boolean
  content?: RegistryContentSpec
  required?: string[]
  multiple?: string[]
  tags?: RegistryTagSpec[]
}

export interface KindRegistrySchema {
  generic_tags: Record<string, RegistryContentSpec>
  kinds: Record<string, RegistryKindSchema>
}
