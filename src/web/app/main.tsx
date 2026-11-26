/**
 * Browser entry point of the dashboard SPA. One HTML shell serves five entry points, picked by
 * `location.pathname`: `/club-announce/:token` (the club announcement composer), `/panel/:token` (a
 * purchased panel's editor), `/wrapped/s/:token` (the server Wrapped story), `/wrapped/:token` (a
 * member's Wrapped story) and everything else (the dashboard, {@link App}, with its own hash routes).
 * The announce and panel pages sit in {@link StandaloneShell}; the Wrapped stories draw their own
 * phone-shaped frame on the same backdrop. The server pattern is tested first, so `s` is never read
 * as a member token.
 *
 * @module
 */
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ClubAnnouncePage } from "./ClubAnnouncePage.tsx";
import { PanelPage } from "./PanelPage.tsx";
import { WrappedServerStory } from "./activity/wrapped/WrappedServerStory.tsx";
import { WrappedStory } from "./activity/wrapped/WrappedStory.tsx";
import { StandaloneShell } from "./ui/index.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const announceMatch = location.pathname.match(/^\/club-announce\/([^/]+)/);
const panelMatch = location.pathname.match(/^\/panel\/([^/]+)/);
const wrappedServerMatch = location.pathname.match(/^\/wrapped\/s\/([^/]+)/);
const wrappedMatch = wrappedServerMatch ? null : location.pathname.match(/^\/wrapped\/([^/]+)/);
// the dashboard sets its own per-page title (App); the token pages get theirs here (never a token or a name)
if (announceMatch) document.title = "announce · asuka";
else if (panelMatch) document.title = "panel · asuka";
else if (wrappedServerMatch || wrappedMatch) document.title = "wrapped · asuka";
root.render(
  announceMatch ? (
    <StandaloneShell>
      <ClubAnnouncePage token={announceMatch[1]!} />
    </StandaloneShell>
  ) : panelMatch ? (
    <StandaloneShell>
      <PanelPage token={panelMatch[1]!} />
    </StandaloneShell>
  ) : wrappedServerMatch ? (
    <WrappedServerStory token={wrappedServerMatch[1]!} />
  ) : wrappedMatch ? (
    <WrappedStory token={wrappedMatch[1]!} />
  ) : (
    <App />
  ),
);
