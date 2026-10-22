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
export interface RunDetail { result: RunResult; outlineSnapshot?: OutlineResult; history: HistoryMetadata; renderBundles: RenderBundle[] }
export interface TaskOptions {
  operatorRole: 'salesperson'; operatorLabel: string;
  scenarios: { id: string; label: string; audienceSuggestions: string[]; focusSuggestions: string[] }[];
  goals: string[]; buyingStages: string[];
  platforms: { id: Platform; label: string; minImages: number; maxImages: number }[];
}
export interface RenderTemplate { id: string; platform: Platform; name: string; width: number; height: number }
export interface RenderRequest { runId: string; revision: number; platform: Platform; selectedTitleIndex: number; templateId: string }
export interface RenderArtifact {
  id: string; role: 'article' | 'cover' | 'card' | 'poster'; format: 'wechat-richtext' | 'png';
  previewUrl: string; downloadUrl?: string; width?: number; height?: number;
  sourceImageIds: string[]; factIds: string[]; name: string;
}
export interface RenderBundle {
  id: string; runId: string; revision: number; selectedTitleIndex: number; platform: Platform;
  templateId: string; artifacts: RenderArtifact[]; reviewStatus: ReviewReport['status'];
  warnings: string[]; copyText: string; zipUrl?: string; expiresAt: string;
}
export interface AppStatus {
  model: { configured: boolean; name: string; baseUrl: string };
  ima: { configured: boolean; verified: boolean; kbName: string; accountLabel: string; message: string; verifiedAt?: string };
  local: { available: boolean; productCount: number; imageCount: number };
}
export interface StreamEvent {
  type: 'progress' | 'result' | 'error' | 'needs_input';
  entry?: TraceEntry; result?: RunResult; message?: string;
  fields?: { field: string; question: string }[];
}
