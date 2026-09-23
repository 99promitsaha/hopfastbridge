import { useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Dialog } from './Dialog';
import type { TokenOption, ChainOption } from '../lib/chains';
interface TokenSelectorProps {
  label: string;
  selectedToken: TokenOption;
  tokens: TokenOption[];
  chain: ChainOption;
  chains: ChainOption[];
  onSelectToken: (symbol: string) => void;
  onSelectChain: (chainKey: string) => void;
  chainModalOpen: boolean;
  onChainModalClose: () => void;
  balances?: Record<string, string>;
  disabled?: boolean;
}
export function TokenSelector({
  label,
  selectedToken,
  tokens,
  chain,
  chains,
  onSelectToken,
  onSelectChain,
  chainModalOpen,
  onChainModalClose,
  balances,
  disabled,
}: TokenSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = tokens.filter((t) =>
    `${t.symbol} ${t.name} ${t.address}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  );
  return (
    <>
      <button
        className="hf-token-btn"
        disabled={disabled}
        onClick={() => {
          setSearch('');
          setOpen(true);
        }}
        aria-label={`Select ${label} token`}
      >
        <img src={selectedToken.logoURI} alt="" />
        {selectedToken.symbol}
        <ChevronDown size={14} />
      </button>
      {open && (
        <Dialog title="Choose an asset" onClose={() => setOpen(false)}>
          <p className="hf-dialog-sub">Available on {chain.name}</p>
          <label className="hf-dropdown-search-wrap">
            <Search size={17} />
            <input
              className="hf-dropdown-search"
              placeholder="Search asset or contract"
              aria-label="Search tokens"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="hf-dropdown-list">
            {filtered.map((t) => (
              <button
                key={t.address}
                className={`hf-dropdown-item ${t.symbol === selectedToken.symbol ? 'hf-dropdown-item-active' : ''}`}
                onClick={() => {
                  onSelectToken(t.symbol);
                  setOpen(false);
                }}
              >
                <img src={t.logoURI} alt="" />
                <span className="hf-dropdown-item-info">
                  <strong>{t.symbol}</strong>
                  <span>{t.name}</span>
                </span>
                {balances?.[t.address.toLowerCase()] != null && (
                  <span className="hf-dropdown-item-balance">
                    {balances[t.address.toLowerCase()]}
                  </span>
                )}
                {t.symbol === selectedToken.symbol && <Check size={17} />}
              </button>
            ))}
            {!filtered.length && (
              <p className="hf-dropdown-empty">
                No matching assets on this network.
              </p>
            )}
          </div>
          {chain.key === 'arc' && (
            <p className="hf-dialog-note">
              USDC powers payments and gas on Arc. One asset, one balance.
            </p>
          )}
        </Dialog>
      )}
      {chainModalOpen && (
        <Dialog title="Choose a network" onClose={onChainModalClose}>
          <p className="hf-dialog-sub">
            Choose the network you are sending from or receiving on.
          </p>
          <div className="hf-dropdown-list">
            {chains.map((c) => (
              <button
                key={c.key}
                className={`hf-dropdown-item ${c.key === chain.key ? 'hf-dropdown-item-active' : ''}`}
                onClick={() => {
                  onSelectChain(c.key);
                  onChainModalClose();
                }}
              >
                <img src={c.logoURI} alt="" />
                <span className="hf-dropdown-item-info">
                  <strong>{c.name}</strong>
                </span>
                {c.key === chain.key && <Check size={17} />}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
