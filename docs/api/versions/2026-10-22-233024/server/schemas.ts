import { z } from 'zod';
import { PLATFORMS } from '../shared/types.js';

export const platformSchema = z.enum(PLATFORMS);
export const outlinePlatformSchema = z.object({
  platform: platformSchema, title: z.string().trim().min(1).max(140), angle: z.string().max(300), intro: z.string().max(1000),
  sections: z.array(z.object({ id: z.string().min(1).max(40), heading: z.string().max(100),
    points: z.array(z.string().trim().min(1).max(650)).min(1).max(4), factIds: z.array(z.string().max(100)).max(10) })).min(1).max(8),
  imageIds: z.array(z.string().max(100)).max(6), cta: z.string().trim().min(1).max(500),
});
export const outlineVersionSchema = z.object({ version: z.number().int().min(1) }).strict();
export const outlineEditSchema = z.object({ version: z.number().int().min(1), platforms: z.array(outlinePlatformSchema).min(1).max(4) }).strict();
export const outlineReviseSchema = z.object({ version: z.number().int().min(1), instructions: z.string().trim().min(1).max(2000) }).strict();
export const renderRequestSchema = z.object({ runId: z.string().min(1).max(100), revision: z.number().int().min(1),
  platform: platformSchema, selectedTitleIndex: z.number().int().min(0).max(2).default(0), templateId: z.string().min(1).max(80),
  deliveryId: z.string().uuid().optional(), visualMode: z.enum(['local', 'canva']).optional(), canvaSync: z.boolean().optional(), regenerateVisual:z.boolean().optional() }).strict();
export const connectionSettingsSchema = z.object({
  baseUrl: z.string().url().max(300).optional(), model: z.string().trim().min(1).max(100).optional(),
  apiKey: z.string().trim().max(500).optional(), imaClientId: z.string().trim().max(300).optional(),
  imaApiKey: z.string().trim().max(500).optional(), imaKbName: z.string().trim().min(1).max(120).optional(),
}).strict();
export const briefSchema = z.object({
  productId: z.string().max(180).default(''),
  audience: z.string().max(120).default(''),
  scene: z.string().max(250).default(''),
  goal: z.string().max(160).default('到店体验'),
  buyingStage: z.string().max(80).default('对比选择'),
  platforms: z.array(platformSchema).min(1, '请至少选择一个平台。').max(4, '同时最多生成四个平台。').refine(v => new Set(v).size === v.length, '平台不能重复。'),
  instructions: z.string().max(2000).default(''),
  mode: z.enum(['demo', 'live']).default('demo'),
  knowledgeSource: z.enum(['local', 'ima']).default('local'),
}).refine(v => !(v.mode === 'demo' && v.knowledgeSource === 'ima'), {
  message: 'ima 正式接入需要选择模型创作模式。', path: ['mode'],
});

export const jobSubmitSchema = z.intersection(z.object({ idempotencyKey: z.string().trim().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/) }), z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('outline'), brief: briefSchema, idempotencyKey: z.string() }).strict(),
  z.object({ kind: z.literal('outline-revise'), outlineId: z.string().min(1).max(100), version: z.number().int().min(1), instructions: z.string().trim().min(1).max(2000), platforms: z.array(platformSchema).min(1).max(4).optional(), idempotencyKey: z.string() }).strict(),
  z.object({ kind: z.literal('generate'), outlineId: z.string().min(1).max(100), version: z.number().int().min(1), renders: z.array(z.object({ platform: platformSchema, templateId: z.string().min(1).max(80), selectedTitleIndex: z.number().int().min(0).max(2).default(0) }).strict()).min(1).max(4).optional(), idempotencyKey: z.string() }).strict(),
  z.object({ kind: z.literal('render'), request: renderRequestSchema, idempotencyKey: z.string() }).strict(),
]));

export const strategySchema = z.object({
  platform: platformSchema, angle: z.string().min(1).max(300), painPoint: z.string().min(1).max(400),
  sellingPoints: z.array(z.object({ factId: z.string().min(1), benefit: z.string().min(1).max(300) })).min(1).max(5),
  tone: z.string().min(1).max(160), structure: z.array(z.string().max(100)).min(1).max(8),
  imageCount: z.number().int().min(0).max(6), cta: z.string().min(1).max(250), buyingStage: z.string().min(1).max(100),
});

export const draftSchema = z.object({
  id: z.string().default(''), platform: platformSchema,
  titles: z.array(z.string().min(1).max(140)).min(1).max(3),
  intro: z.string().max(1000),
  blocks: z.array(z.object({
    id: z.string().min(1).max(40), heading: z.string().max(100), text: z.string().min(1).max(2200),
    factIds: z.array(z.string().max(50)).max(10),
  })).min(1).max(8),
  cta: z.string().min(1).max(500), tags: z.array(z.string().max(40)).max(8),
  images: z.array(z.object({ imageId: z.string().max(100), afterBlock: z.number().int().min(-1).max(7), caption: z.string().max(300), reason: z.string().max(300) })).max(6),
});

export const modelReviewSchema = z.object({
  summary: z.string().max(1000),
  issues: z.array(z.object({
    severity: z.enum(['error', 'warning', 'info']),
    category: z.enum(['fact', 'image', 'compliance', 'platform', 'source']),
    message: z.string().min(1).max(500), suggestion: z.string().max(500),
    platform: platformSchema.nullish().transform(value => value ?? undefined),
    factId: z.string().nullish().transform(value => value ?? undefined),
    blockId: z.string().nullish().transform(value => value ?? undefined),
    target: z.enum(['title', 'intro', 'heading', 'body', 'cta', 'tags', 'images', 'references', 'structure', 'source']).nullish().transform(value => value ?? undefined),
  })).max(30),
});
