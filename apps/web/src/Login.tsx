import { useState } from "react";
import { Sparkles, Users, Zap, ShieldCheck, ArrowRight } from "lucide-react";
import "./auth-screens.css";
import { persistSession, signIn, signUp } from "./auth-api";

type Tab = "signin" | "signup";

interface Props {
  onAuth: () => void;
  defaultTab?: Tab;
  inviteRoomName?: string;
}

export function Login({ onAuth, defaultTab = "signin", inviteRoomName }: Props) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [display, setDisplay] = useState("");

  async function doSignIn() {
    if (!email || !password) return;
    setBusy(true);
    setError(null);
    try {
      const r = await signIn(email, password);
      persistSession(r.token, r.user);
      onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function doSignUp() {
    if (!email || !password || !display) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await signUp(email, password, display);
      persistSession(r.token, r.user);
      onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-orb auth-orb-1" aria-hidden="true" />
      <div className="auth-orb auth-orb-2" aria-hidden="true" />
      <div className="auth-orb auth-orb-3" aria-hidden="true" />

      <div className="auth-grid">
        <aside className="auth-hero">
          <div className="brand-lockup" aria-label="Ligma">
            <span className="brand-mark">L</span>
            <div className="brand-text">
              <h1>Ligma</h1>
              <p>Live ideation to execution</p>
            </div>
          </div>

          <div className="auth-hero-copy">
            <h2 className="auth-hero-title">
              Where ideas become <span className="auth-hero-accent">action</span>.
            </h2>
            <p className="auth-hero-sub">
              A real-time whiteboard for teams that want their brainstorms to ship.
              Sketch, decide, and watch tasks fall out automatically.
            </p>
          </div>

          <ul className="auth-feature-list">
            <li className="auth-feature">
              <span className="auth-feature-icon"><Sparkles size={16} /></span>
              <div>
                <strong>AI intent detection</strong>
                <small>Sticky notes auto-classify as actions, decisions, questions.</small>
              </div>
            </li>
            <li className="auth-feature">
              <span className="auth-feature-icon"><Users size={16} /></span>
              <div>
                <strong>Live multi-user canvas</strong>
                <small>Cursors, presence, and roles — Lead, Contributor, Viewer.</small>
              </div>
            </li>
            <li className="auth-feature">
              <span className="auth-feature-icon"><Zap size={16} /></span>
              <div>
                <strong>Replay every decision</strong>
                <small>Scrub the timeline to revisit how the room reached the call.</small>
              </div>
            </li>
            <li className="auth-feature">
              <span className="auth-feature-icon"><ShieldCheck size={16} /></span>
              <div>
                <strong>Lock what matters</strong>
                <small>Pin shapes to roles so only the right people can edit them.</small>
              </div>
            </li>
          </ul>
        </aside>

        <main className="auth-panel">
          <div className="auth-card">
            <div className="auth-card-head">
              <h2>{tab === "signin" ? "Welcome back" : "Create your account"}</h2>
              <p className="auth-card-sub">
                {inviteRoomName
                  ? `Sign in or create an account to join "${inviteRoomName}".`
                  : tab === "signin"
                  ? "Sign in to jump back into your whiteboards."
                  : "It only takes a few seconds. No credit card."}
              </p>
            </div>

            <div className="auth-tabs">
              <button
                className={`auth-tab ${tab === "signin" ? "active" : ""}`}
                onClick={() => {
                  setTab("signin");
                  setError(null);
                }}
                type="button"
              >
                Sign in
              </button>
              <button
                className={`auth-tab ${tab === "signup" ? "active" : ""}`}
                onClick={() => {
                  setTab("signup");
                  setError(null);
                }}
                type="button"
              >
                Sign up
              </button>
              <span className={`auth-tab-indicator ${tab}`} aria-hidden="true" />
            </div>

            {tab === "signin" && (
              <div className="auth-form">
                <label className="auth-field">
                  <span>Email</span>
                  <input
                    className="ligma-input"
                    type="email"
                    autoComplete="email"
                    placeholder="you@team.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="auth-field">
                  <span>Password</span>
                  <input
                    className="ligma-input"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") doSignIn();
                    }}
                  />
                </label>
                <button
                  className="ligma-btn primary auth-submit"
                  onClick={doSignIn}
                  disabled={busy}
                  type="button"
                >
                  {busy ? "Signing in…" : (
                    <>
                      Sign in <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            )}

            {tab === "signup" && (
              <div className="auth-form">
                <label className="auth-field">
                  <span>Display name</span>
                  <input
                    className="ligma-input"
                    type="text"
                    autoComplete="name"
                    placeholder="What should teammates call you?"
                    value={display}
                    onChange={(e) => setDisplay(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="auth-field">
                  <span>Email</span>
                  <input
                    className="ligma-input"
                    type="email"
                    autoComplete="email"
                    placeholder="you@team.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="auth-field">
                  <span>Password</span>
                  <input
                    className="ligma-input"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") doSignUp();
                    }}
                  />
                </label>
                <button
                  className="ligma-btn primary auth-submit"
                  onClick={doSignUp}
                  disabled={busy}
                  type="button"
                >
                  {busy ? "Creating account…" : (
                    <>
                      Create account <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            )}

            {error && <div className="error-pill">{error}</div>}

            <div className="auth-foot">
              {tab === "signin" ? (
                <span>
                  New to Ligma?{" "}
                  <button className="auth-link" onClick={() => setTab("signup")} type="button">
                    Create an account
                  </button>
                </span>
              ) : (
                <span>
                  Already have an account?{" "}
                  <button className="auth-link" onClick={() => setTab("signin")} type="button">
                    Sign in
                  </button>
                </span>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
