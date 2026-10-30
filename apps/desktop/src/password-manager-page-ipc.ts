export const PASSWORD_PAGE_SESSION =
  "patcher-desktop:password-manager:session:v1";
export const PASSWORD_PAGE_CAPTURE =
  "patcher-desktop:password-manager:capture:v1";
export const PASSWORD_PAGE_CHANNEL = "patcher-desktop:password-manager:page:v1";
export const PASSWORD_PAGE_CHANGED =
  "patcher-desktop:password-manager:page-changed:v1";
export interface PageAccount {
  id: string;
  version: number;
  username: string;
  preferred?: boolean;
}
export interface PasswordPageApi {
  accounts(hasPasswordForm: boolean): Promise<PageAccount[]>;
  fill(
    account: PageAccount,
    fieldToken: string,
  ): Promise<{ username: string; password: string } | null>;
  capture(value: {
    username: string;
    password: string;
    submitted: boolean;
  }): void;
  username(value: string): void;
  success(): void;
  failure(): void;
}
