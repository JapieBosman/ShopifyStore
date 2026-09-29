import Link from "next/link";
import { notFound } from "next/navigation";

const modules: Record<string, { title: string; description: string }> = {
  statements: {
    title: "Statements",
    description: "Statement previews and delivery controls will appear after the ledger and PDF workflow are verified.",
  },
  "cash-office": {
    title: "Cash office",
    description: "Opening floats, drops, blind counts and variance review are planned for this suite.",
  },
  pricing: {
    title: "Trade pricing",
    description: "Account pricing and quantity rules are planned after Shopify price application is proven.",
  },
  jobs: {
    title: "Workshop jobs",
    description: "Job cards are a later module of the same subscription.",
  },
};

export function generateStaticParams() {
  return Object.keys(modules).map((module) => ({ module }));
}

export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  const content = modules[module];
  if (!content) {
    notFound();
  }
  return (
    <>
      <p className="eyebrow">Development preview</p>
      <h1>{content.title}</h1>
      <p className="lead">{content.description}</p>
      <Link className="back" href="/">Return to overview</Link>
    </>
  );
}
