export default function HomePage() {
  return (
    <>
      <p className="eyebrow">Development preview</p>
      <h1>Trade operations, connected to Shopify</h1>
      <p className="lead">
        The financial engine and Shopify integration are being built. This
        preview contains no merchant data and cannot approve account sales.
      </p>
      <div className="cards">
        <section className="card">
          <h2>Debtors and statements</h2>
          <p>Accounts, allocations, ageing and month-end records are the first workflow.</p>
          <span className="status">In development</span>
        </section>
        <section className="card">
          <h2>Counter approval</h2>
          <p>Credit decisions will be linked to supported Shopify order flows.</p>
          <span className="status">Platform proof required</span>
        </section>
        <section className="card">
          <h2>One subscription</h2>
          <p>Cash office, trade pricing and workshop tools will join the same suite.</p>
          <span className="status">Planned</span>
        </section>
      </div>
    </>
  );
}
