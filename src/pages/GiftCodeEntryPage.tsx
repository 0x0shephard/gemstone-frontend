import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

/**
 * Typing a gift code in by hand.
 *
 * The QR is the intended route, but every card also prints the code in plain
 * characters for when a camera will not read a folded piece of card — and the
 * email says, in as many words, "enter this code at /gift". Without this page
 * that instruction landed on Not Found.
 */

/** Matches the server's first two steps exactly, so nothing valid is rejected here. */
const CODE_LENGTH = 16;

function clean(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export default function GiftCodeEntryPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const cleaned = clean(code);
  const complete = cleaned.length === CODE_LENGTH;
  /*
   * Only the shape is checked here. Crockford's folding — O to zero, I and L to
   * one — is left to the server, which is the authority on whether a code
   * exists at all; duplicating it would risk this page rejecting something the
   * claim endpoint would happily accept.
   */
  const tooLong = cleaned.length > CODE_LENGTH;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (complete) navigate(`/gift/${cleaned}`);
  }

  return (
    <Card className="dc-facet-border mx-auto max-w-[460px] p-7">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-atelier">
        Digital Carat gift card
      </p>
      <h1 className="mt-2 font-display text-[24px] font-medium tracking-[-0.03em] text-ink">
        Claim your gemstone
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        Enter the code printed beneath the QR on your card. It is sixteen characters, usually shown
        in four groups of four.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-3">
        <Field
          label="Gift code"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono tracking-[0.12em]"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={tooLong ? 'That is longer than a gift code.' : undefined}
        />
        <Button type="submit" block disabled={!complete}>
          {complete ? 'Continue' : `${cleaned.length} of ${CODE_LENGTH} characters`}
        </Button>
      </form>

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink-dim">
        Scanning the QR takes you straight there and skips this step. The code is only needed when a
        camera will not read it.
      </p>
    </Card>
  );
}
