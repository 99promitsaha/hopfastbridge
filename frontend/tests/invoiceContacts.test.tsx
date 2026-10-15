import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillingFields, InvoiceClients } from '../src/components/InvoiceContacts';

// The standalone TS runner uses classic JSX; Vite supplies its own JSX runtime.
(globalThis as any).React = React;

test('saved client names and billing fields render as text, never executable markup', () => {
  const value = { name: '<img src=x onerror=alert(1)>', email: 'name@example.com', address: '<script>alert(1)</script>' };
  const fields = renderToStaticMarkup(<BillingFields value={value} label="Client details" onChange={() => {}} />);
  const list = renderToStaticMarkup(<InvoiceClients business={{ name: 'Freelancer', email: '', address: '', clients: [{ ...value, id: 'client-id' }] }} busy={false} onBusiness={() => {}} onAdd={() => {}} onEdit={() => {}} onDelete={() => {}} />);
  for (const html of [fields, list]) {
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;img'));
    assert.ok(html.includes('&lt;script&gt;'));
  }
});

test('billing labels keep optional hints in one label row and disable all fields while saving', () => {
  const fields = renderToStaticMarkup(<BillingFields value={{ name: '', email: '', address: '' }} label="Client details" onChange={() => {}} disabled />);
  assert.match(fields, /<fieldset[^>]*disabled/);
  assert.match(fields, /hf-invoice-field-label">Email <small>optional<\/small><\/span><input/);
  assert.match(fields, /hf-invoice-field-label">Billing address <small>optional<\/small><\/span><textarea/);
  assert.equal((fields.match(/<label/g) ?? []).length, 3);
});
