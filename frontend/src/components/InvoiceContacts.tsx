import { Check, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { LoadingSpinner } from './Loading';
import type { Billing, Business, SavedClient } from '../services/invoiceService';

export function BillingFields({ value, onChange, label, disabled = false }: {
  value: Billing; onChange: (value: Billing) => void; label: string; disabled?: boolean;
}) {
  return <fieldset className="hf-invoice-fields" disabled={disabled}><legend>{label}</legend>
    <label><span className="hf-invoice-field-label">Name</span><input required maxLength={160} value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="Name or business name" /></label>
    <label><span className="hf-invoice-field-label">Email <small>optional</small></span><input type="email" maxLength={254} value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} placeholder="name@example.com" /></label>
    <label className="hf-invoice-wide"><span className="hf-invoice-field-label">Billing address <small>optional</small></span><textarea maxLength={800} value={value.address} onChange={e => onChange({ ...value, address: e.target.value })} placeholder="Street, city, country and postal code" rows={2} /></label>
  </fieldset>;
}

export function InvoiceClients({ business, busy, onBusiness, onAdd, onEdit, onDelete, onSelect }: {
  business: Business; busy: boolean; onBusiness: () => void; onAdd: () => void;
  onEdit: (client: SavedClient) => void; onDelete: (client: SavedClient) => void; onSelect?: (client: SavedClient) => void;
}) {
  return <section className="hf-invoice-paper">
    <div className="hf-invoice-form-actions">
      <button type="button" className="hf-invoice-secondary" disabled={busy} onClick={onBusiness}><Settings2 size={16} /> Edit business details</button>
      <button type="button" className="hf-invoice-primary" disabled={busy || business.clients.length >= 100} onClick={onAdd}><Plus size={16} /> Add client</button>
    </div>
    <div className="hf-invoice-client-list">
      <h3>Saved clients ({business.clients.length})</h3>
      {!business.clients.length && <p className="hf-invoice-small">No saved clients yet. Add a client once to reuse their billing details on future invoices.</p>}
      {business.clients.map(client => <div key={client.id}>
        <span><strong>{client.name}</strong>{client.email && <small>{client.email}</small>}{client.address && <small style={{ whiteSpace: 'pre-line' }}>{client.address}</small>}</span>
        <div className="hf-invoice-client-actions">
          {onSelect && <button type="button" disabled={busy} className="hf-invoice-secondary" onClick={() => onSelect(client)}><Check size={16} /> Use client</button>}
          <button type="button" disabled={busy} className="hf-invoice-secondary" aria-label={`Edit ${client.name}`} onClick={() => onEdit(client)}><Pencil size={16} /> Edit</button>
          <button type="button" disabled={busy} className="hf-invoice-secondary" aria-label={`Delete saved client ${client.name}`} onClick={() => onDelete(client)}><Trash2 size={16} /></button>
        </div>
      </div>)}
    </div>
    <p className="hf-invoice-small">Client changes are saved immediately. Existing invoices keep their original billing details.</p>
  </section>;
}

export function InvoiceBillingForm({ value, busy, onChange, onSave }: {
  value: Billing; busy: boolean; onChange: (value: Billing) => void; onSave: () => void;
}) {
  return <form className="hf-invoice-paper" onSubmit={e => { e.preventDefault(); onSave(); }}>
    <BillingFields value={value} label="Your business" onChange={onChange} disabled={busy} />
    <p className="hf-invoice-small">Saved for your future invoices. Published invoices keep the details they were issued with.</p>
    <div className="hf-invoice-form-actions"><button className="hf-invoice-primary" disabled={busy}>{busy ? 'Saving…' : 'Save business details'} {busy ? <LoadingSpinner /> : <Check size={16} />}</button></div>
  </form>;
}
