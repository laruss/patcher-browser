import type { BrowserCommandIssuer } from "@patcher/server-contract";

/**
 * What makes two browser commands the same caller.
 *
 * The kind and its id, never the label: a grant renamed mid-session is the same
 * agent, and two grants a person happened to give the same name are not. Used
 * by everything in this folder that has to hold one caller apart from another —
 * the indicator's "who is driving", and a tab's owner.
 */
export function browserIssuerKey(issuer: BrowserCommandIssuer): string {
  switch (issuer.kind) {
    case "thread":
      return `thread:${issuer.threadId}`;
    case "grant":
      return `grant:${issuer.grantId}`;
    case "outside":
      return "outside";
  }
}

/**
 * What a person is shown when this caller has to be named.
 *
 * A grant carries the label the person themselves typed, which is the whole
 * point of grants. A turn is named by what it is rather than by its thread id,
 * which would mean nothing on screen. And `outside` is deliberately not called
 * an agent: it is equally what a person running `patcher browser` in their own
 * terminal produces, and the install cannot tell the two apart.
 */
export function browserIssuerName(issuer: BrowserCommandIssuer): string {
  switch (issuer.kind) {
    case "grant":
      return issuer.label;
    case "thread":
      return "An agent in Patcher";
    case "outside":
      return "Something outside Patcher";
  }
}
