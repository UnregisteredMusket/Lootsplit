import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { captchaConfig } from "@/lib/account/captcha";

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => boolean | void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile"));
    };
    document.head.append(script);
  });
  return loading;
}

export type HumanCheckHandle = {
  /** The current token, or "" when the check is required but not finished yet. */
  token: () => string;
  /** True when the server requires the check. */
  required: () => boolean;
  /** Tokens work once: call after every attempt so the next one gets a fresh token. */
  reset: () => void;
};

/**
 * Cloudflare Turnstile on the sign-in, sign-up and recovery forms (website only). Renders nothing
 * when the server does not require it, and nothing in the Android app.
 */
export const HumanCheck = forwardRef<HumanCheckHandle, { action: "signin" | "signup" | "recover" }>(
  function HumanCheck({ action }, ref) {
    const box = useRef<HTMLDivElement>(null);
    const widget = useRef("");
    const [token, setToken] = useState("");
    const [required, setRequired] = useState(false);
    const [problem, setProblem] = useState("");

    useImperativeHandle(
      ref,
      () => ({
        token: () => token,
        required: () => required,
        reset: () => {
          setToken("");
          if (widget.current) window.turnstile?.reset(widget.current);
        },
      }),
      [token, required],
    );

    useEffect(() => {
      let alive = true;
      void captchaConfig().then(async ({ required: needed, siteKey }) => {
        if (!alive || !needed) return;
        setRequired(true);
        try {
          const api = await loadTurnstile();
          if (!alive || !box.current) return;
          widget.current = api.render(box.current, {
            sitekey: siteKey,
            action,
            theme: "auto",
            // The normal widget is 300 px wide; on the narrowest phones (320 px) it would
            // overflow the sign-in card, so use the compact 150 px widget there.
            size: box.current.clientWidth < 300 ? "compact" : "flexible",
            callback: (t) => {
              setProblem("");
              setToken(t);
            },
            "expired-callback": () => setToken(""),
            "error-callback": () => {
              setToken("");
              setProblem("The human check could not load. Check your connection and reload the page.");
              return true;
            },
          });
        } catch {
          if (alive) setProblem("The human check could not load. Check your connection and reload the page.");
        }
      });
      return () => {
        alive = false;
        if (widget.current) window.turnstile?.remove(widget.current);
        widget.current = "";
      };
    }, [action]);

    if (!required) return null;
    return (
      <div className="human-check">
        <div ref={box} />
        {problem && (
          <p role="alert" className="portal-message error">
            {problem}
          </p>
        )}
      </div>
    );
  },
);
