import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { Login } from "./Login";

function Root() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(window.localStorage.getItem("ligma.token")));

  useEffect(() => {
    // If a token gets cleared elsewhere (other tab), drop back to login.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ligma.token" && !e.newValue) setAuthed(false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!authed) return <Login onAuth={() => setAuthed(true)} />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
