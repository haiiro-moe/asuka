import { useEffect, useState } from "react";
import { api, type Me } from "./api.ts";
import { PAGES } from "./pages.tsx";
import { UserName } from "./names.tsx";
import { MemberProfilePage } from "./MemberProfilePage.tsx";
import { MeContext, ROLE_RANK } from "./me-context.ts";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<"loading" | "in" | "out">("loading");
  const [tab, setTab] = useState("overview");
  // Hash route (#/member/:id) renders the profile page instead of the tab.
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m);
        setStatus("in");
      })
      .catch(() => setStatus("out"));
  }, []);

  if (status === "loading") {
    return <div className="p-8 comic-title text-3xl tilt inline-block">Loading…</div>;
  }

  if (status === "out") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="comic-panel text-center space-y-4 p-8 max-w-md tilt">
          <h1 className="comic-title text-6xl">ASUKA</h1>
          <p className="text-ink-soft font-bold">
            Sign in with Discord to see server stats, the leaderboard and the store.
          </p>
          <a href="/auth/login" className="comic-btn inline-block px-5 py-2">
            Login with Discord
          </a>
        </div>
      </div>
    );
  }

  const rank = ROLE_RANK[me?.role ?? "user"];
  const pages = PAGES.filter((p) => rank >= ROLE_RANK[p.minRole ?? "user"]);
  const active = pages.find((p) => p.id === tab) ?? pages[0]!;
  const memberMatch = hash.match(/^#\/member\/(\d+)/);

  return (
    <MeContext.Provider value={me}>
    <div className="min-h-screen flex flex-col md:flex-row md:items-start gap-4 md:gap-6 p-3 sm:p-6">
      <aside className="comic-panel w-full md:w-56 shrink-0 p-4 md:sticky md:top-6">
        <div className="comic-title text-3xl md:text-4xl mb-3 md:mb-4 tilt">ASUKA</div>
        <nav className="flex flex-wrap gap-1 md:flex-col">
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setTab(p.id);
                // Leave a member profile when navigating via the sidebar.
                if (location.hash) history.replaceState(null, "", location.pathname);
                setHash("");
              }}
              className={
                "text-left px-3 py-1.5 rounded-lg text-sm font-bold border-2 transition md:w-full " +
                (active.id === p.id && !memberMatch
                  ? "border-black bg-sun shadow-[3px_3px_0_#000]"
                  : "border-transparent hover:bg-paper-dim")
              }
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="pt-4 mt-4 border-t-2 border-black/20 text-xs text-ink-soft font-bold">
          {me?.role} · {me?.userId ? <UserName id={me.userId} /> : null}
          <a href="/auth/logout" className="block mt-2 underline hover:text-ink">
            Logout
          </a>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        {memberMatch ? (
          <>
            <h2 className="comic-title text-4xl sm:text-5xl mb-5 tilt inline-block">Profile</h2>
            <MemberProfilePage key={memberMatch[1]} userId={memberMatch[1]!} />
          </>
        ) : (
          <>
            <h2 className="comic-title text-4xl sm:text-5xl mb-5 tilt inline-block">{active.label}</h2>
            {active.el}
          </>
        )}
      </main>
    </div>
    </MeContext.Provider>
  );
}
