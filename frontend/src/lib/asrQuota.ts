/** iFlytek WS/HTTP daily quota failure, kept distinct from network errors. */
export const ASR_QUOTA_CODE = 11201;
export const ASR_QUOTA_MESSAGE = "今日语音识别额度已用完，可以改用打字继续。";
const QUOTA_COOLDOWN_MS = 5 * 60_000;
let quotaUntil = 0;

export class AsrProviderError extends Error {
  constructor(readonly providerCode: number, readonly providerMessage = "") {
    super(`ASR provider error ${providerCode}`);
    this.name = "AsrProviderError";
  }
}

export class AsrQuotaError extends Error {
  partialText?: string;
  constructor(readonly providerCode = ASR_QUOTA_CODE, readonly detail = "") {
    super(ASR_QUOTA_MESSAGE);
    this.name = "AsrQuotaError";
  }
}

export function markAsrQuota(detail = "") {
  quotaUntil = Date.now() + QUOTA_COOLDOWN_MS;
  return new AsrQuotaError(ASR_QUOTA_CODE, detail);
}

export function isAsrQuotaCooling() {
  return Date.now() < quotaUntil;
}

export function resetAsrQuotaForTest() {
  quotaUntil = 0;
}

export function isAsrQuotaError(error: unknown): error is AsrQuotaError {
  return error instanceof AsrQuotaError || (!!error && typeof error === "object" && (error as { name?: string }).name === "AsrQuotaError");
}

export function quotaErrorFromDetail(detail: string) {
  return markAsrQuota(detail);
}

export function asrProviderError(code: number, message = "") {
  return code === ASR_QUOTA_CODE ? markAsrQuota(message) : new AsrProviderError(code, message);
}
