// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PatcherDesktopBrowserPagePromptDetails } from "@patcher/desktop-contract";
import { BrowserPagePrompt } from "./BrowserPagePrompt";

const AUTH: PatcherDesktopBrowserPagePromptDetails = {
  kind: "auth",
  id: "page-prompt-1",
  host: "example.com",
  insecure: false,
};

const CERTIFICATE: PatcherDesktopBrowserPagePromptDetails = {
  kind: "certificate",
  id: "page-prompt-2",
  host: "dev.example.com",
  errorCode: "net::ERR_CERT_AUTHORITY_INVALID",
  subjectName: "dev.example.com",
  issuerName: "Homemade CA",
  validFrom: 1_700_000_000,
  validTo: 1_800_000_000,
  fingerprint: "sha256/AAAA",
};

const CLIENT_CERTIFICATE: PatcherDesktopBrowserPagePromptDetails = {
  kind: "client-certificate",
  id: "page-prompt-3",
  host: "vpn.example.com",
  certificates: [
    {
      index: 0,
      subjectName: "ada@corp",
      issuerName: "Corp CA",
      validTo: 1_800_000_000,
    },
    {
      index: 1,
      subjectName: "ada@other",
      issuerName: "Corp CA",
      validTo: 1_800_000_000,
    },
  ],
};

function renderPrompt(prompt: PatcherDesktopBrowserPagePromptDetails) {
  const onRespond = vi.fn();
  render(<BrowserPagePrompt prompt={prompt} onRespond={onRespond} />);
  return { onRespond };
}

afterEach(cleanup);

describe("BrowserPagePrompt: authentication", () => {
  it("hands back what was typed", () => {
    const { onRespond } = renderPrompt(AUTH);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "ada" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onRespond).toHaveBeenCalledWith({
      kind: "credentials",
      username: "ada",
      password: "hunter2",
    });
  });

  // The host is the only part of a challenge a user can judge, so it is shown;
  // the server's realm string is deliberately not on the wire at all.
  it("names the host that is asking", () => {
    renderPrompt(AUTH);

    expect(screen.getByText("example.com")).toBeDefined();
  });

  it("warns when the password would travel in the clear", () => {
    renderPrompt({ ...AUTH, insecure: true });

    expect(screen.getByText(/not using a secure connection/i)).toBeDefined();
  });

  it("cancels on Escape", () => {
    const { onRespond } = renderPrompt(AUTH);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onRespond).toHaveBeenCalledWith({ kind: "cancel" });
  });
});

describe("BrowserPagePrompt: certificate", () => {
  it("offers going back as the plain answer", () => {
    const { onRespond } = renderPrompt(CERTIFICATE);

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(onRespond).toHaveBeenCalledWith({ kind: "cancel" });
  });

  // Proceeding sits behind the details that make it an informed decision, as it
  // does in every browser.
  it("keeps proceeding behind the details", () => {
    const { onRespond } = renderPrompt(CERTIFICATE);

    expect(screen.getByText("net::ERR_CERT_AUTHORITY_INVALID")).toBeDefined();
    expect(screen.getByText("Homemade CA")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: /proceed to dev.example.com/i })
        .closest("details"),
    ).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /proceed to dev.example.com/i }),
    );

    expect(onRespond).toHaveBeenCalledWith({ kind: "proceed" });
  });
});

describe("BrowserPagePrompt: client certificate", () => {
  it("sends back the certificate that was picked", () => {
    const { onRespond } = renderPrompt(CLIENT_CERTIFICATE);

    fireEvent.click(screen.getByText("ada@other"));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    expect(onRespond).toHaveBeenCalledWith({
      kind: "client-certificate",
      index: 1,
    });
  });

  it("declines without choosing one", () => {
    const { onRespond } = renderPrompt(CLIENT_CERTIFICATE);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onRespond).toHaveBeenCalledWith({ kind: "cancel" });
  });
});
