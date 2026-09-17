/**
 * Base Builder Code — ERC-8021 data suffix.
 *
 * Appends an attribution tag to transaction calldata so Base indexers can
 * attribute on-chain activity to HopFast.  Contracts ignore the extra
 * trailing bytes, so this is completely safe (adds ~16 gas per non-zero byte).
 *
 * @see https://docs.base.org/apps/builder-codes/builder-codes
 * @see https://eip.tools/eip/8021
 */

const BUILDER_CODE = 'bc_52mjdvpq';

/**
 * ERC-8021 magic suffix — 0x8021 repeated 8 times (16 bytes).
 * This is the constant defined by the spec that indexers scan for.
 */
const ERC_SUFFIX = '80218021802180218021802180218021';

/**
 * Encode a builder code into an ERC-8021 Schema 0 data suffix.
 *
 * Schema 0 layout:
 *   <codes_ascii> ∥ <codes_length: 1 byte> ∥ <schema_id: 1 byte = 0x00> ∥ <erc_suffix: 16 bytes>
 *
 * Codes are comma-separated ASCII strings (single code = just the string).
 */
function encodeBuilderSuffix(code: string): string {
  const encoder = new TextEncoder();
  const codeBytes = encoder.encode(code);
  const codesLength = codeBytes.length;

  const parts: string[] = [];

  // 1. Code bytes (ASCII)
  for (const b of codeBytes) {
    parts.push(b.toString(16).padStart(2, '0'));
  }

  // 2. Codes length (1 byte)
  parts.push(codesLength.toString(16).padStart(2, '0'));

  // 3. Schema ID (1 byte) — Schema 0
  parts.push('00');

  // 4. ERC-8021 magic suffix (16 bytes)
  parts.push(ERC_SUFFIX);

  return parts.join('');
}

/** Pre-computed suffix (hex, no 0x prefix) */
const SUFFIX_HEX = encodeBuilderSuffix(BUILDER_CODE);

/**
 * Append the Base Builder Code attribution suffix to transaction calldata.
 * Returns the original data with the suffix appended.
 *
 * WARNING: This unconditionally appends the suffix. Use
 * {@link appendBuilderCodeForChain} at call sites instead — the suffix is only
 * valuable on Base (where the rewards come from) and can break protocols that
 * hash or strictly validate calldata on other chains (e.g. deBridge DLN's
 * cross-chain orders on Ethereum).
 *
 * @param data - Existing calldata hex string (with or without 0x prefix), or undefined/null
 */
export function appendBuilderCode(data: string | undefined | null): string {
  const base = data ?? '0x';
  const clean = base.startsWith('0x') ? base : `0x${base}`;
  return `${clean}${SUFFIX_HEX}`;
}

/**
 * Base mainnet chain ID. Builder-code rewards are paid out by the Base
 * sequencer, so attribution only makes economic sense when the user's
 * transaction is submitted on Base.
 */
const BASE_CHAIN_ID = 8453;

/**
 * Chain-aware builder-code appender.
 *
 * Only appends the ERC-8021 suffix when the user's transaction is being sent
 * on Base. Other chains:
 *   - don't pay builder-code rewards (no upside), and
 *   - may route through protocols that strictly validate calldata (e.g.
 *     deBridge DLN's cross-chain order creation), where appending bytes
 *     corrupts on-chain order hashing and causes silent bridge failures.
 *
 * Use this everywhere you're about to submit a transaction instead of
 * {@link appendBuilderCode}.
 *
 * @param data - Existing calldata hex string
 * @param sourceChainId - EVM chain ID where the user will sign/send this tx
 */
export function appendBuilderCodeForChain(
  data: string | undefined | null,
  sourceChainId: number
): string {
  if (sourceChainId !== BASE_CHAIN_ID) {
    const base = data ?? '0x';
    return base.startsWith('0x') ? base : `0x${base}`;
  }
  return appendBuilderCode(data);
}
