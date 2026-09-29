# ADR 0000: Embedded application runtime

**Status:** Accepted for the development build, 2026-09-28.

The installed Shopify app lives at `apps/shopify/genesis-trade-suite`. It uses Shopify's React Router scaffold and official authentication/session library, with Polaris web components for App Home. The CLI-generated POS extension lives under that app's `extensions/trade-account` directory. This keeps one installable app and one CLI configuration.

The earlier `apps/admin` Next.js shell is a local visual prototype. It is not installed in DisplayDeck and must not become a second production administration app. New embedded pages belong in the React Router app. `apps/api`, `apps/worker`, and shared packages can evolve behind the same installed app as the domain and durability layers.

Reason: the official scaffold supplies an integrated install, embedded authentication, webhooks and POS extension workflow that has already been exercised on the owner's development store. The choice changes the original Next.js implementation detail, not the product boundary: this remains a wholly new Shopify web application using Genesis only as read-only rule reference.

Revisit only if a documented capability or deployment constraint makes the official scaffold unsuitable. Do not run two session stores or two Shopify app configurations in production.
