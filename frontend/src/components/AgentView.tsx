import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, Check, Copy, Shield, Terminal, Zap } from 'lucide-react';
const tools = [
  ['compare_swap_routes', 'Compare two providers with fee, duration and minimum-output limits.'],
  ['get_swap_quote', 'Request one provider’s executable swap quote.'],
  ['get_transaction_status', 'Check provider and on-chain swap status.'],
  ['get_transaction_history', 'Read recorded wallet swap history.'],
  ['record_transaction', 'Record a submitted swap in wallet history.'],
  ['get_arc_balance', 'Read USDC available on Arc, including the balance used for gas.'],
  ['prepare_arc_payment', 'Create a private link for the payer to review and sign a USDC payment.'],
  ['get_payment_status', 'Resume tracking and read the verified payment receipt.'],
  ['register_wallet', 'Register a wallet for recorded history.'],
  ['get_protocol_stats', 'Read self-reported swap activity.'],
  ['check_health', 'Check API and database availability.']
];
export function AgentView({ onBack }: { onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const endpoint = import.meta.env.VITE_MCP_URL || 'http://localhost:3100/mcp';
  const config = JSON.stringify({ mcpServers: { hopfastbridge: { type: 'http', url: endpoint } } }, null, 2);
  return <motion.main className="hf-content hf-agent-page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
    <div className="hf-agent-inner">
      <div className="hf-agent-wip"><Shield size={15} /><span>Development build. Live routes and wallet transactions need verification before launch.</span></div>
      <div className="hf-agent-hero"><p className="hf-kicker"><Bot size={16} /> Built for your agent</p><h1 className="hf-agent-headline">Swap. Pay. Keep track.</h1><p className="hf-agent-section-desc">Connect your MCP client to compare swap routes and prepare USDC payments on Arc. Your wallet stays in control.</p></div>
      <div className="hf-agent-section"><div className="hf-agent-section-header"><Terminal size={16} /><h3>Connect through MCP</h3></div>
        <p className="hf-agent-section-desc">Use the endpoint below in a client that supports Streamable HTTP. Local addresses work only when the client can reach this machine. No public endpoint is configured yet.</p>
        <div className="hf-agent-code-wrap"><button className="hf-agent-copy-btn" onClick={() => { void navigator.clipboard.writeText(config).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button><pre className="hf-agent-code"><code>{config}</code></pre></div>
      </div>
      <div className="hf-agent-section"><div className="hf-agent-section-header"><Zap size={16} /><h3>What your agent can do</h3></div><div className="hf-agent-tools-grid">{tools.map(([name, description]) => <div key={name} className="hf-agent-tool-row"><code>{name}</code><span>{description}</span></div>)}</div></div>
      <div className="hf-agent-section"><h3>Try a payment workflow</h3><div className="hf-agent-code-wrap"><pre className="hf-agent-code">Check my Arc USDC balance. Prepare a 1 USDC payment to the recipient I give you, then show me the link to review it in my wallet.</pre></div><p className="hf-agent-section-desc">A payment link expires after 15 minutes. The payer checks the full address and amount, then signs. The agent can resume with the payment ID and private access token. Submitted payments continue to be checked while the API is running.</p></div>
      <div className="hf-agent-section"><h3>Your approval comes first</h3><p className="hf-agent-section-desc">Hopfastbridge never signs for you. An agent can prepare a request, but only your wallet can send funds. A transaction hash alone is not proof of completion. Arc funding, delegated spending and paid API access are upcoming phases.</p></div>
      <button className="hf-btn hf-btn-secondary" onClick={onBack}>Back to swaps</button>
    </div>
  </motion.main>;
}
