import { Code2, FileText, Store, ScanLine, Sparkles } from "lucide-react";

const releases = [
  {
    version: "1.0.1",
    icon: Code2,
    title: "USDC payments, built into your product.",
    description: "We want developers to use Hopfast without having to build a payment backend from scratch. An open-source API will let them create payment requests, collect USDC on Arc, and track when a payment settles from their own app.",
  },
  {
    version: "1.0.2",
    icon: FileText,
    title: "Work globally. Get paid in USDC.",
    description: "A freelancer should be able to send an invoice to a client anywhere and receive USDC. We’re planning invoices with a shareable payment link, a clear payment status, and a receipt when the work is paid for. The client’s starting token or chain should become less of a concern for the person getting paid.",
  },
  {
    version: "1.0.3",
    icon: Store,
    title: "A payment counter for every merchant.",
    description: "We want small businesses to accept crypto payments without explaining wallets and networks to every customer. A merchant will be able to share a checkout link or display a QR code, while collecting USDC on Arc and keeping a record of each sale.",
  },
  {
    version: "2.0.0",
    icon: ScanLine,
    title: "Make paying feel familiar.",
    description: "The next interface will bring sending, receiving, scanning, and payment history closer together. We want fewer steps between knowing who to pay and completing the payment, especially on a phone. Telegram contacts are also in the plan, alongside the X usernames and Hopfast IDs we support today.",
  },
  {
    version: "2.0.1",
    icon: Sparkles,
    title: "Recognise the people using Hopfast.",
    description: "We’re planning a points programme for people who make Hopfast part of how they pay and receive money. It should recognise real use and helpful referrals, with progress visible in the app. The rules and what points can be used for will be shared before it launches.",
  },
];

export function RoadmapView() {
  return (
    <main className="hf-content hf-roadmap" id="main-content">
      <header className="hf-roadmap-heading">
        <h1>What’s next for Hopfast?</h1>
        <p>Paying a person is the start. Next, we want to make USDC useful for the work you do, the products you build, and the business you run.</p>
      </header>
      <ol className="hf-roadmap-releases">
        {releases.map(({ version, icon: Icon, title, description }, index) => (
          <li className="hf-roadmap-release" key={version}>
            <div className="hf-roadmap-version">
              <span className="hf-roadmap-node"><Icon size={22} aria-hidden="true" /></span>
              <strong>Hopfast v{version}</strong>
              <span className="hf-roadmap-status">{index === 0 ? "Up next" : "Planned"}</span>
            </div>
            <article className="hf-roadmap-card">
              <h2>{title}</h2>
              <p>{description}</p>
            </article>
          </li>
        ))}
      </ol>
      <p className="hf-roadmap-note">This is our intended release order. Scope and version numbers may change as we build and learn from the people using Hopfast.</p>
    </main>
  );
}
