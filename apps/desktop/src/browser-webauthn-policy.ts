const MAX_REQUEST_TIMEOUT_MS = 120_000;

type CredentialOptions = CredentialCreationOptions | CredentialRequestOptions;
type CredentialMethod =
  | CredentialsContainer["create"]
  | CredentialsContainer["get"];

/** Compatibility for the browser session before native passkey UI is available. */
export function installWebAuthnCompatibility(): void {
  if (
    typeof PublicKeyCredential === "undefined" ||
    typeof CredentialsContainer === "undefined"
  ) {
    return;
  }
  const nativeCreate = CredentialsContainer.prototype.create;
  const nativeGet = CredentialsContainer.prototype.get;
  const platformAvailable =
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.bind(
      PublicKeyCredential,
    );

  function unavailable(): DOMException {
    return new DOMException(
      "This browser has no configured passkey authenticator or conditional account picker. Use another sign-in method.",
      "NotAllowedError",
    );
  }

  // WebIDL reads each dictionary member once. Cache policy inspection so native
  // conversion sees the same values, with getters called on their original object.
  function readOnce<T extends object>(source: T): T {
    const values = new Map<PropertyKey, unknown>();
    return new Proxy({} as T, {
      get(_target, key) {
        if (!values.has(key)) {
          let value: unknown = Reflect.get(source, key, source);
          if (
            (key === "publicKey" || key === "authenticatorSelection") &&
            value !== null &&
            (typeof value === "object" || typeof value === "function")
          ) {
            value = readOnce(value);
          }
          values.set(key, value);
        }
        return values.get(key);
      },
    });
  }

  function boundedRequest(
    receiver: CredentialsContainer,
    method: CredentialMethod,
    options: CredentialOptions,
  ): Promise<Credential | null> {
    return new Promise((resolve, reject) => {
      const hint = Number(options.publicKey?.timeout ?? MAX_REQUEST_TIMEOUT_MS);
      const timeout =
        Number.isFinite(hint) && hint >= 0
          ? Math.min(hint, MAX_REQUEST_TIMEOUT_MS)
          : MAX_REQUEST_TIMEOUT_MS;
      const controller = new AbortController();
      const signal = options.signal;
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      function finish(settle: () => void): void {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        settle();
      }
      function onAbort(): void {
        controller.abort(signal?.reason);
        finish(() => reject(signal?.reason));
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timer = setTimeout(() => {
        const error = new DOMException(
          "The WebAuthn request timed out.",
          "NotAllowedError",
        );
        controller.abort(error);
        finish(() => reject(error));
      }, timeout);
      // WebIDL reads properties, including inherited getters. Keep their original
      // receiver even for a frozen options object, while replacing only signal.
      const nativeOptions = new Proxy({} as CredentialOptions, {
        get(_target, key) {
          return key === "signal"
            ? controller.signal
            : Reflect.get(options, key, options);
        },
      });
      try {
        const result = Reflect.apply(method, receiver, [
          nativeOptions,
        ]) as Promise<Credential | null>;
        result.then(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error)),
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }

  function request(
    receiver: CredentialsContainer,
    method: CredentialMethod,
    originalOptions: CredentialOptions | undefined,
    creating: boolean,
  ): Promise<Credential | null> {
    if (
      originalOptions === null ||
      (typeof originalOptions !== "object" &&
        typeof originalOptions !== "function")
    ) {
      return Reflect.apply(method, receiver, [
        originalOptions,
      ]) as Promise<Credential | null>;
    }
    const options = readOnce(originalOptions);
    const publicKey = options.publicKey;
    if (
      publicKey === undefined ||
      publicKey === null ||
      (typeof publicKey !== "object" && typeof publicKey !== "function") ||
      options.signal?.aborted
    ) {
      return Reflect.apply(method, receiver, [
        options,
      ]) as Promise<Credential | null>;
    }
    if ((options as CredentialRequestOptions).mediation === "conditional") {
      return Promise.reject(unavailable());
    }
    if (
      creating &&
      (publicKey as PublicKeyCredentialCreationOptions).authenticatorSelection
        ?.authenticatorAttachment === "platform"
    ) {
      return platformAvailable().then((available) => {
        if (options.signal?.aborted) {
          return Reflect.apply(method, receiver, [
            options,
          ]) as Promise<Credential | null>;
        }
        if (!available) throw unavailable();
        return boundedRequest(receiver, method, options);
      });
    }
    return boundedRequest(receiver, method, options);
  }

  CredentialsContainer.prototype.create = function (options) {
    try {
      return request(this, nativeCreate, options, true);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  CredentialsContainer.prototype.get = function (options) {
    try {
      return request(this, nativeGet, options, false);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  // Electron advertises conditional mediation without a browser account picker.
  PublicKeyCredential.isConditionalMediationAvailable = () =>
    Promise.resolve(false);
  if (typeof PublicKeyCredential.getClientCapabilities === "function") {
    const nativeCapabilities =
      PublicKeyCredential.getClientCapabilities.bind(PublicKeyCredential);
    PublicKeyCredential.getClientCapabilities = () =>
      nativeCapabilities().then((capabilities) => ({
        ...capabilities,
        conditionalCreate: false,
        conditionalGet: false,
      }));
  }
}
