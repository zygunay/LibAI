import { createSearchPlan, parseIntent } from "@libai/intent";
import type { SearchIntent } from "@libai/domain";
import { analyzePackageJson, type AdvisorReport } from "@libai/advisor";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_CHAT_QUERY_LENGTH, MIN_CHAT_QUERY_LENGTH, normalizeChatQuery } from "./chat.js";
import {
  optimisticFeedback,
  parseSharedQuery,
  pipelineSteps,
  recommendationCards,
  searchRecommendations,
  shareUrl,
  toggleComparison,
  type RecommendationCard,
  type ResultState,
} from "./product.js";

const suggestions = [
  { title: "Charts for React", detail: "Lightweight with first-class TypeScript support" },
  { title: "Node.js logging", detail: "Structured, production-ready logs" },
  { title: "Modern date utilities", detail: "Compact and ESM-first" },
  { title: "Form validation", detail: "Type-safe and framework-agnostic" },
] as const;

const CONVERSATIONS_KEY = "libai.conversations.v3";
const PROFILE_NAME_KEY = "libai.profile-name.v3";

type Conversation = Readonly<{
  id: string;
  query: string;
  title: string;
  updatedAt: string;
}>;

const INITIAL_CONVERSATIONS: readonly Conversation[] = [
  {
    id: "react-form-validation",
    query: "React için form doğrulama kütüphanesi arıyorum",
    title: "React için form doğrulama kütüphanesi arıyorum",
    updatedAt: "2026-09-01T09:00:00.000Z",
  },
  {
    id: "node-structured-logging",
    query: "Node.js logger: Structured logging",
    title: "Node.js logger: Structured logging",
    updatedAt: "2026-09-01T08:00:00.000Z",
  },
];

function readConversations(): Conversation[] {
  try {
    const stored = window.localStorage.getItem(CONVERSATIONS_KEY);
    if (stored === null) return [...INITIAL_CONVERSATIONS];
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is Conversation =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as Conversation).id === "string" &&
            typeof (item as Conversation).query === "string" &&
            typeof (item as Conversation).title === "string" &&
            typeof (item as Conversation).updatedAt === "string",
        ),
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}

function conversationTitle(query: string): string {
  const compact = query.replace(/\s+/gu, " ").trim();
  return compact.length > 46 ? `${compact.slice(0, 45).trimEnd()}…` : compact;
}

function profileInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("en-US") ?? "")
      .join("") || "U"
  );
}

function Sparkle() {
  return (
    <span className="sparkle" aria-hidden="true">
      ✦
    </span>
  );
}

export function App() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState<string | null>(() => parseSharedQuery(window.location.search));
  const [conversations, setConversations] = useState<Conversation[]>(readConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState(
    () => window.localStorage.getItem(PROFILE_NAME_KEY)?.trim() || "User",
  );
  const [profileDraft, setProfileDraft] = useState(profileName);
  const initialConversationRecorded = useRef(false);
  const intent = useMemo(() => (query ? parseIntent(query) : null), [query]);
  const plan = useMemo(() => (intent ? createSearchPlan(intent) : null), [intent]);

  const rememberConversation = useCallback(
    (value: string) => {
      const existing = conversations.find((item) => item.query === value);
      const id = existing?.id ?? crypto.randomUUID();
      const conversation: Conversation = {
        id,
        query: value,
        title: conversationTitle(value),
        updatedAt: new Date().toISOString(),
      };
      setConversations((current) =>
        [conversation, ...current.filter((item) => item.id !== id && item.query !== value)].slice(
          0,
          30,
        ),
      );
      setActiveConversationId(id);
    },
    [conversations],
  );

  useEffect(() => {
    window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    if (!query || initialConversationRecorded.current) return;
    initialConversationRecorded.current = true;
    rememberConversation(query);
  }, [query, rememberConversation]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery(null);
        setActiveConversationId(null);
        setDraft("");
        setSidebarOpen(false);
        setProfileOpen(false);
        window.history.replaceState({}, "", window.location.pathname);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = normalizeChatQuery(draft);
    if (!value) return;
    setQuery(value);
    rememberConversation(value);
    window.history.replaceState({}, "", shareUrl(window.location.href, value));
    setDraft("");
  }

  function startNewChat() {
    setQuery(null);
    setActiveConversationId(null);
    setDraft("");
    setSidebarOpen(false);
    setProfileOpen(false);
    window.history.replaceState({}, "", window.location.pathname);
  }

  function chooseSuggestion(title: string, detail: string) {
    const value = `${title}: ${detail}`;
    setDraft("");
    setQuery(value);
    rememberConversation(value);
    window.history.replaceState({}, "", shareUrl(window.location.href, value));
  }

  function openConversation(conversation: Conversation) {
    setQuery(conversation.query);
    setActiveConversationId(conversation.id);
    setSidebarOpen(false);
    window.history.replaceState({}, "", shareUrl(window.location.href, conversation.query));
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = profileDraft.replace(/\s+/gu, " ").trim();
    if (!value) return;
    setProfileName(value);
    window.localStorage.setItem(PROFILE_NAME_KEY, value);
    setProfileOpen(false);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <button type="button" className="brand" onClick={startNewChat} aria-label="LibAI home">
            <span className="brand-mark">
              <Sparkle />
            </span>
            <span>LibAI</span>
          </button>
          <button
            type="button"
            className="close-sidebar"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>

        <button type="button" className="new-chat" onClick={startNewChat}>
          <span>＋</span> New search <kbd>⌘ K</kbd>
        </button>

        <nav className="history" aria-label="Search history">
          <section>
            <h2>Recent searches</h2>
            {conversations.length === 0 ? (
              <p className="history-empty">Your first search will appear here.</p>
            ) : (
              conversations.map((conversation) => (
                <button
                  type="button"
                  key={conversation.id}
                  className={activeConversationId === conversation.id ? "active" : ""}
                  onClick={() => openConversation(conversation)}
                  title={conversation.query}
                >
                  <span>{conversation.title}</span>
                  <time dateTime={conversation.updatedAt}>
                    {new Date(conversation.updatedAt).toLocaleDateString("en-US", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </time>
                </button>
              ))
            )}
          </section>
        </nav>

        <div className="sidebar-bottom">
          {profileOpen && (
            <form id="profile-menu" className="profile-menu" onSubmit={saveProfile}>
              <label htmlFor="profile-name">Display name</label>
              <input
                id="profile-name"
                value={profileDraft}
                onChange={(event) => setProfileDraft(event.target.value)}
                maxLength={60}
              />
              <p>This information is stored only on this device.</p>
              <div>
                <button type="button" onClick={() => setProfileOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="profile-save" disabled={!profileDraft.trim()}>
                  Save
                </button>
              </div>
            </form>
          )}
          <button
            type="button"
            aria-expanded={profileOpen}
            aria-controls="profile-menu"
            onClick={() => {
              setProfileDraft(profileName);
              setProfileOpen((current) => !current);
            }}
          >
            <span className="avatar">{profileInitials(profileName)}</span>
            <span>
              <strong>{profileName}</strong>
              <small>Personal workspace</small>
            </span>
            <i className="account-chevron">{profileOpen ? "⌃" : "⌄"}</i>
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="scrim"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        />
      )}

      <main className={`main ${query ? "conversation" : "welcome"}`} id="top">
        <header className="mobile-header">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open search history"
          >
            ☰
          </button>
          <span>
            <Sparkle /> LibAI
          </span>
          <button type="button" onClick={startNewChat} aria-label="New search">
            ＋
          </button>
        </header>

        <div className="cloud cloud-one" />
        <div className="cloud cloud-two" />
        <div className="cloud cloud-three" />

        {!query ? (
          <section className="welcome-content">
            <div className="orb">
              <Sparkle />
            </div>
            <p className="overline">LIBRARY INTELLIGENCE</p>
            <h1>What are you building today?</h1>
            <p className="welcome-copy">
              Describe what you need. I’ll research the strongest open-source options and compare
              the evidence.
            </p>
            <Composer
              draft={draft}
              setDraft={setDraft}
              onSubmit={send}
              onAttach={() => setAdvisorOpen(true)}
            />
            <div className="suggestion-grid">
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion.title}
                  onClick={() => chooseSuggestion(suggestion.title, suggestion.detail)}
                >
                  <Sparkle />
                  <span>
                    <strong>{suggestion.title}</strong>
                    <small>{suggestion.detail}</small>
                  </span>
                  <b>→</b>
                </button>
              ))}
            </div>
            <p className="disclaimer">
              LibAI can make mistakes on important technical decisions. Verify the sources before
              you commit.
            </p>
          </section>
        ) : (
          <section className="thread">
            <div className="thread-head">
              <span>New search</span>
              <button type="button" onClick={startNewChat}>
                Start over
              </button>
            </div>
            <article className="message user-message">
              <div>{query}</div>
              <span className="user-avatar">{profileInitials(profileName)}</span>
            </article>
            {intent && plan && (
              <article className="message assistant-message">
                <span className="assistant-avatar">
                  <Sparkle />
                </span>
                <div className="assistant-body">
                  <p className="assistant-label">LibAI</p>
                  <h2>I understand what you’re looking for.</h2>
                  <p>
                    I’ll search the <strong>{intent.ecosystem}</strong> ecosystem for a library
                    focused on <strong>{intent.task}</strong>.
                  </p>
                  {intent.constraints.length > 0 && (
                    <div className="understood">
                      <span>Preferences I’ll account for</span>
                      <div>
                        {intent.constraints.map((constraint) => (
                          <b
                            key={`${constraint.kind}-${constraint.value}`}
                            className={constraint.operator}
                          >
                            {constraint.operator === "excluded" ? "−" : "+"} {constraint.value}
                          </b>
                        ))}
                      </div>
                    </div>
                  )}
                  {intent.clarificationNeeded && intent.ambiguities[0] && (
                    <div className="question-card">
                      <span>?</span>
                      <div>
                        <strong>One detail needs clarification</strong>
                        <p>{intent.ambiguities[0].question}</p>
                      </div>
                    </div>
                  )}
                  <details className="research-plan">
                    <summary>
                      <span>Research plan</span>
                      <small>
                        {plan.sources.length} sources ·{" "}
                        {plan.sources.reduce((sum, source) => sum + source.queries.length, 0)}{" "}
                        queries
                      </small>
                    </summary>
                    <div className="plan-sources">
                      {plan.sources.map((source) => (
                        <div key={source.source}>
                          <span className={source.source}>
                            {source.source === "npm" ? "N" : "G"}
                          </span>
                          <div>
                            <strong>{source.source}</strong>
                            <code>{source.queries[0]}</code>
                          </div>
                          <small>{source.limit} candidates</small>
                        </div>
                      ))}
                    </div>
                  </details>
                  <div className="progress-note">
                    <i className="progress-dot" />
                    <span>
                      <strong>The evidence pipeline is ready.</strong> Candidates are ranked below
                      by source quality, freshness, risk, and an explainable score.
                    </span>
                  </div>
                  <ResultExperience key={query} query={query} intent={intent} />
                </div>
              </article>
            )}
            <div className="thread-composer">
              <Composer
                draft={draft}
                setDraft={setDraft}
                onSubmit={send}
                onAttach={() => setAdvisorOpen(true)}
                compact
              />
            </div>
          </section>
        )}
      </main>
      {advisorOpen && <AdvisorPanel onClose={() => setAdvisorOpen(false)} />}
    </div>
  );
}

function AdvisorPanel({ onClose }: Readonly<{ onClose: () => void }>) {
  const [manifest, setManifest] = useState(
    '{\n  "name": "my-app",\n  "dependencies": {\n    "react": "^19.0.0",\n    "moment": "^2.30.0"\n  }\n}',
  );
  const [report, setReport] = useState<AdvisorReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function analyze() {
    try {
      setReport(analyzePackageJson(manifest));
      setError(null);
    } catch (caught) {
      setReport(null);
      setError(caught instanceof Error ? caught.message : "Could not analyze package.json");
    }
  }

  return (
    <div className="advisor-backdrop" role="presentation">
      <section
        className="advisor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="advisor-title"
      >
        <header>
          <div>
            <span className="section-kicker">Dependency advisor</span>
            <h2 id="advisor-title">Review project context</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dependency advisor">
            ×
          </button>
        </header>
        <p>
          Your package.json is analyzed on this device only. Do not include secrets. The maximum
          file size is 64 KiB.
        </p>
        <textarea
          value={manifest}
          onChange={(event) => setManifest(event.target.value)}
          aria-label="package.json content"
          spellCheck={false}
        />
        <div className="advisor-actions">
          <button
            type="button"
            onClick={() => {
              setManifest("");
              setReport(null);
            }}
          >
            Clear
          </button>
          <button type="button" className="primary" onClick={analyze}>
            Analyze
          </button>
        </div>
        {error && (
          <p className="advisor-error" role="alert">
            {error}
          </p>
        )}
        {report && (
          <div className="advisor-report">
            <div>
              <strong>{report.projectName}</strong>
              <span>{report.context.frameworks.join(", ") || "Framework unknown"}</span>
              <span>{report.context.runtimes.join(", ") || "Runtime unknown"}</span>
            </div>
            {report.optimizations.map((item) => (
              <article key={item.packageName}>
                <b>{item.packageName}</b>
                <span className={item.action}>{item.action}</span>
                <p>{item.reason}</p>
                <small>
                  Migration effort: {item.migrationEffort}
                  {item.alternative ? ` · Alternative: ${item.alternative}` : ""}
                </small>
              </article>
            ))}
            {report.conflicts.map((conflict) => (
              <p className="advisor-error" key={conflict}>
                {conflict}
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ResultExperience({ query, intent }: Readonly<{ query: string; intent: SearchIntent }>) {
  const [editedTask, setEditedTask] = useState(intent.task);
  const [step, setStep] = useState(0);
  const [state, setState] = useState<ResultState>("loading");
  const [recommendations, setRecommendations] = useState<readonly RecommendationCard[]>([]);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [feedback, setFeedback] = useState<Readonly<Record<string, "helpful" | "not-helpful">>>({});
  const requestSequence = useRef(0);

  const load = useCallback(async (nextIntent: SearchIntent) => {
    const sequence = ++requestSequence.current;
    setEditedTask(nextIntent.task);
    setStep(0);
    setState("loading");
    setRecommendations([]);
    setWarnings([]);
    setSelected([]);
    setStep(1);
    try {
      const snapshot = await searchRecommendations(nextIntent);
      if (sequence !== requestSequence.current) return;
      const cards = recommendationCards(snapshot);
      setRecommendations(cards);
      setWarnings(snapshot.warnings);
      setStep(pipelineSteps.length - 1);
      setState(cards.length === 0 ? "empty" : snapshot.status);
    } catch {
      if (sequence !== requestSequence.current) return;
      setStep(0);
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(intent), 0);
    return () => {
      window.clearTimeout(timer);
      requestSequence.current += 1;
    };
  }, [intent, load]);

  const comparison = recommendations.filter((item) => selected.includes(item.id));
  const statusMessage =
    state === "loading"
      ? "Searching live npm and GitHub sources while Ollama prepares evidence-based summaries."
      : state === "complete"
        ? `${recommendations.length} live candidates found and ranked.`
        : state === "partial"
          ? `${recommendations.length} candidates found; some external signals are unavailable.`
          : state === "empty"
            ? "No verified npm candidates matched this query."
            : "Live sources are unavailable. Check the API and Ollama status.";

  async function copyShareLink() {
    await navigator.clipboard?.writeText(shareUrl(window.location.href, query));
  }

  return (
    <section className="result-experience" aria-live="polite">
      <div className="intent-review">
        <div>
          <span className="section-kicker">Search scope</span>
          <strong>Refine the requirement</strong>
        </div>
        <label>
          <span>Objective</span>
          <input
            value={editedTask}
            onChange={(event) => setEditedTask(event.target.value)}
            maxLength={300}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            void load({ ...intent, task: editedTask.trim() });
          }}
        >
          Re-evaluate
        </button>
      </div>

      <ol className="pipeline" aria-label="Search progress">
        {pipelineSteps.map((label, index) => (
          <li key={label} className={index <= step ? "done" : "pending"}>
            <i>{index < step || state !== "loading" ? "✓" : index + 1}</i>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      <div className={`result-status ${state}`} role="status">
        <span>
          {state === "loading"
            ? "Searching"
            : state === "complete"
              ? "Ready"
              : state === "partial"
                ? "Partial results"
                : state === "empty"
                  ? "No results"
                  : "Error"}
        </span>
        <p>{statusMessage}</p>
        {warnings.length > 0 && <small>{warnings.join(" · ")}</small>}
        <button type="button" onClick={copyShareLink}>
          Copy link
        </button>
      </div>

      {recommendations.length > 0 && (
        <div className="recommendations">
          {recommendations.map((candidate, index) => (
            <article className="recommendation-card" key={candidate.id}>
              <header>
                <span className="rank">#{index + 1}</span>
                <div>
                  <h3>{candidate.name}</h3>
                  <small>
                    {candidate.version ? `v${candidate.version}` : candidate.id} ·{" "}
                    {candidate.generatedBy === "ollama" ? "Ollama" : "Deterministic fallback"}
                  </small>
                </div>
                <strong className="score">{candidate.score}</strong>
              </header>
              <p>{candidate.summary}</p>
              <div className="signal-row">
                <span>{candidate.weeklyDownloads} / week</span>
                <span>{candidate.stars} GitHub stars</span>
                <span>{candidate.license}</span>
                <span className={candidate.freshness}>Freshness: {candidate.freshness}</span>
                <span className={`risk-${candidate.risk}`}>Risk: {candidate.risk}</span>
              </div>
              <div className="score-bars">
                {Object.entries(candidate.components).map(([name, value]) => (
                  <div key={name}>
                    <span>{name}</span>
                    <i>
                      <b style={{ width: `${value}%` }} />
                    </i>
                    <small>{value}</small>
                  </div>
                ))}
              </div>
              <details className="evidence-list">
                <summary>Evidence and provenance</summary>
                <ul>
                  {candidate.evidence.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p>Confidence: %{Math.round(candidate.confidence * 100)}</p>
              </details>
              <footer>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(candidate.id)}
                    onChange={() => setSelected(toggleComparison(selected, candidate.id))}
                  />
                  Compare
                </label>
                <fieldset>
                  <legend>Feedback on {candidate.name}</legend>
                  <button
                    type="button"
                    aria-pressed={feedback[candidate.id] === "helpful"}
                    onClick={() =>
                      setFeedback(optimisticFeedback(feedback, candidate.id, "helpful"))
                    }
                  >
                    Helpful
                  </button>
                  <button
                    type="button"
                    aria-pressed={feedback[candidate.id] === "not-helpful"}
                    onClick={() =>
                      setFeedback(optimisticFeedback(feedback, candidate.id, "not-helpful"))
                    }
                  >
                    Not relevant
                  </button>
                </fieldset>
              </footer>
            </article>
          ))}
        </div>
      )}

      {comparison.length >= 2 && (
        <div className="comparison" tabIndex={-1}>
          <div>
            <span className="section-kicker">Side by side</span>
            <h3>Compare {comparison.length} candidates</h3>
          </div>
          <div className="comparison-grid">
            {comparison.map((candidate) => (
              <article key={candidate.id}>
                <strong>{candidate.name}</strong>
                <b>{candidate.score}/100</b>
                <span>{candidate.license}</span>
                <span>{candidate.weeklyDownloads} / week</span>
                <span>Risk: {candidate.risk}</span>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Composer({
  draft,
  setDraft,
  onSubmit,
  compact = false,
  onAttach,
}: Readonly<{
  draft: string;
  setDraft: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  compact?: boolean;
  onAttach: () => void;
}>) {
  return (
    <form className={`composer ${compact ? "compact" : ""}`} onSubmit={onSubmit}>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="What kind of library are you looking for?"
        aria-label="Message LibAI"
        rows={compact ? 1 : 2}
        minLength={MIN_CHAT_QUERY_LENGTH}
        maxLength={MAX_CHAT_QUERY_LENGTH}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="composer-actions">
        <button
          type="button"
          className="attach"
          aria-label="Add project context"
          onClick={onAttach}
        >
          ＋
        </button>
        <span>Shift + Enter for a new line</span>
        <button
          type="submit"
          className="send"
          disabled={normalizeChatQuery(draft) === null}
          aria-label="Send message"
        >
          ↑
        </button>
      </div>
    </form>
  );
}
