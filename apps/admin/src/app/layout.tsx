import type { Metadata } from "next";
import Link from "next/link";
import "./styles.css";

export const metadata: Metadata = {
  title: "Genesis for Shopify",
  description: "Trade operations for Shopify",
};

const sections = [
  { path: "/", label: "Overview" },
  { path: "/accounts", label: "Trade Accounts" },
  { path: "/allocations", label: "Allocations" },
  { path: "/onboarding", label: "Onboarding" },
  { path: "/statements", label: "Statements" },
  { path: "/cash-office", label: "Cash office" },
  { path: "/pricing", label: "Trade pricing" },
  { path: "/jobs", label: "Workshop jobs" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <p className="brand">Genesis for Shopify</p>
            <p className="caption">One connected retail suite</p>
            <nav aria-label="Main navigation">
              {sections.map((section) => (
                <Link href={section.path} key={section.path}>
                  {section.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
