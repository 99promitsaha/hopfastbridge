import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Plus } from 'lucide-react';
import { API_BASE_URL } from '../constants';
import { fundingAmounts } from '../lib/builderFunding';

interface GrantRequest {
  _id: string;
  title: string;
  handle: string;
  projectUrl: string;
  description: string;
  milestone: string;
  targetUsdc: string;
}
export function MicroGrantsView({
  onBackBuilder,
}: {
  onBackBuilder: (handle: string) => void;
}) {
  const [requests, setRequests] = useState<GrantRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [contribution, setContribution] = useState('25');
  const costs = fundingAmounts(contribution, 150);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/grants`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Could not load requests. Try again shortly.');
        const data = await response.json();
        setRequests(data.requests);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    values.handle = String(values.handle).replace(/^@/, '').trim();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const response = await fetch(`${API_BASE_URL}/grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? 'Could not save your request.');
      setRequests((current) => [data.request, ...current]);
      setSaved(true);
      form.reset();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save your request.'
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <main className="hf-content hf-grants-page" id="main-content">
      <section className="hf-grants-intro">
        <p className="hf-landing-kicker">COMMUNITY MICRO-GRANTS ON ARC</p>
        <h1>
          Show what you’re building.
          <br />
          Ask for your next milestone.
        </h1>
        <p>
          Early founders need a first backer. Share your Arc project, a working
          link, and what a small USDC grant would help you ship. People who
          believe in your idea can discover your work here.
        </p>
        <a href="#request-grant" className="hf-landing-primary">
          Request a micro-grant <Plus size={16} />
        </a>
        <small>
          Requests are open. On-chain contributions are coming soon.
        </small>
      </section>
      <section className="hf-grants-board" aria-label="Arc builder requests">
        <header>
          <h2>Architects looking for a first backer</h2>
          <span>
            {requests.length} {requests.length === 1 ? 'request' : 'requests'}
          </span>
        </header>
        {loading && <p role="status">Loading requests…</p>}
        {!loading && error && !requests.length && (
          <p className="hf-note hf-note-error" role="alert">
            {error}
          </p>
        )}
        {!loading && !requests.length && (
          <div className="hf-grants-empty">
            <h3>Your project could be the first.</h3>
            <p>
              Tell the community what you’re building on Arc and what you need
              to make progress.
            </p>
          </div>
        )}
        <div className="hf-grants-grid">
          {requests.map((request) => (
            <article className="hf-grant-card" key={request._id}>
              <p className="hf-grant-handle">
                @{request.handle} <span>Community submission</span>
              </p>
              <h3>{request.title}</h3>
              <p>{request.description}</p>
              <div className="hf-grant-milestone">
                <span>NEXT MILESTONE</span>
                <p>{request.milestone}</p>
              </div>
              <div className="hf-grant-target">
                <span>Target before fee</span>
                <strong>{request.targetUsdc} USDC</strong>
              </div>
              <div className="hf-grant-actions">
                <a
                  href={request.projectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View project <ArrowUpRight size={14} />
                </a>
                <button
                  type="button"
                  onClick={() => onBackBuilder(request.handle)}
                >
                  Preview an envelope <ArrowRight size={14} />
                </button>
              </div>
              <small>
                Contributions open soon. X identity and project claims are not
                yet verified.
              </small>
            </article>
          ))}
        </div>
      </section>
      <section className="hf-grant-request-section" id="request-grant">
        <div>
          <p className="hf-landing-kicker">FOR BUILDERS ON ARC</p>
          <h2>Give people a reason to back you.</h2>
          <p>
            Explain the problem, show your progress, and name a specific
            milestone. A clear request helps a backer understand what their USDC
            will support.
          </p>
          <div className="hf-grant-fee-preview">
            <h3>Contribution fee · 1.5%</h3>
            <p>
              Deducted from each contribution to cover agent and infrastructure
              costs. The builder receives the remaining 98.5%. Network gas is
              separate.
            </p>
            <label htmlFor="grant-fee-amount">Try a contribution amount</label>
            <input
              id="grant-fee-amount"
              inputMode="decimal"
              value={contribution}
              onChange={(e) => setContribution(e.target.value)}
            />
            <dl>
              <div>
                <dt>Builder receives</dt>
                <dd>{costs?.amount ?? '—'} USDC</dd>
              </div>
              <div>
                <dt>Hopfast fee (1.5%)</dt>
                <dd>{costs?.fee ?? '—'} USDC</dd>
              </div>
            </dl>
            <small>Fee preview only. No contribution is submitted.</small>
          </div>
        </div>
        <form className="hf-grant-request-form" onSubmit={submit}>
          <h3>Request a micro-grant</h3>
          <label htmlFor="grant-title">Project name</label>
          <input
            id="grant-title"
            name="title"
            required
            minLength={3}
            maxLength={80}
            placeholder="Your Arc project"
          />
          <label htmlFor="grant-handle">Your X handle</label>
          <input
            id="grant-handle"
            name="handle"
            required
            maxLength={16}
            placeholder="@your_handle"
          />
          <label htmlFor="grant-link">Project or demo link</label>
          <input
            id="grant-link"
            name="projectUrl"
            required
            type="url"
            maxLength={500}
            placeholder="https://…"
            pattern="https://.*"
          />
          <label htmlFor="grant-description">
            What are you building on Arc?
          </label>
          <textarea
            id="grant-description"
            name="description"
            required
            minLength={30}
            maxLength={1200}
            rows={4}
            placeholder="The problem, who it helps, and what works today."
          />
          <label htmlFor="grant-milestone">
            What will this grant help you ship?
          </label>
          <textarea
            id="grant-milestone"
            name="milestone"
            required
            minLength={15}
            maxLength={600}
            rows={3}
            placeholder="A concrete milestone and how you’ll use the funds."
          />
          <label htmlFor="grant-target">USDC target</label>
          <input
            id="grant-target"
            name="targetUsdc"
            required
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,6})?"
            placeholder="500"
          />
          <small>
            Posting adds your project and X handle to this board. Contributions
            open soon.
          </small>
          {error && (
            <p className="hf-note hf-note-error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="hf-grant-saved" role="status">
              Your request is on the board.
            </p>
          )}
          <button
            className="hf-landing-primary"
            type="submit"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Post your request'} <ArrowRight size={16} />
          </button>
        </form>
      </section>
    </main>
  );
}
