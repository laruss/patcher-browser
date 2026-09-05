import { Provider as JotaiProvider, createStore } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JSX, ReactNode } from "react";
import { createAppQueryClient } from "@/lib/query-client";

interface QueryClientTestWrapperProps {
  children: ReactNode;
}

type QueryClientTestWrapper = (
  props: QueryClientTestWrapperProps,
) => JSX.Element;

export interface QueryClientTestHarness {
  queryClient: QueryClient;
  wrapper: QueryClientTestWrapper;
  /**
   * The store the wrapper provides, so a test can seed an atom before mounting
   * or read one after acting. Explicit rather than implicit: a `Provider` with
   * no store makes one nothing outside the tree can reach.
   */
  store: ReturnType<typeof createStore>;
}

export function createQueryClientTestHarness(): QueryClientTestHarness {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
  });

  const store = createStore();

  const wrapper: QueryClientTestWrapper = ({ children }) => (
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </JotaiProvider>
  );

  return {
    queryClient,
    store,
    wrapper,
  };
}
