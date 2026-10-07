export function assertLinkedSeatActive(
  db: {
    prepare(sql: string): {
      bind(...values: unknown[]): { first(): Promise<unknown> };
    };
  },
  code: string,
  token: string,
  seat?: { userId?: string } | null,
): Promise<void>;
