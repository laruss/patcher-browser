import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWebAuthnCompatibility } from "../src/browser-webauthn-policy.js";

describe("browser WebAuthn compatibility", () => {
  let credentials: CredentialsContainer;
  let nativeCreate: ReturnType<typeof vi.fn>;
  let nativeGet: ReturnType<typeof vi.fn>;
  let platformAvailable: ReturnType<typeof vi.fn>;
  let nativeCapabilities: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    nativeCreate = vi.fn(() => Promise.resolve(null));
    nativeGet = vi.fn(() => Promise.resolve(null));
    platformAvailable = vi.fn(() => Promise.resolve(false));
    nativeCapabilities = vi.fn(() =>
      Promise.resolve(
        Object.freeze({
          conditionalCreate: true,
          conditionalGet: true,
          hybridTransport: true,
          userVerifyingPlatformAuthenticator: false,
          "extension:prf": true,
        }),
      ),
    );
    class Container {}
    Object.assign(Container.prototype, {
      create: nativeCreate,
      get: nativeGet,
    });
    vi.stubGlobal("CredentialsContainer", Container);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: platformAvailable,
      isConditionalMediationAvailable: () => Promise.resolve(true),
      getClientCapabilities: nativeCapabilities,
    });
    credentials = Object.create(Container.prototype) as CredentialsContainer;
    installWebAuthnCompatibility();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects unavailable platform registration without opening a native request", async () => {
    await expect(
      credentials.create({
        publicKey: {
          authenticatorSelection: { authenticatorAttachment: "platform" },
        },
      } as unknown as CredentialCreationOptions),
    ).rejects.toHaveProperty("name", "NotAllowedError");
    expect(platformAvailable).toHaveBeenCalledOnce();
    expect(nativeCreate).not.toHaveBeenCalled();
  });

  it("reports no conditional picker and rejects conditional requests", async () => {
    expect(await PublicKeyCredential.isConditionalMediationAvailable()).toBe(
      false,
    );
    await expect(
      credentials.get({
        publicKey: { challenge: new Uint8Array(32) },
        mediation: "conditional",
      }),
    ).rejects.toHaveProperty("name", "NotAllowedError");
    await expect(
      credentials.create({
        publicKey: { challenge: new Uint8Array(32) },
        mediation: "conditional",
      } as unknown as CredentialCreationOptions),
    ).rejects.toHaveProperty("name", "NotAllowedError");
    expect(nativeCreate).not.toHaveBeenCalled();
    expect(nativeGet).not.toHaveBeenCalled();
  });

  it("delegates non-public-key requests unchanged", async () => {
    const options = { mediation: "optional" } as CredentialRequestOptions;
    const result = Promise.resolve(null);
    nativeGet.mockReturnValue(result);
    expect(credentials.get(options)).toBe(result);
    expect(nativeGet.mock.calls[0]![0].mediation).toBe(options.mediation);
    expect(nativeGet.mock.instances[0]).toBe(credentials);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports conditional capabilities consistently and preserves other native flags", async () => {
    const reported = await PublicKeyCredential.getClientCapabilities();
    const native = await nativeCapabilities.mock.results[0]!.value;
    expect(reported).toEqual({
      ...native,
      conditionalCreate: false,
      conditionalGet: false,
    });
    expect(native.conditionalCreate).toBe(true);
    expect(native.conditionalGet).toBe(true);
  });

  it("preserves a native success, inherited options and the caller's signal", async () => {
    const controller = new AbortController();
    const options = Object.create({
      publicKey: { challenge: new Uint8Array(32), timeout: 100 },
      mediation: "required",
    }) as CredentialRequestOptions;
    options.signal = controller.signal;
    const result = {
      id: "security-key-result",
      type: "public-key",
    } as Credential;
    nativeGet.mockResolvedValue(result);

    expect(await credentials.get(options)).toBe(result);
    const nativeOptions = nativeGet.mock
      .calls[0]![0] as CredentialRequestOptions;
    expect(nativeOptions.publicKey!.challenge).toBe(
      options.publicKey!.challenge,
    );
    expect(nativeOptions.mediation).toBe("required");
    expect(nativeOptions.signal).not.toBe(controller.signal);
    expect(options.signal).toBe(controller.signal);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(nativeOptions.signal!.aborted).toBe(false);
  });

  it("preserves getters on frozen options dictionaries", async () => {
    const controller = new AbortController();
    class Request {
      #publicKey = { challenge: new Uint8Array(32) };
      signal = controller.signal;
      get publicKey() {
        return this.#publicKey;
      }
    }
    const options = Object.freeze(new Request());
    nativeGet.mockImplementation((nativeOptions: CredentialRequestOptions) => {
      expect(nativeOptions.publicKey!.challenge).toBe(
        options.publicKey.challenge,
      );
      expect(nativeOptions.signal).not.toBe(options.signal);
      return Promise.resolve(null);
    });
    await expect(credentials.get(options)).resolves.toBeNull();
    expect(options.signal).toBe(controller.signal);
  });

  it("reads inspected dictionary getters once before native conversion", async () => {
    const controller = new AbortController();
    const challenge = new Uint8Array(32);
    const attachment = vi.fn(() => "cross-platform");
    const selection = vi.fn(() =>
      Object.freeze({
        get authenticatorAttachment() {
          return attachment();
        },
      }),
    );
    const timeout = vi.fn(() => 25);
    const publicKey = vi.fn(() =>
      Object.freeze({
        challenge,
        get timeout() {
          return timeout();
        },
        get authenticatorSelection() {
          return selection();
        },
      }),
    );
    const signal = vi.fn(() => controller.signal);
    const mediation = vi.fn(() => "required");
    const options = Object.freeze({
      get publicKey() {
        return publicKey();
      },
      get signal() {
        return signal();
      },
      get mediation() {
        return mediation();
      },
    });
    nativeCreate.mockImplementation(
      (nativeOptions: CredentialCreationOptions) => {
        expect(nativeOptions.publicKey!.challenge).toBe(challenge);
        expect(nativeOptions.publicKey!.timeout).toBe(25);
        expect(
          nativeOptions.publicKey!.authenticatorSelection!
            .authenticatorAttachment,
        ).toBe("cross-platform");
        expect(nativeOptions.signal).toBeInstanceOf(AbortSignal);
        expect((nativeOptions as CredentialRequestOptions).mediation).toBe(
          "required",
        );
        return Promise.resolve(null);
      },
    );
    await expect(
      credentials.create(options as unknown as CredentialCreationOptions),
    ).resolves.toBeNull();
    for (const getter of [
      publicKey,
      signal,
      mediation,
      selection,
      attachment,
      timeout,
    ]) {
      expect(getter).toHaveBeenCalledOnce();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns rejected Promises for caller getters that throw", async () => {
    const error = new Error("dictionary getter failed");
    for (const method of ["create", "get"] as const) {
      for (const key of ["publicKey", "signal", "mediation"]) {
        const options = { publicKey: { challenge: new Uint8Array(32) } };
        Object.defineProperty(options, key, {
          get() {
            throw error;
          },
        });
        const caught = credentials[method](
          options as unknown as CredentialCreationOptions,
        ).catch((reason) => reason);
        await expect(caught).resolves.toBe(error);
      }
    }
    expect(nativeCreate).not.toHaveBeenCalled();
    expect(nativeGet).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delegates null publicKey validation to the native rejected Promise", async () => {
    const error = new TypeError("invalid publicKey dictionary");
    const result = Promise.reject(error);
    nativeCreate.mockReturnValue(result);
    expect(
      credentials.create({
        publicKey: null,
      } as unknown as CredentialCreationOptions),
    ).toBe(result);
    await expect(result).rejects.toBe(error);
    expect(nativeCreate.mock.calls[0]![0].publicKey).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts the underlying request on timeout and permits the next request", async () => {
    nativeGet.mockImplementation(
      (options: CredentialRequestOptions) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => reject(options.signal!.reason),
            { once: true },
          );
        }),
    );
    const result = credentials.get({
      publicKey: { challenge: new Uint8Array(32), timeout: 25 },
    });
    const rejected = expect(result).rejects.toHaveProperty(
      "name",
      "NotAllowedError",
    );
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    const nativeOptions = nativeGet.mock
      .calls[0]![0] as CredentialRequestOptions;
    expect(nativeOptions.signal!.aborted).toBe(true);
    expect(nativeOptions.signal!.reason.name).toBe("NotAllowedError");

    nativeGet.mockResolvedValue(null);
    await expect(
      credentials.get({ publicKey: { challenge: new Uint8Array(32) } }),
    ).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds missing or excessively long timeouts", async () => {
    nativeGet.mockReturnValue(new Promise(() => {}));
    const pending = [undefined, 1_000_000].map((timeout) =>
      credentials.get({
        publicKey: {
          challenge: new Uint8Array(32),
          ...(timeout === undefined ? {} : { timeout }),
        },
      }),
    );
    const rejected = pending.map((result) =>
      expect(result).rejects.toHaveProperty("name", "NotAllowedError"),
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.all(rejected);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller cancellation and cancels the native ceremony", async () => {
    const controller = new AbortController();
    nativeGet.mockReturnValue(new Promise(() => {}));
    const result = credentials.get({
      publicKey: { challenge: new Uint8Array(32) },
      signal: controller.signal,
    });
    const reason = new DOMException("Caller cancelled", "AbortError");
    const rejected = expect(result).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    const nativeOptions = nativeGet.mock
      .calls[0]![0] as CredentialRequestOptions;
    expect(nativeOptions.signal!.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delegates a pre-aborted signal to native semantics", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled before request");
    controller.abort(reason);
    nativeGet.mockRejectedValue(reason);
    const options = {
      publicKey: { challenge: new Uint8Array(32) },
      signal: controller.signal,
    };
    await expect(credentials.get(options)).rejects.toBe(reason);
    expect(nativeGet.mock.calls[0]![0].signal).toBe(controller.signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves native errors and cleans up deadlines", async () => {
    const error = new DOMException("Invalid origin", "SecurityError");
    nativeGet.mockRejectedValue(error);
    await expect(
      credentials.get({ publicKey: { challenge: new Uint8Array(32) } }),
    ).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a native rejection with undefined as its reason", async () => {
    nativeGet.mockRejectedValue(undefined);
    await expect(
      credentials.get({ publicKey: { challenge: new Uint8Array(32) } }),
    ).rejects.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows a platform authenticator when native availability is confirmed", async () => {
    platformAvailable.mockResolvedValue(true);
    await expect(
      credentials.create({
        publicKey: {
          authenticatorSelection: { authenticatorAttachment: "platform" },
        },
      } as unknown as CredentialCreationOptions),
    ).resolves.toBeNull();
    expect(nativeCreate).toHaveBeenCalledOnce();
  });

  it("leaves contexts without WebAuthn untouched", () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    installWebAuthnCompatibility();
    expect(vi.getTimerCount()).toBe(0);
  });
});
