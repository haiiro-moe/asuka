import { useEffect, useRef, useState } from "react";
import { api, type Me } from "./api.ts";
import { PAGES } from "./pages.tsx";
import { UserName } from "./names.tsx";
import { MemberProfilePage } from "./MemberProfilePage.tsx";
import { MeContext, ROLE_RANK, isKnownRole } from "./me-context.ts";
import { Blobs, InkLink, Loading, PageHead, PromptLine, Window, cx } from "./ui/index.ts";

type Page = (typeof PAGES)[number];
type Role = Me["role"];

/** The side nav's groups: each page goes under the lowest role that sees it. */
const GROUPS: { role: Role; label: string }[] = [
  { role: "user", label: "community" },
  { role: "president", label: "president" },
  { role: "admin", label: "admin" },
];

/** The narrator's line under each page title (second person, present tense). */
const LEDES: Record<string, string> = {
  overview: "You look over the server from the top. The numbers keep moving while you read them.",
  profile: "Your card, your inventory and what you have bought. The mirror is honest.",
  store: "The shelves hold things that cost social credits. You count your coins.",
  leaderboard: "Everyone who talks, ranked by experience. Somebody is always one message ahead.",
  clubs: "The clubs of the server, from threads to their own channels. Each one began as a request.",
  events: "What is coming up, day by day. You check whether the evening is free.",
  "presidency-history": "Every president the server has had, in order. Their portraits line the corridor.",
  president: "The president's desk: the weekly theme and the clubs that wait for a verdict.",
  config: "The settings the bot reads. You change one, and it listens.",
  autoreplies: "Words the bot answers on its own. It waits for someone to say them.",
  elections: "Candidates, ballots and the calendar of votes. The ballot box sits in the corner.",
  moderation: "Warnings and the mod log. You read what happened while you were away.",
  "store-items": "What the store sells and how much is left. You stock the shelves from here.",
  activity: "The whole server's hours and habits, counted. You see when everyone talks and where.",
  "activity-president": "The numbers of the server, without the graph of who said what. You read the room.",
  "activity-admin": "Who talks to whom, and where the server goes quiet. You follow the threads.",
  "events-editor": "Where events and their groups are written. You plan the evenings for everyone.",
};

/** What the hash asks for: a member's profile (`#/member/:id`), a page (`#/<page id>`) or nothing. */
type Route = { kind: "member"; id: string } | { kind: "page"; id: string | null };

function parseHash(hash: string): Route {
  const member = hash.match(/^#\/member\/(\d+)/);
  if (member) return { kind: "member", id: member[1]! };
  const page = hash.match(/^#\/([a-z0-9-]+)/);
  return { kind: "page", id: page ? page[1]! : null };
}

/** A page's display name: its label in lowercase (`Presidency History` becomes `presidency history`). */
const pageName = (p: Page) => p.label.toLowerCase();

/** The narrator's line while the session is checked. */
function Opening() {
  return (
    <div className="fx min-h-screen">
      <Blobs />
      <div className="fx-body">
        <main className="fx-main">
          <Loading>You knock, and somebody looks for your name on the list</Loading>
        </main>
      </div>
    </div>
  );
}

/** The signed-out screen: one window with the Discord login. */
function SignIn() {
  return (
    <div className="fx min-h-screen">
      <Blobs />
      <div className="fx-body justify-center">
        <main className="fx-main w-full max-w-[640px]">
          <section className="fx-head">
            <PromptLine cmd="login" />
            <h1 className="title">asuka</h1>
          </section>
          <Window label="fish: ~/login">
            <p className="nar">
              The door is shut, and a lamp burns behind it. Sign in with Discord to see the server's stats, the
              leaderboard and the store.
            </p>
            <div className="btns">
              <InkLink tone="gold" href="/auth/login">
                login with discord
              </InkLink>
            </div>
          </Window>
        </main>
      </div>
    </div>
  );
}

/**
 * The dashboard: checks the session, then renders the haiiro SiteShell (top bar with the prompt line,
 * side nav window grouped by role, phone page strip, the blob backdrop) around the current page.
 *
 * Routes live in the hash: `#/<page id>` for a page of `PAGES` and `#/member/:id` for a member's
 * profile. Pages above the visitor's web role (user < president < admin) are not listed and fall back to
 * the first page. An `/api/me` answer with a role this build does not know shows the sign-in screen.
 * The document title follows the page: `<page> · asuka`.
 */
export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<"loading" | "in" | "out">("loading");
  const [hash, setHash] = useState(location.hash);
  const strip = useRef<HTMLElement>(null);

  useEffect(() => {
    const onHash = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
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

  // keep the current page visible in the phone strip, which scrolls sideways
  useEffect(() => {
    const show = () => {
      const s = strip.current;
      const on = s?.querySelector<HTMLElement>(".on");
      if (s && on) s.scrollLeft = on.offsetLeft - (s.clientWidth - on.offsetWidth) / 2;
    };
    show();
    // widths change once the bitmap font arrives
    document.fonts?.ready.then(show);
  }, [hash, status]);

  // an unknown role (a newer server, a bad answer) is treated like no session rather than a crash
  const role: Role | null = me && isKnownRole(me.role) ? me.role : null;
  const pages = role ? PAGES.filter((p) => ROLE_RANK[role] >= ROLE_RANK[p.minRole ?? "user"]) : [];
  const route = parseHash(hash);
  const member = route.kind === "member" ? route.id : null;
  const active: Page | undefined = pages.find((p) => route.kind === "page" && p.id === route.id) ?? pages[0];
  const signedOut = status === "out" || (status === "in" && !active);

  useEffect(() => {
    document.title =
      status === "loading"
        ? "asuka"
        : signedOut || !active
          ? "login · asuka"
          : `${member ? "profile" : pageName(active)} · asuka`;
  }, [status, signedOut, member, active]);

  if (status === "loading") return <Opening />;
  if (signedOut || !role || !active) return <SignIn />;

  const where = member ? `~/member/${member}` : `~/${active.id}`;
  const isOn = (p: Page) => !member && p.id === active.id;

  return (
    <MeContext.Provider value={me}>
      <div className="fx min-h-screen">
        <Blobs />
        <header className="fx-bar">
          <span className="fx-brand">asuka</span>
          <PromptLine as="span" className="fx-where" cmd="cd" args={where} />
          <span className="grp">
            <span className="text-subtle">{role}</span>
            {me?.userId && (
              <span className="c6">
                <UserName id={me.userId} />
              </span>
            )}
            <a className="ink flat" href="/auth/logout">
              logout
            </a>
          </span>
        </header>

        <nav ref={strip} className="fx-strip" aria-label="pages">
          {pages.map((p) => (
            <a key={p.id} href={`#/${p.id}`} className={cx(isOn(p) && "on")} aria-current={isOn(p) ? "page" : undefined}>
              {pageName(p)}
            </a>
          ))}
        </nav>

        <div className="fx-body">
          <aside className="fx-side">
            <Window
              as="nav"
              ariaLabel="pages"
              label="ls ~/asuka"
              foot={
                <>
                  <span>role {role}</span>
                  {me?.userId && (
                    <span className="r">
                      <UserName id={me.userId} />
                    </span>
                  )}
                </>
              }
            >
              {GROUPS.map((g) => {
                const list = pages.filter((p) => (p.minRole ?? "user") === g.role);
                if (!list.length) return null;
                return (
                  <div key={g.role}>
                    <span className="lab">{g.label}</span>
                    <div className="list">
                      {list.map((p) => (
                        <a
                          key={p.id}
                          href={`#/${p.id}`}
                          className={cx("li", isOn(p) && "sel")}
                          aria-current={isOn(p) ? "page" : undefined}
                        >
                          <span className="mk" aria-hidden="true">
                            »
                          </span>
                          <span className="grow">{pageName(p)}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </Window>
          </aside>

          <main className="fx-main">
            {member ? (
              <>
                <PageHead title="profile" args={`~/member/${member}`} lede="A member's card, as the server sees it." />
                <MemberProfilePage key={member} userId={member} />
              </>
            ) : (
              <>
                <PageHead title={pageName(active)} lede={LEDES[active.id]} />
                {active.el}
              </>
            )}
          </main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
