import { snapshotImageConfig, type ImageConfigSnapshot } from './image-provider.js';
import { digest, type StoredJob } from './job-store.js';
import { WorkflowError } from './outlines.js';

/** Persist only this digest. The credential snapshot remains in backend memory. */
export const imageConfigurationHash = (config: ImageConfigSnapshot = snapshotImageConfig()) =>
  digest({ baseUrl: config.baseUrl, model: config.name, credential: config.apiKey || '' });
/** Successful pixels can be reused with another key for the same provider/model. */
export const imageProviderFingerprint = (config: ImageConfigSnapshot = snapshotImageConfig()) =>
  digest({ baseUrl: config.baseUrl, model: config.name });

/** Called after acquiring the image semaphore, immediately before paid dispatch. */
export function assertImageConfiguration(record: StoredJob, config: ImageConfigSnapshot) {
  if (!record.imageConfigHash) throw Object.assign(new WorkflowError(409,
    '此旧任务没有提交时的生图配置绑定，未自动派发生图。已成功正文和素材保留；请确认当前配置后创建新视觉任务。'),
    { code: 'IMAGE_CONFIG_UNBOUND', retryable: false });
  if (record.imageConfigHash !== imageConfigurationHash(config) || record.imageConfigHash !== imageConfigurationHash())
    throw Object.assign(new WorkflowError(409,
      '任务提交后的生图配置或凭证已变化，未派发新请求。已完成文字和素材保留；请恢复原配置或创建新视觉任务。'),
      { code: 'IMAGE_CONFIG_CHANGED', retryable: false });
}
