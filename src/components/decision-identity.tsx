"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import { usePathname } from "next/navigation";
import {
  DecisionDisplayNameSchema,
  type AuthenticatedDecisionUser
} from "@/domain/central-decision";

export type DecisionSessionStatus =
  | "DISABLED"
  | "SESSION_LOADING"
  | "NO_SESSION"
  | "SESSION_AUTHENTICATED"
  | "SESSION_ERROR";

type DecisionIdentityContextValue = {
  enabled: boolean;
  loading: boolean;
  status: DecisionSessionStatus;
  user: AuthenticatedDecisionUser | null;
  retry: () => void;
};

const DecisionIdentityContext = createContext<DecisionIdentityContextValue>({
  enabled: false,
  loading: false,
  status: "DISABLED",
  user: null,
  retry: () => undefined
});

export function useDecisionIdentity(): DecisionIdentityContextValue {
  return useContext(DecisionIdentityContext);
}

export function requiresDecisionIdentity(pathname: string): boolean {
  return (
    pathname === "/entscheidungen" ||
    pathname === "/lv-vergleich" ||
    pathname.endsWith("/lv-vergleich")
  );
}

type SessionPayload = {
  user?: AuthenticatedDecisionUser;
  message?: string;
};

async function responsePayload(response: Response): Promise<SessionPayload | null> {
  return (await response.json().catch(() => null)) as SessionPayload | null;
}

export function DecisionIdentityProvider({
  enabled,
  children
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = enabled && requiresDecisionIdentity(pathname);
  const [status, setStatus] = useState<DecisionSessionStatus>(
    active ? "SESSION_LOADING" : "DISABLED"
  );
  const [user, setUser] = useState<AuthenticatedDecisionUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const loadSession = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/session", {
        cache: "no-store",
        credentials: "include",
        signal
      });
      if (response.status === 401) {
        setUser(null);
        setStatus("NO_SESSION");
        return;
      }
      const payload = await responsePayload(response);
      if (!response.ok || !payload?.user) {
        throw new Error(
          payload?.message ?? "Sitzung konnte nicht geladen werden."
        );
      }
      setUser(payload.user);
      setStatus("SESSION_AUTHENTICATED");
    } catch (loadError) {
      if (signal?.aborted) return;
      setUser(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Sitzung konnte nicht geladen werden."
      );
      setStatus("SESSION_ERROR");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const startup = window.setTimeout(() => {
      if (!active) {
        setStatus("DISABLED");
        setUser(null);
        setError("");
        return;
      }
      setStatus("SESSION_LOADING");
      setUser(null);
      setError("");
      void loadSession(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(startup);
      controller.abort();
    };
  }, [active, loadSession]);

  async function login() {
    if (pendingRef.current) return;
    const parsedName = DecisionDisplayNameSchema.safeParse(displayName);
    if (!parsedName.success) {
      setError(
        "Bitte einen Anzeigenamen mit 2 bis 100 aussagekräftigen Zeichen eingeben."
      );
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: parsedName.data })
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload?.user) {
        throw new Error(payload?.message ?? "Bitte erneut versuchen.");
      }

      const confirmation = await fetch("/api/session", {
        cache: "no-store",
        credentials: "include"
      });
      const confirmedPayload = await responsePayload(confirmation);
      if (
        !confirmation.ok ||
        !confirmedPayload?.user ||
        confirmedPayload.user.id !== payload.user.id
      ) {
        throw new Error(
          confirmedPayload?.message ?? "Sitzung konnte nicht erstellt werden."
        );
      }

      setUser(confirmedPayload.user);
      setStatus("SESSION_AUTHENTICATED");
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Bitte erneut versuchen."
      );
      setStatus("NO_SESSION");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const retry = useCallback(() => {
    setStatus("SESSION_LOADING");
    setError("");
    void loadSession();
  }, [loadSession]);
  const visibleStatus: DecisionSessionStatus = !active
    ? "DISABLED"
    : status === "DISABLED"
      ? "SESSION_LOADING"
      : status;
  const loading = visibleStatus === "SESSION_LOADING";
  const visibleUser =
    active && visibleStatus === "SESSION_AUTHENTICATED" ? user : null;
  const validName = DecisionDisplayNameSchema.safeParse(displayName).success;

  return (
    <DecisionIdentityContext.Provider
      value={{
        enabled: active,
        loading: active && loading,
        status: visibleStatus,
        user: visibleUser,
        retry
      }}
    >
      {children}
      {active && visibleStatus === "SESSION_ERROR" ? (
        <div className="decision-login-backdrop">
          <section
            className="decision-login"
            aria-labelledby="session-error-title"
            data-session-error
          >
            <span>SmartProcurementTool</span>
            <h1 id="session-error-title">Sitzung nicht verfügbar</h1>
            <p className="action-error">{error || "Bitte erneut versuchen."}</p>
            <button className="button button-primary" onClick={retry}>
              Erneut versuchen
            </button>
          </section>
        </div>
      ) : null}
      {active && visibleStatus === "NO_SESSION" ? (
        <div className="decision-login-backdrop">
          <form
            className="decision-login"
            data-session-login
            onSubmit={(event) => {
              event.preventDefault();
              void login();
            }}
          >
            <span>SmartProcurementTool</span>
            <h1>Wer bearbeitet die Entscheidungen?</h1>
            <p>
              Der Name wird mit Entwürfen, Entscheidungen und der Historie
              gespeichert.
            </p>
            <label>
              <span>Anzeigename</span>
              <input
                autoFocus
                value={displayName}
                minLength={2}
                maxLength={100}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Vor- und Nachname"
              />
            </label>
            {error ? <p className="action-error">{error}</p> : null}
            <button
              className="button button-primary"
              disabled={pending || !validName}
            >
              {pending ? "Speichern..." : "Weiter"}
            </button>
          </form>
        </div>
      ) : null}
    </DecisionIdentityContext.Provider>
  );
}
