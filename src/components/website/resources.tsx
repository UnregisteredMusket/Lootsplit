import { Website } from "./site";
import { PageHero } from "./parts";
import { resources, type Resource } from "@/lib/website/resources";

const credits = resources.filter((resource) => resource.kind !== "reference");
const references = resources.filter((resource) => resource.kind === "reference");

function ResourceEntry({ resource }: { resource: Resource }) {
  return (
    <article className="ls-credit">
      <h3>{resource.name}</h3>
      <p>{resource.description}</p>
      {resource.license && <p className="ls-credit-license">{resource.license}</p>}
      <ul className="ls-resource-links">
        {resource.links.map((link) => (
          <li key={link.url}>
            <a href={link.url}>{link.label} ↗</a>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function ResourcesPage() {
  return (
    <Website>
      <PageHero kicker="The sources behind the adventure" title="Resources & credits">
        <p className="ls-lead ls-measure">
          Thank you to the projects and creators that help make Lootsplit possible. This list grows
          as new resources join the app.
        </p>
      </PageHero>
      <section className="ls-paper ls-section ls-section-tight" aria-labelledby="credits">
        <div className="ls-wrap ls-stack ls-gap-lg">
          <div className="ls-stack">
            <h2 id="credits" className="ls-display">
              Credits
            </h2>
            <p className="ls-lead">
              Content, data, libraries and typefaces that ship with Lootsplit or that it reads,
              with their creators and licenses.
            </p>
          </div>
          <div className="ls-credit-grid">
            {credits.map((resource) => (
              <ResourceEntry key={resource.name} resource={resource} />
            ))}
          </div>
        </div>
      </section>
      <section className="ls-ink ls-section ls-section-tight" aria-labelledby="technical">
        <div className="ls-wrap">
          <details className="ls-card ls-card-ink ls-disclosure">
            <summary>
              <h2 id="technical">Technical references</h2>
              <span>
                Platform documentation, APIs and design references used while building Lootsplit.
                Nothing from these is bundled. {references.length} entries.
              </span>
            </summary>
            <div className="ls-credit-grid ls-credit-grid-ink">
              {references.map((resource) => (
                <ResourceEntry key={resource.name} resource={resource} />
              ))}
            </div>
          </details>
        </div>
      </section>
    </Website>
  );
}
