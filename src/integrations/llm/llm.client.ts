import type {
  LlmObjectRequest,
  LlmObjectResult,
  LlmTextRequest,
  LlmTextResult,
} from './llm.schemas';

export const LLM_CLIENT = Symbol('LLM_CLIENT');

export type LlmLogger = {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
};

export interface LlmClient {
  generateText(request: LlmTextRequest): Promise<LlmTextResult>;
  generateObject<T>(request: LlmObjectRequest<T>): Promise<LlmObjectResult<T>>;
}
