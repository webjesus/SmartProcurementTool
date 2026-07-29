"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AuthenticatedDecisionUser,
  CentralSupplierDecision,
  DecisionDraftRecord,
  DecisionOutcome
} from "@/domain/central-decision";

export type DecisionFormDraft = {
  selectedOptionId: string | null;
  selectedLineIds: string[];
  rejectedOptionIds: string[];
  reasonCode: string;
  comment: string;
  outcome: DecisionOutcome | null;
};

type RecoveryCopy = {
  draft: DecisionFormDraft;
  updatedAt: string;
  serverVersion: number | null;
};

export type DraftSaveState =
  | "loading"
  | "idle"
  | "saving"
  | "saved"
  | "offline"
  | "error"
  | "conflict";

function recoveryKey(positionId: string): string {
  return `spt:lv-decision-recovery:${positionId}`;
}

function legacyDraftKey(positionId: string): string {
  return `spt:lv-decision-draft:${positionId}`;
}

function readRecovery(
  positionId: string,
  fallback: DecisionFormDraft
): RecoveryCopy | null {
  if (typeof window === "undefined") return null;
  try {
    const modern = window.localStorage.getItem(recoveryKey(positionId));
    if (modern) return JSON.parse(modern) as RecoveryCopy;
    const legacy = window.localStorage.getItem(legacyDraftKey(positionId));
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as Partial<DecisionFormDraft>;
    return {
      draft: {
        ...fallback,
        ...parsed,
        rejectedOptionIds: parsed.rejectedOptionIds ?? [],
        outcome:
          parsed.outcome ??
          (parsed.selectedOptionId ? "SELECTED" : fallback.outcome)
      },
      updatedAt: new Date(0).toISOString(),
      serverVersion: null
    };
  } catch {
    return null;
  }
}

function writeRecovery(
  positionId: string,
  recovery: RecoveryCopy
): void {
  window.localStorage.setItem(
    recoveryKey(positionId),
    JSON.stringify(recovery)
  );
}

function draftFromServer(
  record: DecisionDraftRecord,
  fallback: DecisionFormDraft
): DecisionFormDraft {
  return {
    selectedOptionId: record.selectedSupplierOptionId,
    selectedLineIds: record.selectedBundleLineIds,
    rejectedOptionIds: record.rejectedOptionIds,
    reasonCode: record.reasonCodes[0] ?? "",
    comment: record.comment,
    outcome: record.outcome ?? fallback.outcome
  };
}

function sameDraft(left: DecisionFormDraft, right: DecisionFormDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deviceSessionId(): string {
  const key = "spt:decision-device-session";
  const current = window.sessionStorage.getItem(key);
  if (current) return current;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

export function useServerDecisionDraft(input: {
  enabled: boolean;
  user: AuthenticatedDecisionUser | null;
  projectId: string;
  positionId: string;
  analysisVersionId: string;
  initialDraft: DecisionFormDraft;
}) {
  const [initialRecovery] = useState<RecoveryCopy | null>(() =>
    typeof window === "undefined"
      ? null
      : readRecovery(input.positionId, input.initialDraft)
  );
  const recoveryRef = useRef<RecoveryCopy | null>(initialRecovery);
  const [draft, setDraft] = useState<DecisionFormDraft>(
    initialRecovery?.draft ?? input.initialDraft
  );
  const [serverDraft, setServerDraft] = useState<DecisionDraftRecord | null>(
    null
  );
  const [serverVersion, setServerVersion] = useState(0);
  const [serverDecisions, setServerDecisions] = useState<
    CentralSupplierDecision[]
  >([]);
  const [saveState, setSaveState] = useState<DraftSaveState>(
    input.enabled ? "loading" : "offline"
  );
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const serverVersionRef = useRef(0);
  const [localUpdatedAt, setLocalUpdatedAt] = useState<string | null>(
    initialRecovery?.updatedAt ?? null
  );
  const [recoveryCandidate, setRecoveryCandidate] =
    useState<RecoveryCopy | null>(null);
  const [conflictRecord, setConflictRecord] =
    useState<DecisionDraftRecord | null>(null);
  const [compareVisible, setCompareVisible] = useState(false);
  const [loaded, setLoaded] = useState(!input.enabled);

  const endpoint = `/api/projects/${encodeURIComponent(
    input.projectId
  )}/positions/${encodeURIComponent(input.positionId)}`;

  const load = useCallback(
    async (background = false) => {
      if (!input.enabled || !input.user || !input.analysisVersionId) return;
      if (!background) setSaveState("loading");
      const query = new URLSearchParams({
        analysisVersionId: input.analysisVersionId
      });
      const [draftResponse, decisionResponse] = await Promise.all([
        fetch(`${endpoint}/draft?${query.toString()}`, {
          cache: "no-store"
        }),
        fetch(`${endpoint}/decisions`, { cache: "no-store" })
      ]);
      if (!draftResponse.ok || !decisionResponse.ok) {
        throw new Error("Server-Entwurf konnte nicht geladen werden.");
      }
      const draftPayload = (await draftResponse.json()) as {
        draft: DecisionDraftRecord | null;
      };
      const decisionPayload = (await decisionResponse.json()) as {
        decisions: CentralSupplierDecision[];
      };
      const incoming = draftPayload.draft;
      setServerDecisions(decisionPayload.decisions);

      if (
        background &&
        dirtyRef.current &&
        incoming &&
        incoming.version > serverVersionRef.current
      ) {
        setConflictRecord(incoming);
        setSaveState("conflict");
        setLoaded(true);
        return;
      }
      setServerDraft(incoming);
      setServerVersion(incoming?.version ?? 0);
      serverVersionRef.current = incoming?.version ?? 0;
      if (!dirtyRef.current) {
        const recovery = recoveryRef.current;
        if (
          recovery &&
          (!incoming || Date.parse(recovery.updatedAt) > Date.parse(incoming.updatedAt)) &&
          !sameDraft(
            recovery.draft,
            incoming
              ? draftFromServer(incoming, input.initialDraft)
              : input.initialDraft
          )
        ) {
          setRecoveryCandidate(recovery);
        }
        const primary = incoming
          ? draftFromServer(incoming, input.initialDraft)
          : input.initialDraft;
        setDraft(primary);
        setLocalUpdatedAt(null);
        setSaveState(incoming ? "saved" : "idle");
      }
      setLoaded(true);
    },
    [
      endpoint,
      input.analysisVersionId,
      input.enabled,
      input.initialDraft,
      input.user,
    ]
  );

  useEffect(() => {
    if (!input.enabled) {
      return;
    }
    if (!input.user) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void load().catch(() => {
        if (!cancelled) setSaveState("error");
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [input.enabled, input.user, load]);

  useEffect(() => {
    if (!input.enabled || !input.user) return;
    const poll = window.setInterval(() => {
      void load(true).catch(() => setSaveState("error"));
    }, 20_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load(true).catch(() => setSaveState("error"));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [input.enabled, input.user, load]);

  useEffect(() => {
    if (!localUpdatedAt || typeof window === "undefined") return;
    const recovery = { draft, updatedAt: localUpdatedAt, serverVersion };
    recoveryRef.current = recovery;
    writeRecovery(input.positionId, recovery);
  }, [draft, input.positionId, localUpdatedAt, serverVersion]);

  useEffect(() => {
    if (
      !input.enabled ||
      !input.user ||
      !dirty ||
      !loaded ||
      conflictRecord
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void fetch(`${endpoint}/draft`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selectedSupplierOptionId: draft.selectedOptionId,
          selectedBundleLineIds: draft.selectedLineIds,
          rejectedOptionIds: draft.rejectedOptionIds,
          reasonCodes: draft.reasonCode ? [draft.reasonCode] : [],
          outcome: draft.outcome,
          comment: draft.comment,
          analysisVersionId: input.analysisVersionId,
          expectedVersion: serverVersionRef.current,
          deviceSessionId: deviceSessionId()
        })
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            draft?: DecisionDraftRecord;
            currentRecord?: DecisionDraftRecord;
          };
          if (response.status === 409) {
            if (payload.currentRecord) {
              setConflictRecord(payload.currentRecord);
            }
            setSaveState("conflict");
            return;
          }
          if (!response.ok || !payload.draft) {
            throw new Error("DRAFT_SAVE_FAILED");
          }
          setServerDraft(payload.draft);
          setServerVersion(payload.draft.version);
          serverVersionRef.current = payload.draft.version;
          setDirty(false);
          dirtyRef.current = false;
          setLocalUpdatedAt(null);
          setSaveState("saved");
          const recovery = {
            draft,
            updatedAt: payload.draft.updatedAt,
            serverVersion: payload.draft.version
          };
          recoveryRef.current = recovery;
          writeRecovery(input.positionId, recovery);
        })
        .catch(() => setSaveState(navigator.onLine ? "error" : "offline"));
    }, 1_000);
    return () => window.clearTimeout(timeout);
  }, [
    conflictRecord,
    dirty,
    draft,
    endpoint,
    input.analysisVersionId,
    input.enabled,
    input.positionId,
    input.user,
    loaded,
    serverVersion
  ]);

  function updateDraft(next: DecisionFormDraft) {
    setDraft(next);
    setDirty(true);
    dirtyRef.current = true;
    setLocalUpdatedAt(new Date().toISOString());
    setSaveState(input.enabled ? "saving" : "offline");
  }

  function useLatestServerVersion() {
    const current = conflictRecord ?? serverDraft;
    if (current) {
      setDraft(draftFromServer(current, input.initialDraft));
      setServerDraft(current);
      setServerVersion(current.version);
      serverVersionRef.current = current.version;
    }
    setDirty(false);
    dirtyRef.current = false;
    setConflictRecord(null);
    setRecoveryCandidate(null);
    setLocalUpdatedAt(null);
    setSaveState(current ? "saved" : "idle");
  }

  function keepLocalInput() {
    const latest = conflictRecord;
    if (latest) {
      setServerDraft(latest);
      setServerVersion(latest.version);
    }
    setConflictRecord(null);
    setRecoveryCandidate(null);
    setDirty(true);
    dirtyRef.current = true;
    setLocalUpdatedAt(new Date().toISOString());
    setSaveState("saving");
  }

  function restoreRecovery() {
    if (!recoveryCandidate) return;
    setDraft(recoveryCandidate.draft);
    setDirty(true);
    dirtyRef.current = true;
    setLocalUpdatedAt(recoveryCandidate.updatedAt);
    setRecoveryCandidate(null);
    setSaveState("saving");
  }

  function dismissRecovery() {
    setRecoveryCandidate(null);
    if (serverDraft) {
      const primary = draftFromServer(serverDraft, input.initialDraft);
      setDraft(primary);
      const recovery = {
        draft: primary,
        updatedAt: serverDraft.updatedAt,
        serverVersion: serverDraft.version
      };
      recoveryRef.current = recovery;
      writeRecovery(input.positionId, recovery);
    }
  }

  function clearRecovery() {
    window.localStorage.removeItem(recoveryKey(input.positionId));
    window.localStorage.removeItem(legacyDraftKey(input.positionId));
    recoveryRef.current = null;
    setDirty(false);
    dirtyRef.current = false;
    setLocalUpdatedAt(null);
  }

  return {
    draft,
    updateDraft,
    serverDraft,
    serverVersion,
    serverDecisions,
    saveState,
    dirty,
    recoveryCandidate,
    conflictRecord,
    compareVisible,
    setCompareVisible,
    useLatestServerVersion,
    keepLocalInput,
    restoreRecovery,
    dismissRecovery,
    clearRecovery,
    refresh: load
  };
}
