import { z } from 'zod'

export const eventValidationModeSchema = z.enum(['strict-known', 'off']).default('strict-known')

export const semanticEventInputSchema = z.object({
  kind: z.number().int().min(0).max(65_535),
  content: z.string(),
  tags: z.array(z.array(z.string())),
  created_at: z.number().int().nonnegative().optional(),
  pubkey: z.string().optional(),
  id: z.string().optional(),
  sig: z.string().optional(),
}).strict()
