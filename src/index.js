import addOnUISdk from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";

const API = "https://api.languagetool.org/v2";
const MAX_CHARS = 15000;        // stay below the 20 KB free-tier limit
const MIN_GAP_MS = 3200;        // 20 requests / minute
const SEP = "\n\n";

const $ = (id) => document.getElementById(id);
const els = { lang: $("lang"), check: $("check"), status: $("status"), results: $("results") };

let sandbox;
let nodeText = new Map();   // nodeId -> current text
let issues = [];
let lastRequest = 0;

const setStatus = (msg, isError = false) => {
  els.status.textContent = msg;
  els.status.classList.toggle("error", isError);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- LanguageTool ---------- */

async function loadLanguages() {
  try {
    const res = await fetch(`${API}/languages`);
    const langs = await res.json();
    langs.sort((a, b) => a.name.localeCompare(b.name));
    for (const l of langs) els.lang.add(new Option(l.name, l.longCode));
  } catch {
    for (const [c, n] of [["en-GB", "English (GB)"], ["en-US", "English (US)"], ["de-DE", "German"],
      ["fr", "French"], ["es", "Spanish"], ["pt-PT", "Portuguese"], ["it", "Italian"], ["nl", "Dutch"]]) {
      els.lang.add(new Option(n, c));
    }
  }
}

async function ltCheck(text) {
  const wait = lastRequest + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();

  const body = new URLSearchParams({ text, language: els.lang.value });
  if (els.lang.value === "auto") body.set("preferredVariants", "en-GB,de-DE,pt-PT,ca-ES");

  const res = await fetch(`${API}/check`, {
    method: "POST",
    headers: { Accept: "application/json" },
    body
  });
  if (res.status === 429) throw new Error("LanguageTool rate limit reached. Wait a minute and try again.");
  if (!res.ok) throw new Error(`LanguageTool error ${res.status}`);
  return (await res.json()).matches;
}

/* ---------- Scan ---------- */

// Batch text nodes into chunks so we make as few API calls as possible.
function buildChunks(nodes) {
  const chunks = [];
  let cur = { text: "", segs: [] };
  for (const n of nodes) {
    const t = n.text.slice(0, MAX_CHARS);
    if (cur.segs.length && cur.text.length + SEP.length + t.length > MAX_CHARS) {
      chunks.push(cur);
      cur = { text: "", segs: [] };
    }
    if (cur.segs.length) cur.text += SEP;
    cur.segs.push({ id: n.id, start: cur.text.length, end: cur.text.length + t.length });
    cur.text += t;
  }
  if (cur.segs.length) chunks.push(cur);
  return chunks;
}

async function runCheck() {
  els.check.disabled = true;
  els.results.innerHTML = "";
  issues = [];
  nodeText = new Map();

  try {
    const scope = document.querySelector('input[name="scope"]:checked').value;
    setStatus("Reading text from your design…");
    const nodes = await sandbox.getTextNodes(scope);
    if (!nodes.length) {
      setStatus(scope === "selection" ? "No text in the selection." : "No text found in the document.");
      return;
    }
    nodes.forEach((n) => nodeText.set(n.id, n.text));

    const chunks = buildChunks(nodes);
    let n = 0;
    for (const chunk of chunks) {
      setStatus(`Checking… (${++n}/${chunks.length})`);
      const matches = await ltCheck(chunk.text);
      for (const m of matches) {
        const seg = chunk.segs.find((s) => m.offset >= s.start && m.offset + m.length <= s.end);
        if (!seg) continue; // spans two text boxes; ignore
        issues.push({
          id: crypto.randomUUID(),
          nodeId: seg.id,
          offset: m.offset - seg.start,
          length: m.length,
          original: chunk.text.substr(m.offset, m.length),
          message: m.message,
          type: m.rule?.issueType || "other",
          category: m.rule?.category?.name || "",
          replacements: (m.replacements || []).slice(0, 4).map((r) => r.value)
        });
      }
    }
    render();
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    els.check.disabled = false;
  }
}

/* ---------- Render & fix ---------- */

function render() {
  els.results.innerHTML = "";
  if (!issues.length) {
    setStatus("No issues found. 🎉");
    return;
  }
  setStatus(`${issues.length} issue${issues.length === 1 ? "" : "s"} found.`);

  for (const issue of issues) {
    const text = nodeText.get(issue.nodeId) || "";
    const from = Math.max(0, issue.offset - 30);
    const to = Math.min(text.length, issue.offset + issue.length + 30);

    const card = document.createElement("div");
    card.className = `issue ${issue.type === "misspelling" ? "misspelling" : issue.type === "style" ? "style" : ""}`;

    const ctx = document.createElement("div");
    ctx.className = "ctx";
    ctx.append(
      (from > 0 ? "…" : "") + text.slice(from, issue.offset),
      Object.assign(document.createElement("mark"), { textContent: text.substr(issue.offset, issue.length) }),
      text.slice(issue.offset + issue.length, to) + (to < text.length ? "…" : "")
    );

    const msg = document.createElement("div");
    msg.className = "msg";
    msg.textContent = issue.message;

    const actions = document.createElement("div");
    actions.className = "actions";
    for (const r of issue.replacements) {
      actions.append(button(r === "" ? "(remove)" : r, "fix", () => applyFix(issue, r)));
    }
    actions.append(button("Locate", "", () => sandbox.locate(issue.nodeId)));
    actions.append(button("Ignore", "", () => dismiss(issue)));

    card.append(ctx, msg, actions);
    els.results.append(card);
  }
}

function button(label, cls, onClick) {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function dismiss(issue) {
  issues = issues.filter((i) => i !== issue);
  render();
}

async function applyFix(issue, value) {
  const old = nodeText.get(issue.nodeId);
  if (old.substr(issue.offset, issue.length) !== issue.original) {
    return setStatus("Text changed since the scan. Please re-check.", true);
  }
  const updated = old.slice(0, issue.offset) + value + old.slice(issue.offset + issue.length);
  const res = await sandbox.setText(issue.nodeId, old, updated);
  if (!res.ok) return setStatus(res.error, true);

  nodeText.set(issue.nodeId, updated);
  const delta = value.length - issue.length;
  const end = issue.offset + issue.length;
  issues = issues.filter((i) => {
    if (i === issue) return false;
    if (i.nodeId !== issue.nodeId) return true;
    if (i.offset >= end) { i.offset += delta; return true; }
    return i.offset + i.length <= issue.offset; // drop overlapping issues
  });
  render();
}

/* ---------- Init ---------- */

(async () => {
  await addOnUISdk.ready;
  sandbox = await addOnUISdk.instance.runtime.apiProxy("documentSandbox");
  await loadLanguages();
  els.check.disabled = false;
  els.check.addEventListener("click", runCheck);
})();
