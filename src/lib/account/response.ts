/** Gate response parsing before any membership, token or device state changes. */
export async function readAccountResponse<T>(response: Response): Promise<T> {
  const unreadable = () =>
    new Error(
      "The account service returned an unreadable response. Refresh the campaign list and try again. Pending actions on this device have been kept.",
    );
  if (response.headers.get("content-type")?.includes("text/html")) throw unreadable();
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw unreadable();
    throw error;
  }
}
