import type { JobInput, RenderRequest } from '../../shared/types.js';
import { WorkflowError } from '../outlines.js';

export const EXTERNAL_DESIGN_PAUSED_MESSAGE = '旧外部设计流程已搁置，请使用当前制作流程重新生成。';
export function externalDesignPaused() {
  return Object.assign(new WorkflowError(410, EXTERNAL_DESIGN_PAUSED_MESSAGE), {
    code:'EXTERNAL_DESIGN_PAUSED',retryable:false,outcomeUnknown:false,
  });
}
export function isExternalDesignRequest(request:RenderRequest) { return request.visualMode==='canva'||request.canvaSync===true; }
export function assertCurrentRenderRequest(request:RenderRequest) { if(isExternalDesignRequest(request))throw externalDesignPaused(); }
export function isExternalDesignJob(input:JobInput) { return input.kind==='render'&&isExternalDesignRequest(input.request); }
