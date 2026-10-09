import { useMemo, useState } from "react";
import { propertyDeedImage, type PropertyDeed } from "@/lib/quire/property-deed";
import { formatCopper } from "@/lib/quire/money";
import { Button, Modal } from "./ui";
import { AppLink } from "./app-link";
import "./property-marketplace.css";

export function PropertyDeedArt({
  deed,
  quantity = 1,
  className = "",
}: {
  deed: PropertyDeed;
  quantity?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const image = useMemo(() => propertyDeedImage(deed, quantity), [deed, quantity]);
  return (
    <>
      <button
        className="property-deed-thumbnail"
        aria-label={`View deed for ${deed.propertyName}`}
        onClick={() => setOpen(true)}
      >
        <img
          src={image}
          alt={`Property deed for ${deed.propertyName}`}
          className={`ledger-art ${className}`}
          loading="lazy"
        />
      </button>
      <Modal open={open} onOpenChange={setOpen} title={`Deed · ${deed.propertyName}`}>
        <div className="property-deed-details">
          <img
            src={image}
            alt={`Deed of ownership for ${deed.propertyName}, registered to ${deed.ownerName}, at ${deed.location}`}
            className="property-deed-preview"
          />
          <p>
            Registered holder: {deed.ownerName}. Original buyer: {deed.buyerName}. This deed covers{" "}
            {quantity} property {quantity === 1 ? "unit" : "units"}.
          </p>
          <dl className="property-price-summary">
            <div>
              <dt>Location at purchase</dt>
              <dd>{deed.location}</dd>
            </div>
            <div>
              <dt>Original payment</dt>
              <dd>{formatCopper(deed.totalCopper)}</dd>
            </div>
            <div>
              <dt>Purchase receipt</dt>
              <dd className="break-all">{deed.transactionId}</dd>
            </div>
          </dl>
          <div className="property-actions">
            <AppLink href="/party?section=funds&action=give">Transfer through Give to a player</AppLink>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Return to inventory
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
