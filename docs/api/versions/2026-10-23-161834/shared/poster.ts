export interface PosterChecks { text: boolean; product: boolean; facts: boolean }
export interface PosterApprovalInput {
  bundleId: string;
  artifactId: string;
  sha256: string;
  checks: PosterChecks;
}
/** The artifact pointer always names the original image the person inspected. */
export interface PosterApproval {
  status: 'pending' | 'approved';
  bundleId: string;
  artifactId: string;
  sha256: string;
  contentFingerprint: string;
  createdAt: string;
  expiresAt: string;
  approvedAt?: string;
  checks?: PosterChecks;
  requiredCopy: string[];
  factChecks: { factId: string; statement: string; qualifiers: string[]; sourceTitle: string }[];
  referenceImages: { id: string; name: string; url: string }[];
  notice: string;
}
