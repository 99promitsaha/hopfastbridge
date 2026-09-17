/**
 * Central guard against the "funds go to a wrong address" class of bugs.
 *
 * History: Relay's /quote/v2 silently substitutes `recipient=0x0` with their
 * own fallback address (0xf3d6…691e). If any provider client forwards a zero
 * or missing recipient, the upstream API may happily quote a route that
 * delivers funds somewhere we don't control.
 *
 * Rule: every provider must call `assertValidRecipient()` before making an
 * upstream quote request. This refuses zero, missing, or malformed addresses.
 */

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class InvalidRecipientError extends Error {
  constructor(reason: string) {
    super(`Invalid recipient for quote: ${reason}. Connect a wallet before requesting an executable quote.`);
    this.name = 'InvalidRecipientError';
  }
}

/**
 * Throws if `address` is missing, malformed, or the zero address.
 * Use for any field that will be interpreted by an upstream router as the
 * destination recipient of bridged funds.
 */
export function assertValidRecipient(address: string | undefined, label = 'recipient'): string {
  if (!address) {
    throw new InvalidRecipientError(`${label} missing`);
  }
  if (!EVM_ADDRESS_REGEX.test(address)) {
    throw new InvalidRecipientError(`${label} is not a valid EVM address (${address})`);
  }
  if (address.toLowerCase() === ZERO_ADDRESS) {
    throw new InvalidRecipientError(`${label} is the zero address — upstream APIs may silently substitute a fallback wallet`);
  }
  return address;
}

/**
 * Same-shape check for a caller address (msg.sender of the deposit). Upstream
 * APIs often pick routes based on `fromAddress`; a zero here tends to produce
 * sub-optimal or unexecutable quotes. Enforced for consistency.
 */
export function assertValidSender(address: string | undefined, label = 'sender'): string {
  return assertValidRecipient(address, label);
}

/**
 * Response-side backstop: ensures the provider's returned calldata actually
 * routes funds to the recipient we asked for.
 *
 * Every bridge/router we integrate encodes the destination recipient as a
 * 20-byte address word somewhere in the source-chain transaction calldata.
 * If an upstream silently substituted a fallback wallet, our EOA wouldn't
 * appear anywhere in the returned hex — so needle-searching the calldata is
 * a cheap, provider-agnostic check that catches the misroute before the tx
 * is ever handed to a wallet for signing.
 *
 * This complements:
 *   - Input guard (`assertValidRecipient`): fail-closed before the request
 *   - Provider-specific response checks (e.g. Relay's `details.recipient`)
 *   - Frontend `useSwapExecution` calldata scan at sign-time
 *
 * The backend-side check specifically matters for non-browser clients (our
 * MCP server, direct API consumers) which never run the frontend scan.
 *
 * No-ops on empty / selector-only calldata (length <= 10 hex chars, i.e. just
 * a 4-byte function selector or nothing) — there are no parameters to check.
 */
export function assertCalldataRoutesToRecipient(
  data: string | undefined,
  recipient: string,
  providerLabel: string
): void {
  if (!data) return;
  const normalized = data.toLowerCase();
  if (normalized.length <= 10) return; // only a function selector or empty
  const needle = recipient.toLowerCase().replace(/^0x/, '');
  if (!needle || needle.length !== 40) return; // malformed recipient, caller already asserted it
  if (!normalized.includes(needle)) {
    throw new InvalidRecipientError(
      `${providerLabel} response calldata does not reference recipient ${recipient} — upstream may have substituted a fallback wallet. Refusing quote.`
    );
  }
}
