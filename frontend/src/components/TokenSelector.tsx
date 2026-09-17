import { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { TokenOption, ChainOption } from '../lib/chains';

interface TokenSelectorProps {
  label: string;
  selectedToken: TokenOption;
  tokens: TokenOption[];
  chain: ChainOption;
  chains: ChainOption[];
  onSelectToken: (symbol: string) => void;
  onSelectChain: (chainKey: string) => void;
  /** Controlled: whether the chain modal is open (managed by parent) */
  chainModalOpen: boolean;
  /** Called when the chain modal should close */
  onChainModalClose: () => void;
  /** Map of lowercase token address → formatted balance string */
  balances?: Record<string, string>;
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
  balances
}: TokenSelectorProps) {
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const normalizedSearch = tokenSearch.trim().toLowerCase();
  const filteredTokens = normalizedSearch
    ? tokens.filter((token) =>
      token.symbol.toLowerCase().includes(normalizedSearch)
      || token.name.toLowerCase().includes(normalizedSearch)
    )
    : tokens;

  return (
    <>
      <div className="hf-token-selector">
        <button
          className="hf-token-btn"
          onClick={() => setShowTokenModal(true)}
          aria-label={`Select ${label} token`}
        >
          <img
            src={selectedToken.logoURI}
            alt={selectedToken.symbol}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          {selectedToken.symbol}
          <ChevronDown size={12} />
        </button>
      </div>

      {/* Token Selection Modal */}
      {showTokenModal && (
        <div className="hf-dropdown-overlay" onClick={() => setShowTokenModal(false)}>
          <div
            className="hf-dropdown-panel hf-fadeup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hf-dropdown-header">
              <h3>Select Token</h3>
              <button
                className="hf-dropdown-close"
                onClick={() => setShowTokenModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="hf-dropdown-search-wrap">
              <input
                className="hf-dropdown-search"
                placeholder="Search token"
                value={tokenSearch}
                onChange={(e) => setTokenSearch(e.target.value)}
              />
            </div>
            <div className="hf-dropdown-list">
              {filteredTokens.map((token) => (
                <button
                  key={token.symbol}
                  className={`hf-dropdown-item ${
                    token.symbol === selectedToken.symbol
                      ? 'hf-dropdown-item-active'
                      : ''
                  }`}
                  onClick={() => {
                    onSelectToken(token.symbol);
                    setShowTokenModal(false);
                  }}
                >
                  <img
                    src={token.logoURI}
                    alt={token.symbol}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="hf-dropdown-item-info">
                    <strong>{token.symbol}</strong>
                    <span>{token.name}</span>
                  </div>
                  {balances?.[token.address.toLowerCase()] != null && (
                    <span className="hf-dropdown-item-balance">
                      {balances[token.address.toLowerCase()]}
                    </span>
                  )}
                </button>
              ))}
              {filteredTokens.length === 0 && (
                <div className="hf-dropdown-empty">No token matches that search.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chain Selection Modal */}
      {chainModalOpen && (
        <div className="hf-dropdown-overlay" onClick={onChainModalClose}>
          <div
            className="hf-dropdown-panel hf-fadeup"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hf-dropdown-header">
              <h3>Select Network</h3>
              <button
                className="hf-dropdown-close"
                onClick={onChainModalClose}
              >
                <X size={18} />
              </button>
            </div>
            <div className="hf-dropdown-list">
              {chains.map((c) => (
                <button
                  key={c.key}
                  className={`hf-dropdown-item ${
                    c.key === chain.key ? 'hf-dropdown-item-active' : ''
                  }`}
                  onClick={() => {
                    onSelectChain(c.key);
                    onChainModalClose();
                  }}
                >
                  <img
                    src={c.logoURI}
                    alt={c.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <div className="hf-dropdown-item-info">
                    <strong>{c.name}</strong>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
