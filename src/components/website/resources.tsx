import { Website } from "./site";
import { resources } from "@/lib/website/resources";
export function ResourcesPage() {
  return (
    <Website>
      <section className="ls-wrap ls-section ls-reading">
        <p className="ls-eyebrow">THE SOURCES BEHIND THE ADVENTURE</p>
        <h1>Resources & credits</h1>
        <p className="ls-intro">
          Thank you to the projects and creators that help make Lootsplit possible. This list grows
          as new resources join the app.
        </p>
        {resources.map((resource) => (
          <article className="ls-help-block" key={resource.name}>
            <h2>{resource.name}</h2>
            <p>{resource.description}</p>
            <div className="ls-resource-links">
              {resource.links.map((link) => (
                <a key={link.url} href={link.url}>
                  {link.label} ↗
                </a>
              ))}
            </div>
          </article>
        ))}
      </section>
    </Website>
  );
}
