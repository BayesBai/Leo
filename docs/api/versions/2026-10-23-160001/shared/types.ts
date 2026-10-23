import type { PosterApproval } from './poster';
import type { VideoScript, VideoScriptReview } from './video';
export type { PosterApproval, PosterApprovalInput } from './poster';
export type { VideoScript, VideoScriptReview } from './video';

export const PLATFORMS = ['xiaohongshu', 'wechat', 'moments', 'poster'] as const;
export type Platform = typeof PLATFORMS[number];
export type KnowledgeSource = 'local' | 'ima';
export type EngineMode = 'demo' | 'live';
export interface Brief {
  productId: string;
  audience: string;
  scene: string;
  goal: string;
  buyingStage: string;
  platforms: Platform[];
  instructions: string;
  mode: EngineMode;
  knowledgeSource: KnowledgeSource;
}
export interface Product {
  id: string; name: string; system: string; category: string;
  description: string; imageCount: number; coverUrl?: string;
}
export interface SourceDocument {
  id: string; title: string; text?: string; url?: string;
  retrievedAt: string; sourceMode: KnowledgeSource;
}
export interface Fact {
  id: string; statement: string; quote: string; sourceTitle: string;
  sourceUrl?: string; retrievedAt: string; qualifiers: string[];
  sourceMode: KnowledgeSource; status: 'supported' | 'unverified';
}
export interface ImageAsset {
  id: string; name: string; url: string; productId: string;
  description: string; sourceTitle: string; sourceUrl?: string;
  width: number; height: number; sourceMode: KnowledgeSource;
}
export interface EvidenceBundle {
  product: Product; facts: Fact[]; images: ImageAsset[];
  sources: SourceDocument[]; retrievedAt: string;
  sourceMode: KnowledgeSource; warnings: string[];
}
export interface Strategy {
  platform: Platform; angle: string; painPoint: string;
  sellingPoints: { factId: string; benefit: string }[];
  tone: string; structure: string[]; imageCount: number;
  cta: string; buyingStage: string;
}
export interface ContentBlock {
  id: string; heading: string; text: string; factIds: string[];
}
export interface ImagePlacement {
  imageId: string; afterBlock: number; caption: string; reason: string;
}
export interface Draft {
  id: string; platform: Platform; titles: string[]; intro: string;
  blocks: ContentBlock[]; cta: string; tags: string[];
  images: ImagePlacement[];
}
export interface ReviewIssue {
  id: string; severity: 'error' | 'warning' | 'info';
  category: 'fact' | 'image' | 'compliance' | 'platform' | 'source';
  message: string; suggestion: string; platform?: Platform;
  factId?: string; blockId?: string;
  target?: 'title' | 'intro' | 'heading' | 'body' | 'cta' | 'tags' | 'images' | 'references' | 'structure' | 'source';
  resolution?: 'auto_text' | 'edit_outline' | 'refresh_evidence' | 'manual_review';
}
export interface ReviewReport {
  status: 'passed' | 'needs_attention' | 'blocked';
  issues: ReviewIssue[]; factCount: number; citedFactCount: number;
  imageCount: number; checks: { label: string; status: 'pass' | 'warning' | 'fail'; detail: string }[];
  reviewedBy: 'rules' | 'rules+model';
}
export interface TraceEntry {
  step: string; label: string; status: 'running' | 'done' | 'error';
  detail: string; at: string; elapsedMs?: number;
}
export interface RunResult {
  id: string; createdAt: string; brief: Brief; product: Product;
  evidence: EvidenceBundle; strategies: Strategy[]; drafts: Draft[];
  review: ReviewReport; trace: TraceEntry[]; revision: number;
  notice: string;
  outline?: { id: string; version: number };
}
export interface OutlineSection { id: string; heading: string; points: string[]; factIds: string[] }
export interface PlatformOutline {
  platform: Platform; title: string; angle: string; intro: string;
  sections: OutlineSection[]; imageIds: string[]; cta: string;
}
export interface OutlineResult {
  id: string; version: number; status: 'editing' | 'confirmed'; createdAt: string;
  confirmedAt?: string; brief: Brief; product: Product; evidence: EvidenceBundle;
  platforms: PlatformOutline[]; warnings: string[];
  history?: HistoryMetadata;
}
export interface HistoryMetadata { expiresAt: string; evidenceStatus: 'ready' | 'refresh_required'; interrupted?: boolean }
export interface HistoryItem extends HistoryMetadata {
  kind: 'outline' | 'run'; id: string; productName: string; audience: string; scene: string;
  platforms: Platform[]; createdAt: string; updatedAt: string; version?: number; revision?: number;
  reviewStatus?: ReviewReport['status'];
}
export interface RunDetail { result: RunResult; outlineSnapshot?: OutlineResult; history: HistoryMetadata; renderBundles: RenderBundle[]; deliveries?: ChannelDelivery[] }
export interface TaskOptions {
  operatorRole: 'salesperson'; operatorLabel: string;
  scenarios: { id: string; label: string; audienceSuggestions: string[]; focusSuggestions: string[] }[];
  goals: string[]; buyingStages: string[];
  platforms: { id: Platform; label: string; minImages: number; maxImages: number }[];
}
export interface RenderTemplate { id: string; platform: Platform; name: string; width: number; height: number }
export interface RenderRequest { runId: string; revision: number; platform: Platform; selectedTitleIndex: number; templateId: string; deliveryId?: string; visualMode?: 'local' | 'canva' | 'html' | 'poster-image'; canvaSync?: boolean; regenerateVisual?: boolean }
export interface RenderArtifact {
  id: string; role: 'article' | 'cover' | 'card' | 'poster' | 'video'; format: 'wechat-richtext' | 'png' | 'original' | 'mp4';
  previewUrl: string; downloadUrl?: string; width?: number; height?: number;
  sourceImageIds: string[]; factIds: string[]; name: string; durationSeconds?: number; fps?: number; frameCount?: number;
}
export interface RenderBundle {
  id: string; runId: string; revision: number; selectedTitleIndex: number; platform: Platform;
  templateId: string; artifacts: RenderArtifact[]; reviewStatus: ReviewReport['status'];
  warnings: string[]; copyText: string; zipUrl?: string; expiresAt: string;
  publication?: 'preview' | 'released' | 'blocked';
  rendererVersion?: number; deliveryId?: string; externalDesigns?: ExternalDesign[]; creativeAssets?: CreativeAsset[];
  kind?: 'static' | 'video';
  sourceFingerprint?: string;
  posterApproval?: PosterApproval;
}

/** Partial channels are independent deliveries, never partial RunResult objects. */
export interface ChannelDelivery {
  id: string; runId: string; jobId?: string; platform: Platform; revision: number;
  createdAt: string; updatedAt: string; expiresAt: string; product: Product;
  brief: Brief; draft: Draft; review: ReviewReport; outline: { id: string; version: number };
  status: 'ready' | 'blocked' | 'visual_pending'; copyText: string; bundle?: RenderBundle;
  evidenceStatus: HistoryMetadata['evidenceStatus']; externalDesigns?: ExternalDesign[]; videoBundle?: RenderBundle;
  posterApproval?: PosterApproval;
}
export interface ExternalDesign {
  id: string; editUrl: string; platform: Platform; status: 'imported' | 'verified' | 'exported' | 'changed';
  contentHash?: string; syncedAt?: string; expiresAt?: string;
}
export interface CreativeAsset {
  id: string; kind: 'generated-visual'; platform: Platform; model: string; provider: string;
  promptHash: string; skillVersion: string; sourceImageIds: string[]; sha256: string;
  createdAt: string; expiresAt: string;
}
export interface CanvaConnectionStatus { configured: boolean; connected: boolean; message: string; redirectUri?: string }
/** Safe diagnostics for a failed read-only Canva connection preflight. */
export interface CanvaVerificationError {
  message: string; code: string; diagnosticId: string; phase?: string;
  upstreamStatus?: number; providerCode?: string; requestId?: string; retryable: boolean; outcomeUnknown: boolean;
}

export type JobStatus = 'queued' | 'running' | 'failed' | 'interrupted' | 'cancelled' | 'completed';
export type JobStage = 'retrieve' | 'outline' | 'write' | 'review' | 'repair' | 'recheck' | 'design' | 'image' | 'compose' | 'canva_import' | 'canva_edit' | 'canva_export' | 'render' | 'publish' | 'storyboard' | 'video_script' | 'video_review' | 'video_repair' | 'video_recheck' | 'video_render' | 'video_encode';
export interface JobError {
  message: string; code: string; stage: JobStage; platform?: Platform;
  upstreamStatus?: number; retryable: boolean; outcomeUnknown: boolean;
  category?: string; providerCode?: string; providerType?: string; providerMessage?: string; requestId?: string; diagnosticId?: string;
}
export interface ModelCallRecord {
  id: string; stage: string; platform?: Platform; attempt: number;
  queuedAt: string; startedAt?: string; endedAt?: string; queueMs?: number;
  firstResponseMs?: number; firstContentMs?: number; maxIdleMs?: number; totalMs?: number;
  upstreamStatus?: number; requestId?: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; generatedImages?: number };
  outcome: 'dispatched' | 'succeeded' | 'failed' | 'unknown'; code?: string;
}
export type JobInput =
  | { kind: 'outline'; brief: Brief }
  | { kind: 'outline-revise'; outlineId: string; version: number; instructions: string; platforms?: Platform[] }
  | { kind: 'generate'; outlineId: string; version: number; renders?: { platform: Platform; templateId: string; selectedTitleIndex: number }[] }
  | { kind: 'render'; request: RenderRequest }
  | { kind: 'video'; deliveryId: string };
export type JobSubmit = JobInput & { idempotencyKey: string };
export interface JobChannel {
  platform: Platform; status: JobStatus; stage: JobStage; error?: JobError;
  preview?: { draft: Draft; review: ReviewReport; bundle?: RenderBundle };
  deliveryId?: string; delivery?: ChannelDelivery; progress?: { completedFrames: number; totalFrames: number };
  videoScript?: VideoScript; videoScriptReview?: VideoScriptReview;
}
export interface BackgroundJob {
  id: string; idempotencyKey: string; kind: JobInput['kind']; status: JobStatus;
  createdAt: string; updatedAt: string; expiresAt: string;
  deliveryVersion?: 1; input: JobInput; model: { name: string; baseUrl: string };
  channels: JobChannel[]; calls: ModelCallRecord[]; error?: JobError;
  outline?: OutlineResult; result?: RunResult; renderBundles: RenderBundle[]; videoBundle?: RenderBundle;
  videoScript?: VideoScript; videoScriptReview?: VideoScriptReview;
  /** List/event summaries omit bulky terminal/queued outputs; GET by id always returns full detail. */
  detailOmitted?: boolean; summary?: { productName: string; scene: string; audience: string };
}
export interface JobEvent { type: 'snapshot'; jobs: BackgroundJob[] }
export interface AppStatus {
  model: { configured: boolean; name: string; baseUrl: string };
  ima: { configured: boolean; verified: boolean; kbName: string; accountLabel: string; message: string; verifiedAt?: string };
  local: { available: boolean; productCount: number; imageCount: number };
  image?: { configured: boolean; name: string; baseUrl: string };
  canva?: CanvaConnectionStatus;
}
export interface StreamEvent {
  type: 'progress' | 'result' | 'error' | 'needs_input';
  entry?: TraceEntry; result?: RunResult; message?: string;
  fields?: { field: string; question: string }[];
}
