import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Monitor, Smartphone, Globe } from "lucide-react";
import { SiteHeader, SiteFooter } from "./welcome";
export const Route = createFileRoute("/downloads")({ component: Downloads });
const release = "https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.3.1/";
function Downloads() {
  return (
    <div className="portal">
      <SiteHeader />
      <main className="portal-content">
        <p className="portal-eyebrow">BRING YOUR LEDGER</p>
        <h1>One party. Every screen.</h1>
        <p className="portal-lead">
          Choose where you play. Accounts are optional, and your existing campaign tools stay
          available.
        </p>
        <div className="portal-features">
          <article>
            <Globe />
            <h2>Browser</h2>
            <p>
              The latest web version. No download required. Sign in for your campaign library, or
              continue as a guest.
            </p>
            <Link to="/" search={{ view: "home" }} className="portal-button">
              Open Lootsplit
            </Link>
          </article>
          <article>
            <Smartphone />
            <h2>Android</h2>
            <p>
              Version 1.3.1 · Signed APK. Includes device file saving, offline play and shared
              campaigns. The new account library is available on the website first.
            </p>
            <a className="portal-button" href="/download/android">
              <Download size={18} /> Download APK
            </a>
            <p>
              <a href="https://drive.google.com/file/d/1MT4by-7mNe7-7PANKbTwcbBOcd2CSKrr/view">
                Alternate download on Google Drive
              </a>
            </p>
          </article>
          <article>
            <Monitor />
            <h2>PC & desktop</h2>
            <p>
              Install Lootsplit as a desktop web app for its own window and taskbar shortcut. No
              separate Windows installer is published yet.
            </p>
            <Link to="/" search={{ view: "home" }} className="portal-button secondary">
              Open to install
            </Link>
            <p>
              In Chrome or Edge, open the browser menu and choose <strong>Install Lootsplit</strong>{" "}
              or <strong>Install this site as an app</strong>. The wording varies by browser.
            </p>
          </article>
        </div>
        <section className="portal-callout">
          <div>
            <h2>Installing on Android</h2>
            <ol>
              <li>
                Download the APK using Chrome or your phone’s browser. If a chat browser fails, open
                this page in Chrome.
              </li>
              <li>
                Open the file from Files → Downloads. Android may ask you to allow installation from
                that source.
              </li>
              <li>
                Install over your permanently signed 1.3.0 or 1.3.1 app. Keep the existing app
                installed to retain its data.
              </li>
            </ol>
            <p>
              For an older debug-signed copy, save and verify an external backup before changing
              installations.
            </p>
          </div>
        </section>
        <section className="portal-release">
          <p className="portal-eyebrow">RELEASE NOTES</p>
          <h2>Android 1.3.1 · October 2, 2026</h2>
          <ul>
            <li>Save exported files to a location you choose on Android.</li>
            <li>Clearer campaign invitations and backup recovery.</li>
            <li>More informative transaction history and recorded DM changes.</li>
            <li>Recovery fixes and release verification improvements.</li>
          </ul>
          <a href="https://github.com/UnregisteredMusket/Lootsplit/releases/tag/android-v1.3.1">
            Release details
          </a>{" "}
          · <a href={release + "SHA256SUMS.txt"}>Published checksums</a>
          <details>
            <summary>APK SHA-256</summary>
            <code>afd1cbeb9a377c10e77a839a161c8f670dfe2acecb703c0846003d4a4db6e088</code>
          </details>
        </section>
        <section className="portal-release">
          <h2>Keep a recovery copy</h2>
          <p>
            Device saves stay in that browser or app. Signing in does not automatically upload them.
            Use My account to explicitly save a cloud backup or link a shared campaign. Private PDFs
            stay on your device. Before changing website addresses, export a device backup or save
            to your account on the old address.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
