const textEncoder = new TextEncoder();

export interface StreamJsonResponseOptions<T> {
  /**
   * What to send when the value rejects.
   *
   * Without it the stream errors, which reaches the caller as a failed request.
   * A route whose caller reads a refusal as an answer rather than as a fault
   * supplies one instead.
   */
  onRejected?: (error: unknown) => T;
}

/**
 * Return the response head before the value it carries is known.
 *
 * Routes that wait on a person can hold the body open for minutes, while
 * Patcher Connect requires an origin response head within 30 seconds. The head
 * goes now and the JSON follows in the body.
 */
export function streamJsonResponse<T>(
  value: Promise<T>,
  options: StreamJsonResponseOptions<T> = {},
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (resolved: T): void => {
        try {
          controller.enqueue(textEncoder.encode(JSON.stringify(resolved)));
          controller.close();
        } catch (error) {
          // The reader hung up. Erroring rather than swallowing is what leaves
          // the stream settled instead of neither closed nor errored.
          controller.error(error);
        }
      };
      void value.then(send, (error: unknown) => {
        const { onRejected } = options;
        if (onRejected === undefined) {
          controller.error(error);
          return;
        }
        send(onRejected(error));
      });
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}
