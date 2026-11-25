// The changelog should stay available from the footer and never open at launch.
import { join } from "node:path";
import { App, SHOWN, sleep } from "../lib/app.mjs";

export const name = "whatsnew";
export const writes = false;

const DIALOG = `[...document.querySelectorAll(".modal.whats-new")].find(${SHOWN})`;
const LINK = 'document.querySelector(".colophon .whats-new-link")';
const VERSION = '(document.querySelector(".colophon-name")?.textContent.match(/\\d+\\.\\d+\\.\\d+/) ?? [null])[0]';

async function restart(copy) {
  await copy.waitFor('(window.__TAURI_INTERNALS__.callbacks?.size ?? 0) === 0', "the app's calls to finish", 5000).catch(() => {});
  await copy.js("window.smokeOldPage = true");
  await copy.send("Page.reload");
  await copy.waitFor(
    `!window.smokeOldPage && document.readyState === "complete" && !!document.querySelector(".connect, .views") && ${VERSION} !== null`,
    "the app to start again",
    60000,
  );
}

export async function run({ app, report }) {
  const copy = await App.start({ exe: app.exe, port: app.port + 6, folder: join(app.folder, "whatsnew") });
  try {
    await copy.waitFor(`${VERSION} !== null`, "the app's version");
    const version = await copy.js(VERSION);
    await sleep(1000);
    report.check("a new install starts directly", !(await copy.js(`Boolean(${DIALOG})`)));

    await copy.js(`localStorage.setItem("fmlibre.whatsNew", "0.5.1");
      localStorage.setItem("fmlibre.update", JSON.stringify({ checkedAt: Date.now(), current: "0.5.1", newer: null }))`);
    await restart(copy);
    await sleep(1500);
    report.check("an updated install also starts directly", !(await copy.js(`Boolean(${DIALOG})`)));

    await copy.click(LINK, "What's new");
    await copy.waitFor(DIALOG, "What's new from the footer");
    const title = await copy.js(`${DIALOG}.querySelector("h2").textContent`);
    const items = await copy.js(`${DIALOG}.querySelectorAll("li").length`);
    report.check("the changelog is available manually", title.includes(version) && items > 0, title);
    await copy.shot("whatsnew");
    await copy.press("Escape");
    await copy.waitFor(`!${DIALOG}`, "What's new to close");
    report.check("Escape closes the changelog", true);
    report.check("no errors in the copy's console", copy.consoleProblems.length === 0, copy.consoleProblems.slice(0, 3).join(" || "));
  } finally {
    copy.close();
  }
}
