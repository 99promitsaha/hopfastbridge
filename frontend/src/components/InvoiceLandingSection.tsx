import { ArrowRight, Check, FileText, Link2, UsersRound } from 'lucide-react';
import { UsdcAmount } from './UsdcAmount';

export function InvoiceLandingSection({ onCreate }: { onCreate: () => void }) {
  return <section className="hf-freelancer" aria-labelledby="freelancer-title">
    <div className="hf-freelancer-main">
      <div className="hf-freelancer-copy">
        <h2 id="freelancer-title">Invoice your work.<br /><span>Get paid in USDC.</span></h2>
        <p>For the projects you deliver and the clients you work with. Create a detailed invoice, share one link, and collect USDC on Arc in the wallet you control.</p>
        <button type="button" className="hf-invoice-primary" onClick={onCreate}>Create an invoice <ArrowRight size={17} /></button>
        <div className="hf-freelancer-saved"><UsersRound size={20} aria-hidden="true" /><p><strong>Your details, ready for the next project.</strong>Save your billing address and clients. Choose a saved client when you create your next invoice.</p></div>
      </div>
      <div className="hf-freelancer-art" role="img" aria-label="Example invoice for a 1,000 USDC project, with itemized work and a payment receipt">
        <div className="hf-freelancer-document">
          <div className="hf-freelancer-document-top"><img src="/brand/hopfast-mark.svg" alt="" /><FileText size={22} aria-hidden="true" /></div>
          <h3>Website design</h3><p>maya@hopfast</p>
          <div className="hf-freelancer-client"><span>From<strong>Maya Studio</strong></span><span>Bill to<strong>North Studio</strong></span></div>
          <div className="hf-freelancer-item"><span>Design &amp; prototyping</span><UsdcAmount value="750" /></div>
          <div className="hf-freelancer-item"><span>Developer handoff</span><UsdcAmount value="250" /></div>
          <div className="hf-freelancer-total"><span>Total</span><strong><UsdcAmount value="1,000" /></strong></div>
          <div className="hf-freelancer-link"><Link2 size={15} aria-hidden="true" /><span>One invoice. One shareable link.</span></div>
        </div>
        <div className="hf-freelancer-receipt"><span className="hf-freelancer-check"><Check size={19} aria-hidden="true" /></span><div><strong>Client payment confirmed</strong><span>Ready to release to your wallet</span></div><img src="/token-icons/usdc.svg" alt="" /></div>
        <small className="hf-freelancer-example">Illustrative invoice</small>
      </div>
    </div>
    <ol className="hf-freelancer-steps">
      <li><span className="hf-freelancer-step-number">1</span><div><h3>Create your invoice.</h3><p>Add your client, line items, quantities, rates and due date. Review the breakdown before publishing with your Hopfast ID.</p></div></li>
      <li><span className="hf-freelancer-step-number">2</span><div><h3>Share it with your client.</h3><p>They see the invoice details and total, connect their wallet, and approve the USDC payment on Arc.</p></div></li>
      <li><span className="hf-freelancer-step-number">3</span><div><h3>Release USDC to your wallet.</h3><p>Track the invoice from open to funded. Release the escrowed payment to your wallet and download a receipt once settled.</p></div></li>
    </ol>
  </section>;
}
