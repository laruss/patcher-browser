// Shell-internal channels: never exposed through the page or plugin bridge.
export const SECURE_KEYBOARD_DOCUMENT_CHANNEL =
  "patcher-desktop:secure-keyboard:document";
export const SECURE_KEYBOARD_FOCUS_CHANNEL =
  "patcher-desktop:secure-keyboard:focus";

export interface SecureKeyboardFocusReport {
  documentId: string;
  protect: boolean;
}
