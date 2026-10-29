export async function withPluginTimeout<T>(args: {
  run: () => Promise<T>;
  timeoutMs: number;
}): Promise<T> {
  const call = args.run();
  call.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${args.timeoutMs}ms`)),
          args.timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
