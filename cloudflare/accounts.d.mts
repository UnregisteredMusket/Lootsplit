export function accountAuth(env: Record<string, unknown>): {
  api: { getSession(input: { headers: Headers }): Promise<{ user: { id: string } } | null> };
};
export function handleAccounts(
  request: Request,
  env: Record<string, unknown>,
): Promise<Response | null>;
