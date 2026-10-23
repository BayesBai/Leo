/** Independent short-form copy. A video review never changes the source article. */
export interface VideoScriptCondition {
  factId: string;
  qualifierIndex: number;
  mode: 'display' | 'scope';
  /** Exact original qualifier; display conditions are composited onto the scene. */
  text: string;
  reason?: string;
}
export interface VideoScriptScene {
  id: string;
  heading: string;
  text: string;
  kind: 'fact' | 'action';
  factIds: string[];
  conditions: VideoScriptCondition[];
}
export interface VideoScript {
  version: 'video-script-v2';
  title: string;
  cta: string;
  scenes: VideoScriptScene[];
  sourceFingerprint: string;
}
export interface VideoScriptReview {
  status: 'passed' | 'blocked';
  issues: Array<{ id: string; severity: 'error' | 'warning'; message: string; suggestion: string; sceneId?: string; factId?: string }>;
  reviewedBy: 'rules' | 'rules+model';
  checkedAt: string;
}
