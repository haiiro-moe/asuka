/**
 * Browser entry point of the dashboard SPA. One HTML shell serves three entry points, picked by
 * `location.pathname`: `/club-announce/:token` (the club announcement composer), `/panel/:token` (a
 * purchased panel's editor) and everything else (the dashboard, {@link App}, with its own hash routes).
 * The two token pages sit in {@link StandaloneShell} so they get the same haiiro backdrop and scope.
 *
 * @module
 */
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ClubAnnouncePage } from "./ClubAnnouncePage.tsx";
import { PanelPage } from "./PanelPage.tsx";
import { StandaloneShell } from "./ui/index.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const announceMatch = location.pathname.match(/^\/club-announce\/([^/]+)/);
const panelMatch = location.pathname.match(/^\/panel\/([^/]+)/);
// the dashboard sets its own per-page title (App); the token pages get theirs here
if (announceMatch) document.title = "announce · asuka";
else if (panelMatch) document.title = "panel · asuka";
root.render(
  announceMatch ? (
    <StandaloneShell>
      <ClubAnnouncePage token={announceMatch[1]!} />
    </StandaloneShell>
  ) : panelMatch ? (
    <StandaloneShell>
      <PanelPage token={panelMatch[1]!} />
    </StandaloneShell>
  ) : (
    <App />
  ),
);
