/**
 * A plugin whose two surfaces are the ones that could not cross until now: an
 * HTTP route and a background service.
 */
export default function plugin(patcher: {
  log: { info(m: string): void };
  http: {
    route(
      method: string,
      path: string,
      handler: (c: {
        req: {
          query(k: string): string | undefined;
          json(): Promise<unknown>;
          header(n: string): string | undefined;
        };
      }) => Promise<Response> | Response,
    ): void;
  };
  background: {
    service(
      name: string,
      service: { start(signal: AbortSignal): Promise<void> },
    ): void;
  };
}): void {
  patcher.http.route("GET", "/echo", (c) =>
    Response.json({
      who: c.req.query("who") ?? null,
      via: c.req.header("x-probe") ?? null,
    }),
  );

  patcher.http.route("POST", "/upper", async (c) => {
    const body = (await c.req.json()) as { text?: string };
    return new Response((body.text ?? "").toUpperCase(), {
      status: 201,
      headers: { "content-type": "text/plain; charset=utf-8", "x-a": "1" },
    });
  });

  patcher.http.route("GET", "/boom", () => {
    throw new Error("route exploded");
  });

  patcher.background.service("ticker", {
    start: (signal) =>
      new Promise<void>((resolve) => {
        patcher.log.info("ticker started");
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => {
          patcher.log.info("ticker stopping");
          resolve();
        });
      }),
  });

  patcher.background.service("faulty", {
    start: async () => {
      throw new Error("nothing to do");
    },
  });

  patcher.background.service("unconfigured", {
    start: async () => {
      throw Object.assign(new Error("set an API key"), {
        name: "NeedsConfigurationError",
      });
    },
  });
}
