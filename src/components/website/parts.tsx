import type { ReactNode } from "react";
import {
  PHONE_SHOT_MEDIA,
  PHONE_SHOT_SIZE,
  phoneShotFor,
  productShots,
  productShotSize,
  type ProductShot,
} from "@/lib/website/product-shots";

/** A real product screenshot in an engraved mat (gold on parchment, dark on ink). Below 700 px
 * a screen with a phone capture shows that instead, so phone visitors can read it (W-4). */
export function Shot({
  name,
  tone = "paper",
  size = "full",
  className = "",
}: {
  name: ProductShot;
  tone?: "paper" | "ink";
  size?: "full" | "inset";
  className?: string;
}) {
  const { width, height } = productShotSize(name);
  const phone = phoneShotFor(name);
  return (
    <figure
      className={`ls-frame ls-frame-${tone}${size === "inset" ? " ls-frame-inset" : ""}${
        name === "phone-home" ? " ls-frame-phone" : ""
      }${phone ? " ls-frame-responsive" : ""} ${className}`.trim()}
    >
      <picture>
        {phone && (
          <source
            media={PHONE_SHOT_MEDIA}
            srcSet={`/product/${phone}.webp`}
            width={PHONE_SHOT_SIZE.width}
            height={PHONE_SHOT_SIZE.height}
          />
        )}
        <img
          src={`/product/${name}.webp`}
          alt={productShots[name].alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
        />
      </picture>
    </figure>
  );
}

/** Small-caps label; `ornament` flanks it with thin rules. */
export function Kicker({
  children,
  ornament = false,
  as: Tag = "p",
  id,
}: {
  children: ReactNode;
  ornament?: boolean;
  as?: "p" | "h2" | "h3";
  id?: string;
}) {
  return (
    <Tag id={id} className={`ls-sc${ornament ? " ls-ornament" : ""}`}>
      {children}
    </Tag>
  );
}

/** Centered dark page heading used by every public page except the home hero. */
export function PageHero({
  kicker,
  title,
  accent,
  children,
}: {
  kicker: string;
  title: string;
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <section className="ls-ink ls-page-hero">
      <div className="ls-wrap ls-stack ls-center">
        <Kicker ornament>{kicker}</Kicker>
        <h1 className="ls-display">
          {title}
          {accent && (
            <>
              {" "}
              <em>{accent}</em>
            </>
          )}
        </h1>
        {children}
      </div>
    </section>
  );
}

export function DmTag() {
  return (
    <span className="ls-dm" title="Dungeon Master tool">
      DM
    </span>
  );
}
