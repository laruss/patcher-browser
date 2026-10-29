export {
  credentialPendingSchema,
  credentialResultSchema,
  type CredentialPending,
  type CredentialResult,
} from "@patcher/domain/protected-credentials";
export const CREDENTIAL_CHANNELS = {
  pending: "patcher-desktop:credentials:pending",
  changed: "patcher-desktop:credentials:changed",
  review: "patcher-desktop:credentials:review",
  dismiss: "patcher-desktop:credentials:dismiss",
} as const;
export interface ProtectedCredentialBrowserApi {
  getCredentialRequests?(): Promise<
    import("@patcher/domain/protected-credentials").CredentialPending[]
  >;
  onCredentialRequestsChanged?(listener: () => void): () => void;
  reviewCredentialRequest?(
    id: string,
  ): Promise<import("@patcher/domain/protected-credentials").CredentialResult>;
  dismissCredentialRequest?(id: string): Promise<boolean>;
}
