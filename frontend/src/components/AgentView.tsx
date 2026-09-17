import { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Check, Terminal, Globe, Zap, Shield, BookOpen, ChevronRight } from 'lucide-react';

interface AgentViewProps {
  onBack: () => void;
}

const MCP_URL = 'https://mcp.hopfast.xyz/mcp';

const TOOLS = [
  { name: 'get_swap_quote',         desc: 'Get a cross-chain quote from LI.FI, Squid, or deBridge. Returns the full transaction payload ready to sign.' },
  { name: 'get_transaction_status', desc: 'Check where a bridge is at. Call it on a loop until you see "completed" or "failed".' },
  { name: 'get_transaction_history',desc: "Pull a wallet's swap history — how many, what tokens, which chains, all of it." },
  { name: 'record_transaction',     desc: 'Once the user signs and the tx is broadcast, call this so it shows up in their history.' },
  { name: 'get_earn_vaults',        desc: 'Browse yield vaults. Filter by chain, token, or protocol. Sort by APY or TVL.' },
  { name: 'get_earn_quote',         desc: 'Get the deposit transaction for a specific vault. Same deal as swap — user signs it.' },
  { name: 'get_earn_positions',     desc: "See all the vaults a wallet has deposited into, including amounts and tx hashes." },
  { name: 'record_earn_deposit',    desc: 'Log a completed vault deposit so it shows up under the wallet\'s earn positions.' },
  { name: 'get_user_preferences',   desc: "Check if a user has set their risk appetite and experience level yet." },
  { name: 'save_user_preferences',  desc: 'Save their preferences so you can personalise vault recommendations next time.' },
  { name: 'register_wallet',        desc: 'Register the wallet with HopFast at the start of a session. Safe to call every time.' },
  { name: 'get_protocol_stats',     desc: 'Get swap volume, unique users, and earn stats for the last 7, 15, or 30 days.' },
  { name: 'check_health',           desc: 'Ping the backend to make sure everything is up before doing anything else.' },
];

const PROMPTS = [
  { name: 'cross_chain_swap',  desc: 'Walks the agent through a full swap — quote, confirmation, signing, and status tracking.' },
  { name: 'find_yield',        desc: 'Handles the whole earn flow — preferences, vault search, deposit quote, and recording the position.' },
  { name: 'portfolio_review',  desc: "Shows the agent how to summarise a wallet's swap history and active earn positions in one go." },
  { name: 'check_swap_status', desc: 'Tells the agent to keep checking a bridge tx until it resolves, with live updates.' },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="hf-agent-copy-btn" onClick={copy} title="Copy to clipboard">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ code, lang = '' }: { code: string; lang?: string }) {
  return (
    <div className="hf-agent-code-wrap">
      {lang && <span className="hf-agent-code-lang">{lang}</span>}
      <CopyButton text={code} />
      <pre className="hf-agent-code"><code>{code}</code></pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="hf-agent-step">
      <div className="hf-agent-step-num">{n}</div>
      <div className="hf-agent-step-body">
        <p className="hf-agent-step-title">{title}</p>
        {children}
      </div>
    </div>
  );
}

type SetupTab = 'claude-desktop' | 'claude-code' | 'http';

export function AgentView({ onBack }: AgentViewProps) {
  const [tab, setTab] = useState<SetupTab>('claude-desktop');

  return (
    <motion.main
      key="agent"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.24 }}
      className="hf-content hf-agent-page"
    >
      <div className="hf-agent-inner">

        {/* ── WIP Banner ───────────────────────────────────── */}
        <div className="hf-agent-wip">
          <Shield size={14} />
          <span>
            <strong>Still being developed.</strong> If you just want to swap or earn, <button className="hf-agent-wip-link" onClick={onBack}>Human mode</button> is a lot more reliable right now. Agent mode is for developers who want to plug HopFast into their own AI workflows.
          </span>
        </div>

        {/* ── Hero ─────────────────────────────────────────── */}
        <div className="hf-agent-hero">
          <p className="hf-kicker">For Developers/Curious minds</p>
          <h2 className="hf-agent-headline">HopFast MCP Docs for AI-Agents</h2>
          <p className="hf-agent-sub">
            We built an MCP server so Claude, Codex, Gemini, or any agent you're running
            can swap tokens, browse yield vaults, and track positions. Without you writing
            a single line of integration code. Point your agent at one URL and it figures
            the rest out on its own.
          </p>
        </div>

        {/* ── Endpoint ─────────────────────────────────────── */}
        <div className="hf-agent-section">
          <div className="hf-agent-section-header">
            <Globe size={15} />
            <h3>The URL</h3>
          </div>
          <p className="hf-agent-section-desc">
            This is live right now. No API key, no sign-up. Just point your agent at it and go.
          </p>
          <div className="hf-agent-endpoint">
            <span className="hf-agent-endpoint-url">{MCP_URL}</span>
            <CopyButton text={MCP_URL} />
          </div>
          <div className="hf-agent-endpoint-meta">
            <span className="hf-agent-badge hf-agent-badge-green">Live</span>
            <span className="hf-agent-badge">Streamable HTTP</span>
            <span className="hf-agent-badge">13 tools</span>
            <span className="hf-agent-badge">2 resources</span>
            <span className="hf-agent-badge">4 prompts</span>
          </div>
        </div>

        {/* ── Setup ────────────────────────────────────────── */}
        <div className="hf-agent-section">
          <div className="hf-agent-section-header">
            <Terminal size={15} />
            <h3>Getting Connected</h3>
          </div>
          <p className="hf-agent-section-desc">
            Pick whatever you're using. They all talk to the same server.
          </p>

          <div className="hf-agent-tabs">
            {([
              ['claude-desktop', 'Claude Desktop'],
              ['claude-code',    'Claude Code'],
              ['http',           'Any HTTP Agent'],
            ] as [SetupTab, string][]).map(([id, label]) => (
              <button
                key={id}
                className={`hf-agent-tab ${tab === id ? 'hf-agent-tab-active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Claude Desktop */}
          {tab === 'claude-desktop' && (
            <div className="hf-agent-tab-content">
              <Step n={1} title="Find your config file">
                <p>Claude Desktop keeps its settings in a JSON file. Open it in any text editor — it's just a plain text file.</p>
                <div className="hf-agent-os-paths">
                  <div>
                    <span className="hf-agent-os-label">macOS</span>
                    <CodeBlock code="~/Library/Application Support/Claude/claude_desktop_config.json" />
                  </div>
                  <div>
                    <span className="hf-agent-os-label">Windows</span>
                    <CodeBlock code="%APPDATA%\Claude\claude_desktop_config.json" />
                  </div>
                </div>
                <p className="hf-agent-hint">Don't see the file? Just create it — Claude Desktop will pick it up on next launch.</p>
              </Step>

              <Step n={2} title="Paste this in">
                <p>Add a <code>mcpServers</code> block if you don't have one already. If you do, just add the <code>hopfast</code> entry inside it alongside your existing ones.</p>
                <CodeBlock lang="json" code={`{
  "mcpServers": {
    "hopfast": {
      "type": "http",
      "url": "https://mcp.hopfast.xyz/mcp"
    }
  }
}`} />
              </Step>

              <Step n={3} title="Restart Claude Desktop">
                <p>Fully quit the app — not just close the window — and reopen it. Claude Desktop connects to MCP servers on startup, so a full restart is needed.</p>
                <p className="hf-agent-hint">Once it loads, look for the hammer icon (🔨) near the chat input. Click it and you'll see all 13 HopFast tools listed there.</p>
              </Step>

              <Step n={4} title="Try it out">
                <p>Ask Claude something like this to confirm everything is wired up:</p>
                <CodeBlock code={`Check HopFast health, then find me the top 5 USDC yield vaults on Base sorted by APY.`} />
                <p className="hf-agent-hint">Claude will call <code>check_health</code> first, then <code>get_earn_vaults</code>, and show you the results. If it works, you're good to go.</p>
              </Step>
            </div>
          )}

          {/* Claude Code */}
          {tab === 'claude-code' && (
            <div className="hf-agent-tab-content">
              <Step n={1} title="Add it via the CLI — the quick way">
                <p>Run this once from your terminal. It registers HopFast across all your Claude Code sessions.</p>
                <CodeBlock lang="bash" code={`claude mcp add --transport http hopfast https://mcp.hopfast.xyz/mcp`} />
                <p className="hf-agent-hint">This writes to your global Claude Code config, so you only need to do it once per machine.</p>
              </Step>

              <Step n={2} title="Or add it per-project instead">
                <p>If you only want HopFast available in a specific repo, create (or edit) <code>.claude/settings.json</code> in your project root:</p>
                <CodeBlock lang="json" code={`{
  "mcpServers": {
    "hopfast": {
      "type": "http",
      "url": "https://mcp.hopfast.xyz/mcp"
    }
  }
}`} />
                <p className="hf-agent-hint">This is the per-project approach. It won't affect your other Claude Code sessions or repos.</p>
              </Step>

              <Step n={3} title="Check it's connected">
                <p>Run this to see all your registered MCP servers and their connection status:</p>
                <CodeBlock lang="bash" code={`claude mcp list`} />
                <p>You should see <code>hopfast</code> with a <strong>connected</strong> status. If it shows an error, double-check the URL has no typos and try again.</p>
              </Step>

              <Step n={4} title="Give it a go">
                <p>In a Claude Code session, just ask:</p>
                <CodeBlock code={`Use the hopfast check_health tool. Then pull protocol stats for the last 30 days.`} />
                <p className="hf-agent-hint">Claude Code will call both tools and show you the raw results. From here you can ask it to do anything — swap quotes, earn vault searches, wallet history, all of it.</p>
              </Step>
            </div>
          )}

          {/* HTTP Agent */}
          {tab === 'http' && (
            <div className="hf-agent-tab-content">
              <Step n={1} title="One thing to know before you start">
                <p>
                  HopFast's MCP server speaks JSON-RPC 2.0 over HTTP. Every request needs two specific headers or it'll reject you with a 406:
                </p>
                <CodeBlock lang="http" code={`Content-Type: application/json
Accept: application/json, text/event-stream`} />
                <p className="hf-agent-hint">The <code>Accept</code> header is the one people usually miss. Don't skip it.</p>
              </Step>

              <Step n={2} title="Discover what's available">
                <p>Before your agent does anything else, fetch the tool list. This tells it every tool name, what it does, and exactly what inputs it expects:</p>
                <CodeBlock lang="bash" code={`curl -X POST https://mcp.hopfast.xyz/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`} />
                <p>The response includes the full JSON schema for every tool's inputs — your agent can use this to figure out how to call anything without needing docs.</p>
              </Step>

              <Step n={3} title="Call a tool">
                <p>Use <code>tools/call</code> and pass the tool name plus its arguments. Here's <code>check_health</code> as an example (no arguments needed):</p>
                <CodeBlock lang="bash" code={`curl -X POST https://mcp.hopfast.xyz/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "check_health",
      "arguments": {}
    }
  }'`} />
                <p className="hf-agent-hint">The <code>id</code> field is just for matching requests to responses — increment it however you like.</p>
              </Step>

              <Step n={4} title="Read reference data">
                <p>There are two resources your agent can read at any time. <code>hopfast://guide</code> is a full Markdown walkthrough of how HopFast works, written for agents. <code>hopfast://chains</code> has every supported chain with token addresses and decimals — useful when constructing swap calls.</p>
                <CodeBlock lang="bash" code={`curl -X POST https://mcp.hopfast.xyz/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "resources/read",
    "params": { "uri": "hopfast://guide" }
  }'`} />
              </Step>

              <Step n={5} title="Use a built-in workflow prompt">
                <p>Prompts are pre-written instructions you can inject into your agent's conversation. Instead of figuring out the right sequence of tool calls yourself, just invoke a prompt and your agent knows exactly what to do. Here's how to fetch the yield-finding workflow:</p>
                <CodeBlock lang="bash" code={`curl -X POST https://mcp.hopfast.xyz/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "prompts/get",
    "params": {
      "name": "find_yield",
      "arguments": {
        "walletAddress": "0xYourWalletHere",
        "asset": "USDC",
        "chainKey": "base"
      }
    }
  }'`} />
                <p className="hf-agent-hint">The response is a ready-to-use message. Drop it into your agent's conversation as a user turn and it'll take it from there.</p>
              </Step>
            </div>
          )}
        </div>

        {/* ── Tools ────────────────────────────────────────── */}
        <div className="hf-agent-section">
          <div className="hf-agent-section-header">
            <Zap size={15} />
            <h3>What Your Agent Can Do</h3>
          </div>
          <p className="hf-agent-section-desc">
            13 tools in total. Every one of them has a full description and input schema baked in,
            so your agent knows how to use them just from connecting — no separate documentation needed.
          </p>
          <div className="hf-agent-tools-grid">
            {TOOLS.map(t => (
              <div key={t.name} className="hf-agent-tool-row">
                <code className="hf-agent-tool-name">{t.name}</code>
                <span className="hf-agent-tool-desc">{t.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Prompts ──────────────────────────────────────── */}
        <div className="hf-agent-section">
          <div className="hf-agent-section-header">
            <BookOpen size={15} />
            <h3>Built-in Workflow Prompts</h3>
          </div>
          <p className="hf-agent-section-desc">
            These are pre-written instructions for common DeFi workflows. Instead of your agent
            figuring out which tools to call and in what order, you invoke a prompt and it already
            knows the full sequence — what to ask the user, when to wait for confirmation,
            and what to do after the transaction goes through.
          </p>
          <div className="hf-agent-prompts-list">
            {PROMPTS.map(p => (
              <div key={p.name} className="hf-agent-prompt-row">
                <ChevronRight size={12} className="hf-agent-prompt-arrow" />
                <div>
                  <code className="hf-agent-tool-name">{p.name}</code>
                  <p className="hf-agent-tool-desc">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Wallet signing ───────────────────────────────── */}
        <div className="hf-agent-section">
          <div className="hf-agent-section-header">
            <Shield size={15} />
            <h3>How Signing Works — and What Agents Can't Do</h3>
          </div>
          <p className="hf-agent-section-desc">
            This is the part worth reading carefully if you're building something on top of this.
          </p>
          <div className="hf-agent-signing-flow">
            <div className="hf-agent-signing-step">
              <div className="hf-agent-signing-num">1</div>
              <div>
                <strong>Agent calls <code>get_swap_quote</code></strong>
                <p>HopFast hits LI.FI, Squid, or deBridge and gets back a route. It returns that as a <code>transactionRequest</code> — basically a raw transaction object with the destination, encoded calldata, and gas estimates.</p>
              </div>
            </div>
            <div className="hf-agent-signing-arrow">↓</div>
            <div className="hf-agent-signing-step">
              <div className="hf-agent-signing-num">2</div>
              <div>
                <strong>Agent shows the user what they're about to do</strong>
                <p>How much they're sending, what they'll get on the other side, fees, and estimated time. It asks them to confirm before anything moves.</p>
              </div>
            </div>
            <div className="hf-agent-signing-arrow">↓</div>
            <div className="hf-agent-signing-step hf-agent-signing-step-highlight">
              <div className="hf-agent-signing-num">3</div>
              <div>
                <strong>The user signs — not the agent</strong>
                <p>The <code>transactionRequest</code> goes to Privy or MetaMask. A wallet popup appears in the browser. The user clicks Confirm. The agent never sees the private key, never has access to funds, and cannot do this step on the user's behalf.</p>
              </div>
            </div>
            <div className="hf-agent-signing-arrow">↓</div>
            <div className="hf-agent-signing-step">
              <div className="hf-agent-signing-num">4</div>
              <div>
                <strong>Agent takes over again</strong>
                <p>The wallet returns a <code>txHash</code>. The agent calls <code>record_transaction</code> to save it, then polls <code>get_transaction_status</code> every 15–30 seconds until the bridge finishes — at which point it tells the user their funds landed.</p>
              </div>
            </div>
          </div>
          <p className="hf-agent-signing-note">
            Bottom line: <strong>agents plan and track, users approve and sign.</strong> Nothing moves without the user explicitly confirming it in their wallet.
          </p>
        </div>

        {/* ── Back ─────────────────────────────────────────── */}
        <div className="hf-agent-footer">
          <button className="hf-btn hf-btn-secondary" onClick={onBack}>
            Back to Homepage
          </button>
        </div>

      </div>
    </motion.main>
  );
}
