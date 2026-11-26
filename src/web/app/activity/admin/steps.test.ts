import { expect, test } from "bun:test";
import { backfill, run } from "./fixtures.ts";
import {
  announceConfirm,
  announceGate,
  backfillAction,
  parseYearInput,
  processGate,
  resumeGate,
  notYetSent,
  processConfirm,
  sendConfirm,
  sendGate,
  sendRefusal,
  serverLinkReady,
  signupConfirm,
} from "./steps.ts";

const DEC_20_2026 = Date.UTC(2026, 11, 20) / 1000;

test("parseYearInput accepts four-digit years in range only", () => {
  expect(parseYearInput("2026")).toBe(2026);
  expect(parseYearInput(" 2026 ")).toBe(2026);
  expect(parseYearInput("2014")).toBeNull();
  expect(parseYearInput("2101")).toBeNull();
  expect(parseYearInput("20.6")).toBeNull();
  expect(parseYearInput("")).toBeNull();
});

test("processGate refuses while a run works, is interrupted, or the year is bad", () => {
  expect(processGate(null, 2026).enabled).toBe(false);
  expect(processGate(run({ status: "processing" }), 2026).enabled).toBe(false);
  expect(processGate(run({ status: "sending" }), 2026).enabled).toBe(false);
  expect(processGate(run({ status: "idle" }), null).reason).toContain("whole year");
  const interrupted = processGate(run({ status: "interrupted" }), 2026);
  expect(interrupted.enabled).toBe(false);
  expect(interrupted.reason).toBe("Resume the interrupted run first. Processing again would abandon it.");
  for (const status of ["idle", "processed", "done", "failed"] as const) {
    expect(processGate(run({ status }), 2026)).toEqual({ enabled: true, reason: null });
  }
});

test("sendGate opens once processed or done, or failed after full processing", () => {
  expect(sendGate(run({ status: "idle" })).reason).toBe("Process a year first.");
  expect(sendGate(run({ status: "processing" })).enabled).toBe(false);
  expect(sendGate(run({ status: "sending" })).enabled).toBe(false);
  expect(sendGate(run({ status: "interrupted" })).reason).toBe("Resume the interrupted run first.");
  expect(sendGate(run({ status: "processed", processed: 40 })).enabled).toBe(true);
  expect(sendGate(run({ status: "done", processed: 40 })).enabled).toBe(true);
  expect(sendGate(run({ status: "failed", processed: 40 })).enabled).toBe(true);
  expect(sendGate(run({ status: "failed", processed: 12 })).enabled).toBe(false);
});

test("announceGate opens once processed or done and only once a year", () => {
  expect(announceGate(run({ status: "idle" })).reason).toBe("Process a year first.");
  expect(announceGate(run({ status: "processing" })).enabled).toBe(false);
  expect(announceGate(run({ status: "sending" })).reason).toBe("Wait for the DMs to finish.");
  expect(announceGate(run({ status: "processed" })).enabled).toBe(true);
  expect(announceGate(run({ status: "done" })).enabled).toBe(true);
  expect(announceGate(run({ status: "done", announcedAt: DEC_20_2026 }))).toEqual({
    enabled: false,
    reason: "Posted on 20 Dec 2026.",
  });
});

test("announceGate explains a failed run by how far processing got", () => {
  const sent = announceGate(run({ status: "failed", processed: 40 }));
  expect(sent).toEqual({ enabled: false, reason: "The run failed. Send again, or process the year again." });
  expect(announceGate(run({ status: "failed", processed: 12 })).reason).toBe(
    "Processing failed part way. Process the year again.",
  );
});

test("every shut gate gives a sentence-case reason with a full stop", () => {
  const statuses = ["idle", "processing", "processed", "sending", "done", "failed", "interrupted"] as const;
  const reasons = statuses.flatMap((status) => {
    const s = run({ status, processed: status === "failed" ? 12 : 40 });
    return [processGate(s, 2026), processGate(s, null), sendGate(s), announceGate(s), resumeGate(s)]
      .map((g) => g.reason)
      .filter((r): r is string => r != null);
  });
  expect(reasons.length).toBeGreaterThan(10);
  for (const r of reasons) expect(r).toMatch(/^[A-Z].*\.$/);
});

test("resumeGate opens only for an interrupted run", () => {
  expect(resumeGate(run({ status: "interrupted" })).enabled).toBe(true);
  expect(resumeGate(run({ status: "failed" })).enabled).toBe(false);
  expect(resumeGate(null).enabled).toBe(false);
});

test("sendConfirm asks only when the send is allowed, naming the year and the members not sent yet", () => {
  expect(sendConfirm(null, true)).toBeNull();
  expect(sendConfirm(run({ status: "processing" }), true)).toBeNull();
  expect(sendConfirm(run({ status: "sending" }), true)).toBeNull();
  const ask = sendConfirm(run({ status: "processed", processed: 40, optedIn: 212 }), true)!;
  expect(ask.message).toStartWith("Send the 2026 DMs now to the 212 members who opted in and have not been sent yet?");
  expect(ask.message).toContain("the announcement is posted");
  expect(ask.confirmLabel).toBe("send dms");
  expect(ask.tone).toBe("gold");
  expect(sendConfirm(run({ status: "processed", processed: 40, optedIn: 1 }), false)!.message).toContain(
    "the 1 member who opted in and has not been sent yet? ",
  );
  expect(sendConfirm(run({ status: "done", processed: 40 }), false)!.message).toContain("No announcement is posted.");
  expect(sendConfirm(run({ status: "done", processed: 40, optedIn: 30, sent: 26 }), false)!.message).toStartWith(
    "Send the 2026 DMs now to about 4 members who opted in and have not been sent yet?",
  );
});

test("notYetSent is opted in minus sent, exact only before any send", () => {
  expect(notYetSent(run({ optedIn: 30, sent: 0 }))).toEqual({ count: 30, exact: true });
  expect(notYetSent(run({ optedIn: 30, sent: 12 }))).toEqual({ count: 18, exact: false });
  expect(notYetSent(run({ optedIn: 3, sent: 5 }))).toEqual({ count: 0, exact: false });
});

test("processConfirm warns only when the chosen year has sent links", () => {
  expect(processConfirm(null, 2026)).toBeNull();
  expect(processConfirm(run({ status: "processed" }), 2026)).toBeNull();
  expect(processConfirm(run({ status: "done", sent: 12 }), 2025)).toBeNull();
  expect(processConfirm(run({ status: "done", sent: 12 }), null)).toBeNull();
  expect(processConfirm(run({ status: "sending", sent: 12 }), 2026)).toBeNull();
  const ask = processConfirm(run({ status: "done", sent: 12 }), 2026)!;
  expect(ask.message).toBe(
    "Process 2026 again? Links already went out for it. The stories not sent yet are rebuilt; the 12 stories already sent stay as they are.",
  );
  expect(ask.confirmLabel).toBe("process");
  expect(processConfirm(run({ status: "done", sent: 1 }), 2026)!.message).toContain("the 1 story already sent");
});

test("sendRefusal words every outcome that is not a start", () => {
  expect(sendRefusal(202, { result: "started" }, null)).toBeNull();
  expect(sendRefusal(409, { result: "already-running" }, "conflict")).toBe("the DMs are going out already");
  expect(sendRefusal(409, { result: "not-processed" }, "conflict")).toBe("the run is not processed yet");
  expect(sendRefusal(400, { error: "bad announce flag" } as { result?: string }, "bad announce flag")).toBe("bad announce flag");
  expect(sendRefusal(401, null, "unauthorized")).toBe("your session ended");
  expect(sendRefusal(403, null, "Forbidden")).toBe("you do not have access");
  expect(sendRefusal(0, null, null)).toBe("no answer");
});

test("announceConfirm asks only when the post is allowed", () => {
  expect(announceConfirm(null)).toBeNull();
  expect(announceConfirm(run({ status: "sending" }))).toBeNull();
  expect(announceConfirm(run({ status: "done", announcedAt: DEC_20_2026 }))).toBeNull();
  const ask = announceConfirm(run({ status: "done", processed: 40 }))!;
  expect(ask.message).toBe(
    "Post the server Wrapped of 2026 in the announcements channel now? Everyone sees it, and it goes out once a year.",
  );
  expect(ask.confirmLabel).toBe("post");
});

test("serverLinkReady waits for processing to build the server wrapped", () => {
  expect(serverLinkReady(run({ status: "idle" }))).toBe(false);
  expect(serverLinkReady(run({ status: "processing" }))).toBe(false);
  expect(serverLinkReady(run({ status: "processed" }))).toBe(true);
  expect(serverLinkReady(run({ status: "done" }))).toBe(true);
  expect(serverLinkReady(run({ status: "failed", announcedAt: 5 }))).toBe(true);
});

test("backfillAction names the main button for each state", () => {
  expect(backfillAction(backfill({ status: "idle" }))).toBe("start");
  expect(backfillAction(backfill({ status: "stopped" }))).toBe("resume");
  expect(backfillAction(backfill({ status: "done" }))).toBe("run again");
  expect(backfillAction(backfill({ status: "failed" }))).toBe("run again");
  expect(backfillAction(backfill({ status: "running" }))).toBeNull();
});

test("signupConfirm asks before every post, first or again", () => {
  const first = { year: 2026, posted: false, buttons: false, closed: false, optedIn: 0 };
  expect(signupConfirm(first, true).message).toBe(
    "Post the 2026 sign-up message in the announcements channel now, with opt in and opt out buttons? Everyone sees it.",
  );
  const again = signupConfirm({ ...first, posted: true, buttons: true }, false);
  expect(again.message).toBe(
    "A sign-up message for 2026 is up already. Post a new one, without buttons? The new message takes over the sign-ups.",
  );
  expect(again.confirmLabel).toBe("post");
});
