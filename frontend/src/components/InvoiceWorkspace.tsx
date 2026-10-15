import { BillingFields, InvoiceBillingForm, InvoiceClients } from './InvoiceContacts';
import { blankInvoice, emptyBilling, billingOnly, normalizeBusiness, invoicePreview, invoiceToday as today } from '../lib/invoiceDraft';
import { TransientError } from './TransientError';
import { LoadingSpinner, LoadingState } from './Loading';
import { UsdcAmount } from './UsdcAmount';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Download, FileText, Plus, Settings2, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { isAddress, keccak256, stringToHex } from 'viem';
import { invoiceApi, invoiceLogin, invoiceWrite, usdc, type Billing, type Business, type InvoiceConfig, type InvoiceInput, type InvoiceRecord, type PaymentAuthorization, type SavedClient, type InvoiceWorkspaceSummary } from '../services/invoiceService';
import type { PrivyWalletBridge } from './WalletConnector';

export function InvoiceWorkspace({ wallet, onConnect, onReceive, active = true }: { wallet: PrivyWalletBridge | null; onConnect?: () => void; onReceive?: () => void; active?: boolean }) {
  const publicId = new URLSearchParams(location.search).get('invoice');
  const address = wallet?.address.toLowerCase();
  const [session, setSession] = useState('');
  const [business, setBusiness] = useState<Business>(() => normalizeBusiness(null));
  const [businessDraft, setBusinessDraft] = useState<Billing>({ ...emptyBilling });
  const [clientDraft, setClientDraft] = useState<Billing>({ ...emptyBilling });
  const [clientId, setClientId] = useState('');
  const [editingClient, setEditingClient] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [draft, setDraft] = useState<InvoiceInput>(() => blankInvoice());
  const [autoNumber, setAutoNumber] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hasIdentity, setHasIdentity] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [page, setPage] = useState(0), [hasMore, setHasMore] = useState(false);
  const [admin, setAdmin] = useState(false), [adminMode, setAdminMode] = useState(false);
  const [selected, setSelected] = useState<InvoiceRecord | null>(null);
  type Screen = 'list' | 'settings' | 'business' | 'client' | 'create' | 'detail';
  const [screen, setScreen] = useState<Screen>(publicId ? 'detail' : 'list');
  const [returnScreen, setReturnScreen] = useState<Screen>('list');
  const [clientsReturnScreen, setClientsReturnScreen] = useState<'list' | 'create'>('list');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const walletRef = useRef(address); walletRef.current = address;
  const operationRef = useRef(0), busyRef = useRef(false);
  const initialDraftRef = useRef('');
  const workspaceRef = useRef<HTMLElement>(null);
  const preview = invoicePreview(draft);

  useEffect(() => {
    // Each internal page starts below the modal heading, rather than inheriting
    // a long form's scroll offset and hiding the next page's navigation.
    if (active) workspaceRef.current?.closest<HTMLElement>('.hf-support-modal')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [screen, active]);

  useEffect(() => {
    ++operationRef.current; busyRef.current = false;
    setSession(''); setBusy(false); setInvoices([]); setBusiness(normalizeBusiness(null));
    setBusinessDraft({ ...emptyBilling }); setClientDraft({ ...emptyBilling }); setDraft(blankInvoice());
    setSelectedClientId(''); setEditingId(null); setHasIdentity(false); setPage(0); setHasMore(false);
    setAdmin(false); setAdminMode(false); setError(''); setNotice('');
    // Published invoice details remain open during wallet reconnects and switches.
    if (!publicId && !(screen === 'detail' && selected?.handle && selected.state !== 'draft')) {
      setSelected(null); setScreen('list');
    }
  }, [address, publicId]);

  useEffect(() => {
    if (!active || !session || busyRef.current) return;
    let current = true;
    const operation = operationRef.current;
    // Returning from Receive must pick up a newly verified Hopfast ID, without
    // replacing the invoice or business/client form the user is working on.
    invoiceApi<InvoiceWorkspaceSummary>('/workspace', session).then(result => {
      if (current && operationRef.current === operation) applyWorkspace(result);
    }).catch(cause => {
      if (current && operationRef.current === operation) setError(cause instanceof Error ? cause.message : 'Could not refresh invoice setup.');
    });
    return () => { current = false; };
  }, [active, session, address]);

  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    const expected = walletRef.current, operation = ++operationRef.current;
    const current = () => walletRef.current === expected && operationRef.current === operation;
    setBusy(true); setError(''); setNotice('');
    try { await action(current); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { if (current()) { busyRef.current = false; setBusy(false); } }
  }
  async function load(token: string, nextPage = page, all = adminMode) {
    const expected = walletRef.current, operation = operationRef.current;
    const result = await invoiceApi<{ invoices: InvoiceRecord[]; hasMore: boolean }>('/' + (all ? 'admin' : 'mine') + '?page=' + nextPage, token);
    if (walletRef.current !== expected || operationRef.current !== operation) return;
    setInvoices(result.invoices); setHasMore(result.hasMore); setPage(nextPage);
  }
  function applyWorkspace(result: InvoiceWorkspaceSummary) {
    const details = normalizeBusiness(result.details);
    setBusiness(details); setHasIdentity(Boolean(result.handle));
    setSelectedClientId(id => details.clients.some(client => client.id === id) ? id : '');
    return details;
  }
  async function unlock() {
    if (!wallet) return onConnect?.();
    await perform(async current => {
      const token = await invoiceLogin(wallet);
      if (!current()) return;
      const [result, config] = await Promise.all([invoiceApi<InvoiceWorkspaceSummary>('/workspace', token), invoiceApi<InvoiceConfig>('/config')]);
      if (!current()) return;
      applyWorkspace(result); setAdmin(config.admin.toLowerCase() === wallet.address.toLowerCase());
      setAdminMode(false); setSession(token); await load(token, 0, false);
    });
  }
  function openBusiness(from: Screen = screen) {
    setBusinessDraft(billingOnly(business)); setReturnScreen(from); setError(''); setNotice(''); setScreen('business');
  }
  function openClient(client?: SavedClient, from: Screen = screen) {
    setEditingClient(Boolean(client)); setClientId(client?.id ?? crypto.randomUUID());
    setClientDraft(client ? billingOnly(client) : from === 'create' && !selectedClientId ? billingOnly(draft.client) : { ...emptyBilling });
    setReturnScreen(from); setError(''); setNotice(''); setScreen('client');
  }
  async function openClients(from: 'list' | 'create') {
    await perform(async current => {
      const result = await invoiceApi<InvoiceWorkspaceSummary>('/workspace', session);
      if (!current()) return;
      applyWorkspace(result); setClientsReturnScreen(from); setScreen('settings');
    });
  }
  async function saveBusiness() {
    await perform(async current => {
      const result = await invoiceApi<{ details: Business }>('/business', session, businessDraft, 'PUT');
      if (!current()) return;
      setBusiness(normalizeBusiness(result.details)); setScreen(returnScreen); setNotice('Business details saved.');
    });
  }
  async function saveClient() {
    await perform(async current => {
      const result = await invoiceApi<{ details: Business; client: SavedClient }>(editingClient ? `/clients/${clientId}` : '/clients', session, editingClient ? clientDraft : { ...clientDraft, id: clientId }, editingClient ? 'PUT' : 'POST');
      if (!current()) return;
      setBusiness(normalizeBusiness(result.details));
      if (returnScreen === 'create' || selectedClientId === result.client.id) {
        setSelectedClientId(result.client.id); setDraft(previous => ({ ...previous, client: billingOnly(result.client) }));
      }
      setScreen(returnScreen); setNotice(editingClient ? 'Client updated.' : 'Client saved.');
    });
  }
  async function deleteClient(client: SavedClient) {
    if (!window.confirm(`Delete ${client.name} from your saved clients? Existing invoices will keep their client details.`)) return;
    await perform(async current => {
      const result = await invoiceApi<{ details: Business }>(`/clients/${client.id}`, session, undefined, 'DELETE');
      if (!current()) return;
      setBusiness(normalizeBusiness(result.details));
      if (selectedClientId === client.id) setSelectedClientId('');
      setNotice('Saved client deleted. Existing invoices are unchanged.');
    });
  }
  async function startInvoice() {
    await perform(async current => {
      const result = await invoiceApi<InvoiceWorkspaceSummary>('/workspace', session);
      if (!current()) return;
      applyWorkspace(result); setEditingId(null); setSelectedClientId(''); setAutoNumber(Boolean(result.nextNumber));
      const next = blankInvoice(result.nextNumber);
      initialDraftRef.current = JSON.stringify(next);
      setDraft(next); setScreen('create');
    });
  }
  async function saveDraft() {
    await perform(async current => {
      const result = await invoiceApi<{ invoice: InvoiceRecord }>(editingId ? `/${editingId}` : '', session, { ...draft, ...(!editingId && autoNumber ? { autoNumber: true } : {}) }, editingId ? 'PUT' : 'POST');
      if (!current()) return;
      setSelected(result.invoice); setScreen('detail'); await load(session, 0);
    });
  }
  async function publish(invoice: InvoiceRecord) {
    await perform(async current => {
      const result = await invoiceApi<{ invoice: InvoiceRecord }>(`/${invoice.invoiceId}/publish`, session, {});
      if (!current()) return;
      setSelected(result.invoice); await load(session);
    });
  }
  async function cancel(invoice: InvoiceRecord) {
    if (!window.confirm('Cancel this unpaid invoice?')) return;
    await perform(async current => {
      const result = await invoiceApi<{ invoice: InvoiceRecord }>(`/${invoice.invoiceId}/cancel`, session, {});
      if (!current()) return;
      setSelected(result.invoice); setScreen('list'); await load(session);
    });
  }
  async function deleteCancelled(invoice: InvoiceRecord) {
    if (!window.confirm(`Permanently delete invoice ${invoice.input.number}? Its details will be removed from the database and its shared link will stop working. This cannot be undone.`)) return;
    await perform(async current => {
      await invoiceApi(`/${invoice.invoiceId}`, session, undefined, 'DELETE');
      if (!current()) return;
      if (selected?.invoiceId === invoice.invoiceId) setSelected(null);
      setScreen('list'); await load(session, 0);
    });
  }
  function back() {
    if (screen === 'create' && JSON.stringify(draft) !== initialDraftRef.current && !window.confirm('Leave this unsaved invoice? Save and review the draft first to keep it.')) return;
    setError(''); setNotice(''); setScreen(screen === 'business' || screen === 'client' ? returnScreen : screen === 'settings' ? clientsReturnScreen : 'list');
  }

  if (publicId || (screen === 'detail' && selected?.state !== 'draft' && selected?.handle)) return <div className="hf-invoice-workspace">
    {!publicId && <button className="hf-invoice-back" onClick={() => setScreen('list')}><ArrowLeft size={16} /> Your invoices</button>}
    <InvoiceCheckout id={publicId ?? selected!.invoiceId} wallet={wallet} onConnect={onConnect} />
  </div>;
  if (!session) return <section className="hf-invoice-welcome"><div className="hf-invoice-symbol hf-invoice-symbol-art" aria-hidden="true"><svg viewBox="0 0 96 96" fill="none"><rect x="24" y="15" width="46" height="62" rx="9" fill="#E8B17F" opacity=".35" transform="rotate(10 24 15)"/><path d="M24 17a7 7 0 0 1 7-7h24l15 15v47a7 7 0 0 1-7 7H31a7 7 0 0 1-7-7V17Z" fill="#FFFCF7" stroke="#CE6C2C" strokeWidth="2"/><path d="M55 10v11a4 4 0 0 0 4 4h11M35 33h22M35 42h15M35 55h8M35 63h13" stroke="#CE6C2C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M53 55h5" stroke="#CE6C2C" strokeWidth="2.5" strokeLinecap="round"/><circle cx="69" cy="69" r="20" fill="#fff"/><image href="/token-icons/usdc.svg" x="52" y="52" width="34" height="34"/><path d="m79 12 1.5 4.5L85 18l-4.5 1.5L79 24l-1.5-4.5L73 18l4.5-1.5L79 12Z" fill="#DF8C49"/></svg></div><h2>Your work. A clear way to get paid.</h2><p>Create a detailed invoice, share a link, and collect USDC on Arc. Save your billing details and clients for the next one.</p><button className="hf-invoice-primary" disabled={busy} onClick={() => void unlock()}>{busy ? 'Unlocking…' : wallet ? 'Unlock your invoices' : 'Connect wallet'} {busy ? <LoadingSpinner size={17} /> : <ArrowRight size={17} />}</button><p className="hf-invoice-small">Sharing requires a Hopfast ID. Create yours in Receive.</p><TransientError className="hf-support-error" message={error} /></section>;

  const headings = { list: 'Your invoices', settings: 'Billing & clients', business: 'Your business details', client: editingClient ? 'Edit saved client' : 'Add a client', create: 'Create an invoice', detail: 'Invoice draft' };
  return <section className="hf-invoice-workspace" ref={workspaceRef}>
    <header className="hf-invoice-toolbar"><div><h2>{headings[screen]}</h2><p>{screen === 'list' ? 'From first draft to payment in your wallet.' : screen === 'client' ? 'Save their details once. Reuse them on your next invoice.' : 'USDC on Arc. Details your client can understand.'}</p></div><div>
      {screen !== 'list' && <button className="hf-invoice-secondary" disabled={busy} onClick={back}><ArrowLeft size={16} /> Back</button>}
      {screen === 'list' && <>
        {admin && <button className="hf-invoice-secondary" disabled={busy} onClick={() => void perform(async current => { await load(session, 0, !adminMode); if (current()) setAdminMode(!adminMode); })}>{adminMode ? 'My invoices' : 'Admin invoices'}</button>}
        <button className="hf-invoice-secondary" disabled={busy} onClick={() => openBusiness('list')}><Settings2 size={16} /> Business details</button>
        <button className="hf-invoice-secondary" disabled={busy} onClick={() => void openClients('list')}>Clients ({business.clients.length})</button>
        <button className="hf-invoice-primary" disabled={busy} onClick={() => void startInvoice()}>{busy ? <LoadingSpinner /> : <Plus size={16} />} New invoice</button>
      </>}
    </div></header>
    <TransientError className="hf-support-error" message={error} />
    {notice && <p className="hf-invoice-notice" role="status">{notice}</p>}
    {['list', 'create', 'detail'].includes(screen) && (!business.name.trim() || !hasIdentity) && <div className="hf-invoice-setup-prompt">
      <p className="hf-invoice-small">You can save a draft now. Before publishing, complete your business details and create a Hopfast ID.</p>
      {!business.name.trim() && <button className="hf-invoice-secondary" disabled={busy} onClick={() => openBusiness()}><Settings2 size={16} /> Add business details</button>}
      {!hasIdentity && onReceive && <button className="hf-invoice-secondary" disabled={busy} onClick={onReceive}>Create your Hopfast ID <ArrowRight size={16} /></button>}
    </div>}
    {screen === 'list' && !business.clients.length && <div className="hf-invoice-setup-prompt"><p className="hf-invoice-small">Save a client now to have their billing details ready when you create an invoice.</p><button className="hf-invoice-secondary" disabled={busy} onClick={() => openClient(undefined, 'list')}><Plus size={16} /> Add your first client</button></div>}
    {screen === 'settings' && <InvoiceClients business={business} busy={busy} onBusiness={() => openBusiness('settings')} onAdd={() => openClient(undefined, 'settings')} onEdit={client => openClient(client, 'settings')} onDelete={client => void deleteClient(client)} onSelect={clientsReturnScreen === 'create' ? client => { setSelectedClientId(client.id); setDraft(previous => ({ ...previous, client: billingOnly(client) })); setScreen('create'); } : undefined} />}
    {screen === 'business' && <InvoiceBillingForm value={businessDraft} busy={busy} onChange={setBusinessDraft} onSave={() => void saveBusiness()} />}
    {screen === 'client' && <form className="hf-invoice-paper" onSubmit={e => { e.preventDefault(); void saveClient(); }}>
      <BillingFields value={clientDraft} label="Client details" onChange={setClientDraft} disabled={busy} />
      <div className="hf-invoice-form-actions"><button className="hf-invoice-primary" disabled={busy || !clientDraft.name.trim()}>{busy ? 'Saving…' : editingClient ? 'Save client changes' : 'Save client'} {busy ? <LoadingSpinner /> : <Check size={16} />}</button>
      <button type="button" className="hf-invoice-secondary" disabled={busy} onClick={() => void openClients(returnScreen === 'create' ? 'create' : 'list')}>View saved clients ({business.clients.length})</button>
      </div>
    </form>}
    {screen === 'create' && <form className="hf-invoice-paper" onSubmit={e => { e.preventDefault(); void saveDraft(); }}>
      <fieldset className="hf-invoice-fields" disabled={busy}>
        <label>Invoice number<input required maxLength={60} placeholder="INV-001" value={draft.number} onChange={e => { setAutoNumber(false); setDraft({ ...draft, number: e.target.value }); }} /></label>
        <label>Saved client<select value={selectedClientId} onChange={e => { setSelectedClientId(e.target.value); const client = business.clients.find(c => c.id === e.target.value); setDraft({ ...draft, client: client ? billingOnly(client) : { ...emptyBilling } }); }}><option value="">{business.clients.length ? 'Choose a client or enter below' : 'Enter client details below'}</option>{business.clients.map(client => <option value={client.id} key={client.id}>{client.name}{client.email ? ` · ${client.email}` : ''}</option>)}</select></label>
        <label>Issue date<input required type="date" value={draft.issueDate} onChange={e => setDraft({ ...draft, issueDate: e.target.value, dueDate: draft.dueDate < e.target.value ? e.target.value : draft.dueDate })} /></label>
        <label>Due date<input required type="date" min={draft.issueDate} value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} /></label>
      </fieldset>
      <div className="hf-invoice-setup-prompt"><p className="hf-invoice-small">{business.clients.length ? 'Choose a saved client to fill their name, email and address.' : 'No saved clients yet. Add one now, or enter details below for this invoice only.'}</p><button type="button" className="hf-invoice-secondary" disabled={busy || business.clients.length >= 100} onClick={() => openClient(undefined, 'create')}><Plus size={16} /> Add client</button><button type="button" className="hf-invoice-secondary" disabled={busy} onClick={() => void openClients('create')}>View saved clients</button></div>
      <BillingFields value={draft.client} label="Bill to" onChange={client => { setSelectedClientId(''); setDraft({ ...draft, client }); }} disabled={busy} />
      <h3>Invoice items</h3><div className="hf-invoice-line-head"><span>Description</span><span>Quantity</span><span>Rate · USDC</span></div>
      {draft.lines.map((line, index) => <div className="hf-invoice-line" key={index}>
        <input aria-label={`Item ${index + 1} description`} required maxLength={500} placeholder="Design, development, consulting…" value={line.description} disabled={busy} onChange={e => setDraft({ ...draft, lines: draft.lines.map((l, i) => i === index ? { ...l, description: e.target.value } : l) })} />
        <input aria-label={`Item ${index + 1} quantity`} required inputMode="decimal" pattern="[0-9]{1,5}(\.[0-9]{1,3})?" value={line.quantity} disabled={busy} onChange={e => setDraft({ ...draft, lines: draft.lines.map((l, i) => i === index ? { ...l, quantity: e.target.value } : l) })} />
        <input aria-label={`Item ${index + 1} rate`} required inputMode="decimal" placeholder="0.00" pattern="[0-9]{1,7}(\.[0-9]{1,6})?" value={line.rate} disabled={busy} onChange={e => setDraft({ ...draft, lines: draft.lines.map((l, i) => i === index ? { ...l, rate: e.target.value } : l) })} />
        <button type="button" aria-label={`Remove item ${index + 1}`} disabled={busy || draft.lines.length === 1} onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
      </div>)}
      <button type="button" className="hf-invoice-secondary" disabled={busy || draft.lines.length >= 50} onClick={() => setDraft({ ...draft, lines: [...draft.lines, { description: '', quantity: '1', rate: '' }] })}><Plus size={16} /> Add item</button>
      <div className="hf-invoice-fields"><label>Discount · USDC<input inputMode="decimal" value={draft.discount} disabled={busy} onChange={e => setDraft({ ...draft, discount: e.target.value })} /></label><label>Tax · %<input type="number" min="0" max="100" step="0.01" value={draft.taxBps / 100} disabled={busy} onChange={e => setDraft({ ...draft, taxBps: Math.round(Number(e.target.value) * 100) })} /></label><label className="hf-invoice-wide"><span className="hf-invoice-field-label">Notes <small>optional</small></span><textarea maxLength={2000} placeholder="Project references or payment instructions" value={draft.notes} disabled={busy} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label></div>
      {preview ? <dl className="hf-invoice-totals" aria-live="polite"><div><dt>Subtotal</dt><dd><UsdcAmount value={usdc(preview.subtotal)} /></dd></div>{preview.discount > 0n && <div><dt>Discount</dt><dd><UsdcAmount value={`−${usdc(preview.discount)}`} /></dd></div>}{preview.tax > 0n && <div><dt>Tax</dt><dd><UsdcAmount value={usdc(preview.tax)} /></dd></div>}<div><dt>Total</dt><dd><UsdcAmount value={usdc(preview.total)} /></dd></div></dl> : <p className="hf-invoice-small">Enter positive quantities and rates to see the total. Discount cannot exceed the subtotal.</p>}
      <p className="hf-invoice-small">Review the calculated total before publishing. Billing details appear on the shared invoice.</p>
      <div className="hf-invoice-form-actions"><button className="hf-invoice-primary" disabled={busy || !preview}>{busy ? 'Saving…' : 'Save and review draft'} {busy ? <LoadingSpinner /> : <ArrowRight size={16} />}</button></div>
    </form>}
    {screen === 'detail' && selected && <><InvoicePaper invoice={{ ...selected, billing: billingOnly(business) }} />{selected.state === 'draft' && <><div className="hf-invoice-actions"><button className="hf-invoice-primary" disabled={busy || !business.name.trim() || !hasIdentity} onClick={() => void publish(selected)}>{busy ? 'Publishing…' : 'Publish invoice'} {busy ? <LoadingSpinner /> : <ArrowRight size={16} />}</button><button className="hf-invoice-secondary" disabled={busy} onClick={() => { setEditingId(selected.invoiceId); setAutoNumber(false); setSelectedClientId(business.clients.find(client => client.name === selected.input.client.name && client.email === selected.input.client.email && client.address === selected.input.client.address)?.id ?? ''); const next = structuredClone(selected.input); initialDraftRef.current = JSON.stringify(next); setDraft(next); setScreen('create'); }}>Edit draft</button><button className="hf-invoice-secondary" disabled={busy} onClick={() => void cancel(selected)}>Discard draft</button></div><p className="hf-invoice-small">Publishing locks the amount, client details and receiving wallet. Your saved draft stays here if checkout is not configured yet.</p></>}</>}
    {screen === 'list' && <>{busy && !invoices.length ? <LoadingState label="Loading invoices…" /> : <div className="hf-invoice-list">{invoices.length ? invoices.map(invoice => <div className="hf-invoice-row" key={invoice.invoiceId}><button disabled={busy} onClick={() => { setSelected(invoice); setScreen('detail'); }}><FileText size={20} /><span><strong>{invoice.input.number}</strong><small>{invoice.input.client.name} · due {invoice.input.dueDate}</small></span><span className={`hf-invoice-status hf-invoice-status-${invoice.state}`}>{invoice.state}</span><strong><UsdcAmount value={usdc(invoice.totals.total)} /></strong><ArrowRight size={16} /></button>{invoice.state === 'cancelled' && invoice.owner === address && <button className="hf-invoice-delete" disabled={busy} aria-label={`Permanently delete invoice ${invoice.input.number}`} title="Permanently delete cancelled invoice" onClick={() => void deleteCancelled(invoice)}>{busy ? <LoadingSpinner size={17} /> : <Trash2 size={17} />}</button>}</div>) : <div className="hf-invoice-empty"><FileText size={28} /><h3>Your first invoice starts here.</h3><p>Save a client or enter their details while creating your invoice.</p></div>}</div>}<div className="hf-invoice-actions"><button className="hf-invoice-secondary" disabled={busy || page === 0} onClick={() => void perform(() => load(session, page - 1))}>Previous</button><button className="hf-invoice-secondary" disabled={busy || !hasMore} onClick={() => void perform(() => load(session, page + 1))}>Next</button><button className="hf-invoice-secondary" disabled={busy} onClick={() => void perform(() => load(session))}>{busy ? <><LoadingSpinner /> Updating…</> : 'Refresh status'}</button></div></>}
  </section>;
}

function InvoicePaper({ invoice }: { invoice: InvoiceRecord }) {
  return <article className="hf-invoice-paper"><header className="hf-invoice-document-header"><div><img src="/brand/hopfast-mark.svg" alt="Hopfast" /><h2>Invoice {invoice.input.number}</h2>{invoice.handle && <span>{invoice.handle}@hopfast</span>}</div><span className={`hf-invoice-status hf-invoice-status-${invoice.state}`}>{invoice.state}</span></header>
    <div className="hf-invoice-parties"><div><h3>From</h3><strong>{invoice.billing?.name ?? 'Your saved billing details'}</strong><p>{invoice.billing?.address}</p><p>{invoice.billing?.email}</p></div><div><h3>Bill to</h3><strong>{invoice.input.client.name}</strong><p>{invoice.input.client.address}</p><p>{invoice.input.client.email}</p></div><div><h3>Dates</h3><p>Issued {invoice.input.issueDate}</p><p>Due {invoice.input.dueDate}</p>{invoice.state === 'open' && invoice.input.dueDate < today() && <span>Overdue</span>}</div></div>
    <div className="hf-invoice-table-scroll"><table><thead><tr><th>Description</th><th>Qty</th><th>Rate · USDC</th><th>Amount · USDC</th></tr></thead><tbody>{invoice.input.lines.map((line, i) => <tr key={i}><td>{line.description}</td><td>{line.quantity}</td><td><UsdcAmount value={line.rate} /></td><td><UsdcAmount value={usdc(invoice.totals.lineTotals[i])} /></td></tr>)}</tbody></table></div>
    <dl className="hf-invoice-totals"><div><dt>Subtotal</dt><dd><UsdcAmount value={usdc(invoice.totals.subtotal)} /></dd></div>{BigInt(invoice.totals.discount) > 0n && <div><dt>Discount</dt><dd><UsdcAmount value={`−${usdc(invoice.totals.discount)}`} /></dd></div>}{BigInt(invoice.totals.tax) > 0n && <div><dt>Tax</dt><dd><UsdcAmount value={usdc(invoice.totals.tax)} /></dd></div>}<div><dt>Total</dt><dd><UsdcAmount value={usdc(invoice.totals.total)} /></dd></div></dl>
    {invoice.input.notes && <div className="hf-invoice-notes"><h3>Notes</h3><p>{invoice.input.notes}</p></div>}
  </article>;
}

function InvoiceCheckout({ id, wallet, onConnect }: { id: string; wallet: PrivyWalletBridge | null; onConnect?: () => void }) {
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null), [config, setConfig] = useState<InvoiceConfig | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [review, setReview] = useState(false);
  const [recoveryRecipient, setRecoveryRecipient] = useState(''), [recoveryReason, setRecoveryReason] = useState('');
  const addressRef = useRef(wallet?.address.toLowerCase()); addressRef.current = wallet?.address.toLowerCase();
  async function refresh() { const result = await invoiceApi<{ invoice: InvoiceRecord }>(`/${id}`); setInvoice(result.invoice); }
  useEffect(() => { let active = true; setInvoice(null); setReview(false); setError(''); Promise.all([invoiceApi<{ invoice: InvoiceRecord }>(`/${id}`), invoiceApi<InvoiceConfig>('/config')]).then(([record, settings]) => { if (active) { setInvoice(record.invoice); setConfig(settings); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [id]);
  useEffect(() => { setReview(false); }, [wallet?.address]);
  useEffect(() => { if (!invoice || !['open', 'funded', 'cancelling'].includes(invoice.state)) return; const timer = setInterval(() => { if (document.visibilityState === 'visible' && !busy) void refresh().catch(() => {}); }, 20000); return () => clearInterval(timer); }, [id, invoice?.state, busy]);
  async function act(action: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); } finally { setBusy(false); } }
  async function pay() {
    if (!wallet || !invoice || !config) return;
    await act(async () => { const session = await invoiceLogin(wallet); if (addressRef.current !== wallet.address.toLowerCase()) throw new Error('Wallet changed. Review the payment again.'); const authorization = await invoiceApi<PaymentAuthorization>(`/${id}/authorize`, session, {});
      if (authorization.invoiceId !== invoice.invoiceId || authorization.issuer.toLowerCase() !== invoice.owner || authorization.payer.toLowerCase() !== wallet.address.toLowerCase() || authorization.amount !== invoice.totals.total || authorization.detailsHash !== invoice.detailsHash || authorization.contract.toLowerCase() !== invoice.contract) throw new Error('Invoice changed. Reload it before paying.');
      const txHash = await invoiceWrite(config, wallet, authorization.contract, 'pay', [authorization.invoiceId, authorization.issuer, BigInt(authorization.amount), authorization.detailsHash, BigInt(authorization.deadline), authorization.signature]);
      setReview(false); setNotice('Payment confirmed on Arc. The invoicer can now release it.'); await invoiceApi(`/${id}/confirm`, session, { txHash }); await refresh();
    });
  }
  async function release() { if (!wallet || !invoice?.contract || !config) return; await act(async () => { const session = await invoiceLogin(wallet); const txHash = await invoiceWrite(config, wallet, invoice.contract!, 'release', [invoice.invoiceId]); await invoiceApi(`/${id}/confirm`, session, { txHash }); await refresh(); setNotice('Payment released to your wallet.'); }); }
  async function recover() { if (!wallet || !invoice?.contract || !config || !isAddress(recoveryRecipient) || /^0x0{40}$/i.test(recoveryRecipient) || !recoveryReason.trim()) return; if (!window.confirm(`Recover the full escrowed payment to ${recoveryRecipient}? This cannot be undone.`)) return; await act(async () => { const session = await invoiceLogin(wallet); const txHash = await invoiceWrite(config, wallet, invoice.contract!, 'recover', [invoice.invoiceId, recoveryRecipient, keccak256(stringToHex(recoveryReason.trim()))]); await invoiceApi(`/${id}/confirm`, session, { txHash }); await refresh(); setNotice('Full escrowed payment recovered.'); }); }
  async function copy() { if (!invoice?.url) return; await act(async () => { await navigator.clipboard.writeText(invoice.url!); setNotice('Invoice link copied.'); }); }
  function receipt() { if (!invoice) return; const data = JSON.stringify({ type: 'Hopfast invoice receipt', invoiceNumber: invoice.input.number, invoiceId: invoice.invoiceId, invoicer: invoice.handle, client: invoice.input.client.name, totalUSDC: usdc(invoice.totals.total), state: invoice.state, payer: invoice.payer, contract: invoice.contract, paymentTransaction: invoice.fundedTx, settlementTransaction: invoice.settlementTx }, null, 2); const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `hopfast-invoice-${invoice.invoiceId.slice(2, 10)}.json`; a.click(); URL.revokeObjectURL(url); }
  if (!invoice) return error ? <div className="hf-invoice-empty"><FileText size={28} /><h3>Invoice unavailable</h3><TransientError message={error} /></div> : <LoadingState label="Loading invoice…" />;
  const issuer = wallet?.address.toLowerCase() === invoice.owner;
  const fee = (BigInt(invoice.totals.total) * 50n + 9999n) / 10000n;
  return <div className="hf-invoice-checkout"><InvoicePaper invoice={invoice} /><aside className="hf-invoice-pay-panel">
    {review ? <><h3>Review payment</h3><p>Invoice {invoice.input.number} for {invoice.handle}@hopfast.</p><dl><div><dt>You pay</dt><dd><UsdcAmount value={usdc(invoice.totals.total)} /></dd></div><div><dt><span tabIndex={0} className="hf-invoice-fee-hint">Hopfast fee · 0.5%<span role="tooltip">helps us keep the lights on and maintain the infra.</span></span></dt><dd><UsdcAmount value={usdc(fee)} /></dd></div><div><dt>Invoicer receives</dt><dd><UsdcAmount value={usdc(BigInt(invoice.totals.total) - fee)} /></dd></div></dl><p className="hf-invoice-small">Check the recipient, invoice details and total before confirming your payment.</p><details className="hf-invoice-small"><summary>How payment works</summary><p>Funds stay in escrow until the invoicer releases them. Hopfast’s administrator can recover funds still held in escrow. Network gas is separate.</p></details><button className="hf-invoice-primary" disabled={busy} onClick={() => void pay()}>{busy ? 'Follow the wallet prompts…' : 'Confirm in wallet'} {busy ? <LoadingSpinner /> : <ArrowRight size={16} />}</button><button className="hf-invoice-secondary" disabled={busy} onClick={() => setReview(false)}>Back to invoice</button></> : <>
      <h3>{invoice.state === 'paid' ? 'Payment complete' : invoice.state === 'funded' ? 'Payment received in escrow' : invoice.state === 'recovered' ? 'Funds recovered by admin' : invoice.state === 'cancelling' ? 'Cancellation in progress' : invoice.state === 'cancelled' ? 'Invoice cancelled' : 'Pay this invoice'}</h3>
      <p>{invoice.state === 'funded' ? 'The invoicer can release this payment to their linked wallet.' : invoice.state === 'paid' ? 'The invoicer has received the payment in their wallet on Arc.' : invoice.state === 'cancelling' ? 'Existing payment authorizations must expire before cancellation completes.' : invoice.state === 'recovered' ? 'This invoice cannot be paid or released again.' : 'USDC on Arc. Payment is tied to this invoice.'}</p>
      {invoice.url && <><div className="hf-invoice-qr"><QRCodeSVG value={invoice.url} size={170} level="M" marginSize={2} /></div><small>Scan to open this invoice</small><button className="hf-invoice-secondary" disabled={busy} onClick={() => void copy()}>{busy ? <LoadingSpinner /> : <Copy size={16} />} Copy invoice link</button></>}
      {invoice.state === 'open' && <button className="hf-invoice-primary" disabled={busy || !config?.configured} onClick={() => wallet ? setReview(true) : onConnect?.()}>{wallet ? 'Review payment' : 'Connect wallet to pay'} <ArrowRight size={16} /></button>}
      {invoice.state === 'funded' && issuer && <button className="hf-invoice-primary" disabled={busy} onClick={() => void release()}>{busy ? 'Releasing…' : 'Release to your wallet'} {busy ? <LoadingSpinner /> : <ArrowRight size={16} />}</button>}
      {invoice.state === 'paid' && <button className="hf-invoice-secondary" onClick={receipt}><Download size={16} /> Download receipt</button>}
      {invoice.state === 'funded' && wallet?.address.toLowerCase() === config?.admin.toLowerCase() && <div className="hf-invoice-admin"><h3>Admin recovery</h3><p>Recover the full amount still held for this invoice. The destination and reason hash are recorded onchain.</p><label>Recovery wallet<input value={recoveryRecipient} placeholder={invoice.payer || '0x…'} onChange={e => setRecoveryRecipient(e.target.value)} /></label><button className="hf-invoice-secondary" onClick={() => setRecoveryRecipient(invoice.payer || '')}>Use payer wallet</button><label>Reason<input maxLength={300} value={recoveryReason} placeholder="Reason for recovery" onChange={e => setRecoveryReason(e.target.value)} /></label><button className="hf-invoice-primary" disabled={busy || !isAddress(recoveryRecipient) || /^0x0{40}$/i.test(recoveryRecipient) || !recoveryReason.trim()} onClick={() => void recover()}>{busy ? <><LoadingSpinner /> Recovering…</> : 'Recover full funds'}</button></div>}
      {issuer && invoice.state === 'open' && <button className="hf-invoice-secondary" disabled={busy} onClick={() => void act(async () => { const session = await invoiceLogin(wallet!); await invoiceApi(`/${id}/cancel`, session, {}); await refresh(); })}>{busy ? <><LoadingSpinner /> Cancelling…</> : 'Cancel unpaid invoice'}</button>}
    </>}
    {invoice.fundedTx && <a className="hf-invoice-small" target="_blank" rel="noreferrer" href={`https://explorer.arc.io/tx/${invoice.fundedTx}`}>View payment transaction ↗</a>}{invoice.settlementTx && <a className="hf-invoice-small" target="_blank" rel="noreferrer" href={`https://explorer.arc.io/tx/${invoice.settlementTx}`}>View settlement transaction ↗</a>}
    {notice && <p className="hf-invoice-notice" role="status">{notice}</p>}<TransientError className="hf-support-error" message={error} />
  </aside></div>;
}
