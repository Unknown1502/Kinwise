export {
  ALEXA_PLUS_SCOPES,
  ALL_ALEXA_PLUS_SCOPES,
  jsonRpcMethods,
  missingScope,
  normalizeScopes,
  requiredScope,
} from './scopes.js';
export {
  isProtectedResourceMetadataPath,
  protectedResourceMetadata,
  protectedResourceMetadataResponse,
  type ProtectedResourceOptions,
} from './prm.js';
export {
  TokenError,
  guardMcpRequest,
  resourceMetadataUrl,
  withAlexaPlusAuth,
  type GuardAuthInfo,
  type GuardOptions,
  type GuardOutcome,
  type McpFetch,
  type TokenVerifier,
  type VerifiedToken,
} from './guard.js';
export { parseRpcResponse, runConformance, summarize, type CheckResult, type CheckStatus, type ConformanceOptions } from './conformance.js';
