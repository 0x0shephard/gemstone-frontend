import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { activeChain } from '@/config/chains';
import { OPENSEA_COLLECTION_URL } from '@/lib/externalMarketplaces';

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Create your account',
    body: 'Sign up with your email. An account is what lets us deliver a physical stone to you.',
  },
  {
    title: 'Connect the wallet that holds the token',
    body: 'Connect it from the account menu and verify it with a signature. This proves the token is yours and costs no gas.',
  },
  {
    title: 'Open your gemstone',
    body: `Ownership is read from ${activeChain.name}, so a stone you bought elsewhere appears on its gem page with its custody and redemption details.`,
  },
  {
    title: 'Keep it, resell it, or redeem it',
    body: 'Choose Redeem physical gemstone on the gem page to have the stone delivered. We may ask for an identity check first. Redeeming retires the token.',
  },
];

const BEFORE_BUYING: string[] = [
  'OpenSea shows the details fixed when the stone was tokenized. Custody and redemption status change over time and are shown on the gem page here.',
  'A token that is being redeemed cannot be transferred, so a purchase of it fails instead of completing.',
  'Each token is one whole, specific stone, so compare the weight, grade and photographs of the exact token you are buying.',
];

/** Where the `external_url` in every new token's metadata sends an outside buyer. */
export default function OpenSeaBuyersPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <section className="space-y-3">
        <h2 className="text-[26px] font-semibold tracking-tight text-ink">
          Your token is a real gemstone
        </h2>
        <p className="text-[14px] leading-relaxed text-ink-muted">
          Every Digital Carat token stands for one physical stone in custody. Buying it on OpenSea
          makes you its owner. Nothing more is needed to hold or resell it, and the steps below get
          you ready to claim the stone.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          <Link to="/signup" className="text-emerald hover:underline">
            Create an account
          </Link>
          <Link to="/profile" className="text-emerald hover:underline">
            Go to your profile
          </Link>
          {!activeChain.testnet && (
            <a
              href={OPENSEA_COLLECTION_URL}
              target="_blank"
              rel="noreferrer"
              className="text-emerald hover:underline"
            >
              View the collection on OpenSea ↗
            </a>
          )}
        </div>
      </section>

      <ol className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Card className="h-full p-5">
              <div className="font-mono text-[11px] text-emerald">Step {index + 1}</div>
              <h3 className="mt-2 text-[15px] font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{step.body}</p>
            </Card>
          </li>
        ))}
      </ol>

      <section className="space-y-3">
        <h3 className="text-[17px] font-semibold text-ink">Before you buy on OpenSea</h3>
        <ul className="list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-ink-muted">
          {BEFORE_BUYING.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
