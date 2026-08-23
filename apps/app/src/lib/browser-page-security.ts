import { getBrowserUrlHost, getBrowserUrlSecurity } from "./browser-url";

/**
 * What the browser can honestly say about the page's connection, and the
 * padlock's only source.
 *
 * The padlock used to be derived from the scheme in the address bar and nothing
 * else, which made it a decoration that lied in two directions: it promised a
 * secure connection for a page riding a certificate the user had waved through
 * by hand, and it warned about loopback pages that never touch a network — Patcher's
 * own pages among them.
 *
 * What is *not* here, deliberately: mixed content, cipher age, revocation. Those
 * live behind Chromium's DevTools protocol, and a tab may have only one protocol
 * client — a padlock that needed it would go blank whenever the developer panel
 * was open. The popover says as much rather than implying the check happened.
 */
export type BrowserPageSecurityKind =
  /** https, and nothing known against it. */
  | "encrypted"
  /** https over a certificate a human accepted after Chromium refused it. */
  | "certificate-untrusted"
  /** Plain http to another machine. */
  | "plain"
  /** Plain http that never leaves this machine — loopback. */
  | "local"
  /** No page, or an address the browser does not describe (`about:`, `file:`). */
  | "none";

export interface BrowserPageSecurity {
  kind: BrowserPageSecurityKind;
  /** `example.com`, or `example.com:8443`; empty when there is no page. */
  host: string;
}

export interface ResolveBrowserPageSecurityArgs {
  url: string;
  /**
   * As the shell reports it (`onPageSecurity`). A renderer with an older shell
   * never hears about it and passes false, which is what every build assumed
   * before — the padlock is then as honest as the URL allows, and no less.
   */
  certificateTrustedByUser: boolean;
}

export function resolveBrowserPageSecurity({
  certificateTrustedByUser,
  url,
}: ResolveBrowserPageSecurityArgs): BrowserPageSecurity {
  const host = getBrowserUrlHost(url);
  switch (getBrowserUrlSecurity(url)) {
    case "secure": {
      return {
        kind: certificateTrustedByUser ? "certificate-untrusted" : "encrypted",
        host,
      };
    }
    case "insecure": {
      return { kind: "plain", host };
    }
    case "local": {
      return { kind: "local", host };
    }
    case "none": {
      return { kind: "none", host: "" };
    }
  }
}

export interface BrowserPageSecurityCopy {
  /** One line naming the state, as the popover's heading. */
  title: string;
  /** What it means for the person reading it, in their terms. */
  detail: string;
  /** The padlock's accessible name; null when the glyph carries no claim. */
  label: string | null;
}

/**
 * The wording lives here rather than in the component so the claim and the glyph
 * cannot drift apart, and so a test can hold the browser to what it says.
 */
export function describeBrowserPageSecurity(
  security: BrowserPageSecurity,
): BrowserPageSecurityCopy {
  switch (security.kind) {
    case "encrypted": {
      return {
        title: "Connection is encrypted",
        detail:
          "What you send to this site and what it sends back cannot be read by others on this network.",
        label: "Connection is encrypted",
      };
    }
    case "certificate-untrusted": {
      return {
        title: "Certificate is not trusted",
        detail:
          "The connection is encrypted, but nobody vouched for who is on the other end — you chose to continue past the warning for this site. Anything you type here could be going to someone else.",
        label: "Certificate is not trusted",
      };
    }
    case "plain": {
      return {
        title: "Connection is not secure",
        detail:
          "This page travels in the clear. Anyone on this network can read it and change it before it reaches you, so do not enter anything private.",
        label: "Connection is not secure",
      };
    }
    case "local": {
      return {
        title: "Page from this machine",
        detail:
          "This address never leaves your computer, so there is no connection for anyone to listen to.",
        label: "Page from this machine",
      };
    }
    case "none": {
      return {
        title: "Nothing to describe",
        detail: "There is no page open in this tab.",
        label: null,
      };
    }
  }
}
