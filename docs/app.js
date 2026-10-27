"use strict";

/* Rule extraction literature database: client-side browsing of docs/data/database.json. */

const DIMS = ["approach", "translucency", "design", "application", "scope"];
const state = { view: "methods", q: "", from: null, to: null, sort: "taxonomy", facets: {}, open: null };
DIMS.forEach((d) => (state.facets[d] = new Set()));

let DB, methodById, paperByKey, labelOf, orderOf, YEARS;

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false && c !== "") node.append(c);
  return node;
}

function svg(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

function normalize(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

let toastTimer;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const area = el("textarea", { style: "position:fixed;opacity:0" }, text);
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(message);
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvRow(values) {
  return values.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",");
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function shortAuthors(list) {
  return list.length > 3 ? `${list.slice(0, 3).join(", ")} et al.` : list.join(", ");
}

/* ---------- data ---------- */
async function load() {
  const response = await fetch("data/database.json");
  if (!response.ok) throw new Error(response.statusText);
  DB = await response.json();
  methodById = Object.fromEntries(DB.methods.map((m) => [m.id, m]));
  paperByKey = Object.fromEntries(DB.papers.map((p) => [p.key, p]));
  labelOf = {};
  orderOf = {};
  for (const d of DIMS) {
    labelOf[d] = {};
    orderOf[d] = {};
    DB.vocabulary[d].values.forEach((v, i) => {
      labelOf[d][v.value] = v.label;
      orderOf[d][v.value] = i;
    });
  }
  for (const p of DB.papers) {
    p.search = normalize([p.title, p.authors.join(" "), p.venue, p.abstract, p.citation,
      p.methods.map((id) => methodById[id].name).join(" ")].join(" "));
  }
  for (const m of DB.methods) {
    const papers = m.papers.map((k) => paperByKey[k]);
    m.search = normalize([m.name, m.technique, papers.map((p) => p.search).join(" ")].join(" "));
  }
  const ys = DB.papers.map((p) => p.year);
  YEARS = [];
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) YEARS.push(y);
  $("n-papers").textContent = DB.papers.length;
  $("n-methods").textContent = DB.methods.length;
}

/* ---------- filtering ---------- */
function terms() {
  return normalize(state.q).split(/\s+/).filter(Boolean);
}

function passesFacets(m, except) {
  return DIMS.every((d) => d === except || state.facets[d].size === 0 || state.facets[d].has(m[d]));
}

function inYears(y) {
  return (state.from == null || y >= state.from) && (state.to == null || y <= state.to);
}

/** Items of the current view matching all filters, optionally ignoring one facet or the year range. */
function selection({ exceptFacet = null, ignoreYears = false } = {}) {
  const t = terms();
  const textOk = (item) => t.every((w) => item.search.includes(w));
  if (state.view === "methods") {
    return DB.methods.filter((m) => passesFacets(m, exceptFacet) && textOk(m) && (ignoreYears || inYears(m.year)));
  }
  return DB.papers.filter((p) => p.methods.some((id) => passesFacets(methodById[id], exceptFacet)) &&
    textOk(p) && (ignoreYears || inYears(p.year)));
}

function facetCounts(dim) {
  const counts = {};
  for (const item of selection({ exceptFacet: dim })) {
    const values = state.view === "methods" ? [item[dim]]
      : [...new Set(item.methods.map((id) => methodById[id]).filter((m) => passesFacets(m, dim)).map((m) => m[dim]))];
    values.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
  }
  return counts;
}

function sorted(items) {
  const name = (x) => normalize(state.view === "methods" ? x.label : x.title);
  const byYear = (a, b) => a.year - b.year || name(a).localeCompare(name(b));
  const copy = [...items];
  if (state.sort === "year") return copy.sort(byYear);
  if (state.sort === "year-desc") return copy.sort((a, b) => -byYear(a, b));
  if (state.sort === "name") return copy.sort((a, b) => name(a).localeCompare(name(b)));
  return copy; // "taxonomy": the order of the review's tables (methods) or by year (papers)
}

/* ---------- URL state ---------- */
function writeHash() {
  const params = new URLSearchParams();
  if (state.view !== "methods") params.set("view", state.view);
  if (state.q) params.set("q", state.q);
  if (state.from != null) params.set("from", state.from);
  if (state.to != null) params.set("to", state.to);
  if (state.sort !== "taxonomy") params.set("sort", state.sort);
  DIMS.forEach((d) => state.facets[d].size && params.set(d, [...state.facets[d]].join(",")));
  if (state.open) params.set("open", state.open);
  const hash = params.toString();
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  state.view = params.get("view") === "papers" ? "papers" : "methods";
  state.q = params.get("q") || "";
  const year = (k) => (params.has(k) && YEARS.includes(+params.get(k)) ? +params.get(k) : null);
  state.from = year("from");
  state.to = year("to");
  state.sort = ["taxonomy", "year", "year-desc", "name"].includes(params.get("sort")) ? params.get("sort") : "taxonomy";
  DIMS.forEach((d) => {
    const valid = (params.get(d) || "").split(",").filter((v) => v in labelOf[d]);
    state.facets[d] = new Set(valid);
  });
  const open = params.get("open");
  state.open = open in paperByKey || open in methodById ? open : null;
}

/** Open the dialog named in the URL (#open=<paper key or method id>). */
function openFromState() {
  if (state.open in paperByKey) openPaper(paperByKey[state.open]);
  else if (state.open in methodById) openMethod(methodById[state.open]);
}

/* ---------- rendering: filters ---------- */
function buildControls() {
  const facets = $("facets");
  for (const d of DIMS) {
    const group = el("fieldset", { class: "facet" }, el("legend", { class: "field-label" }, DB.vocabulary[d].label));
    for (const v of DB.vocabulary[d].values) {
      const input = el("input", { type: "checkbox", value: v.value, "data-dim": d,
        onchange: (e) => { e.target.checked ? state.facets[d].add(v.value) : state.facets[d].delete(v.value); update(); } });
      group.append(el("label", { class: "facet-option", title: v.description },
        input, el("span", {}, v.label), el("span", { class: "n", "data-count": `${d}:${v.value}` }, "")));
    }
    facets.append(group);
  }
  for (const id of ["year-from", "year-to"]) {
    const select = $(id);
    select.append(el("option", { value: "" }, "Any"));
    YEARS.forEach((y) => select.append(el("option", { value: y }, String(y))));
  }
}

function syncControls() {
  $("search").value = state.q;
  $("year-from").value = state.from ?? "";
  $("year-to").value = state.to ?? "";
  $("sort").value = state.sort;
  document.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  document.querySelectorAll("#facets input").forEach((i) => (i.checked = state.facets[i.dataset.dim].has(i.value)));
}

function renderFacetCounts() {
  for (const d of DIMS) {
    const counts = facetCounts(d);
    for (const v of DB.vocabulary[d].values) {
      const n = counts[v.value] || 0;
      const span = document.querySelector(`[data-count="${d}:${v.value}"]`);
      span.textContent = n;
      span.closest(".facet-option").classList.toggle("zero", n === 0 && !state.facets[d].has(v.value));
    }
  }
}

function describeFilters() {
  const parts = [];
  if (state.q) parts.push(`matching “${state.q}”`);
  DIMS.forEach((d) => state.facets[d].size && parts.push([...state.facets[d]].map((v) => labelOf[d][v]).join(" or ")));
  if (state.from != null || state.to != null) parts.push(`${state.from ?? YEARS[0]}–${state.to ?? YEARS[YEARS.length - 1]}`);
  return parts.length ? `Filtered by: ${parts.join(" · ")}` : "";
}

/* ---------- rendering: timeline ---------- */
function renderTimeline() {
  const items = selection({ ignoreYears: true });
  const counts = new Map();
  items.forEach((it) => counts.set(it.year, (counts.get(it.year) || 0) + 1));
  const noun = state.view === "methods" ? "method" : "paper";
  $("timeline-title").textContent = state.view === "methods"
    ? "Methods per year (year of the first paper describing the method)" : "Papers per year";

  const chart = $("chart");
  const W = Math.max(300, chart.clientWidth || 640);
  const H = 170, m = { t: 10, r: 4, b: 22, l: 26 };
  const band = (W - m.l - m.r) / YEARS.length;
  const barW = Math.min(24, Math.max(3, band * 0.7));
  const max = Math.max(1, ...counts.values());
  const step = max <= 5 ? 1 : max <= 10 ? 2 : 5;
  const top = Math.ceil(max / step) * step;
  const y = (v) => m.t + (H - m.t - m.b) * (1 - v / top);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Bar chart of ${noun}s per year` });
  for (let v = 0; v <= top; v += step) {
    root.append(svg("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    const t = svg("text", { class: "axis-label", x: m.l - 6, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = v;
    root.append(t);
  }
  const showEvery = band < 16 ? 5 : band < 34 ? 2 : 1; // a 4-digit label needs ~30px
  YEARS.forEach((yr, i) => {
    const x0 = m.l + i * band, cx = x0 + band / 2, n = counts.get(yr) || 0;
    if (yr % showEvery === 0) {
      const t = svg("text", { class: "axis-label", x: cx, y: H - 6, "text-anchor": "middle" });
      t.textContent = yr;
      root.append(t);
    }
    if (!n) return;
    const hover = svg("rect", { class: "hover-band", x: x0, y: m.t, width: band, height: H - m.t - m.b, rx: 4 });
    const h = Math.max(1, y(0) - y(n)), r = Math.min(4, h, barW / 2), bx = cx - barW / 2, by = y(n);
    const bar = svg("path", {
      class: `bar${inYears(yr) ? "" : " dim"}`,
      d: `M${bx},${y(0)}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + barW - r}Q${bx + barW},${by} ${bx + barW},${by + r}V${y(0)}Z`,
    });
    const hit = svg("rect", { class: "hit", x: x0, y: m.t, width: band, height: H - m.t - m.b, tabindex: 0,
      role: "button", "aria-label": `${yr}: ${plural(n, noun)}. Activate to filter to this year.` });
    const tip = () => showTooltip(cx / W, by / H, `${yr} · <strong>${n}</strong> ${noun}${n === 1 ? "" : "s"}`);
    hit.addEventListener("mouseenter", tip);
    hit.addEventListener("focus", () => { tip(); hover.classList.add("on"); });
    hit.addEventListener("blur", () => { hideTooltip(); hover.classList.remove("on"); });
    hit.addEventListener("mouseleave", hideTooltip);
    const pick = () => { const only = state.from === yr && state.to === yr; state.from = only ? null : yr; state.to = only ? null : yr; update(); };
    hit.addEventListener("click", pick);
    hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    root.append(hit, hover, bar);
  });
  chart.replaceChildren(root);
}

function showTooltip(fx, fy, html) {
  const tip = $("tooltip"), chart = $("chart"), fig = $("timeline");
  tip.innerHTML = html;
  tip.hidden = false;
  tip.style.left = `${chart.offsetLeft + fx * chart.clientWidth}px`;
  tip.style.top = `${chart.offsetTop + fy * chart.clientHeight}px`;
  // keep inside the figure horizontally
  const half = tip.offsetWidth / 2, left = parseFloat(tip.style.left);
  tip.style.left = `${Math.min(Math.max(left, half + 4), fig.clientWidth - half - 4)}px`;
}
function hideTooltip() { $("tooltip").hidden = true; }

/* ---------- rendering: list ---------- */
function chips(m) {
  return el("ul", { class: "chips", "aria-label": "Classification" },
    DIMS.filter((d) => d !== "approach").map((d) => el("li", { class: "chip", title: DB.vocabulary[d].label }, labelOf[d][m[d]])));
}

function methodCard(m) {
  return el("li", { class: "card" },
    el("div", { class: "card-head" },
      el("button", { type: "button", class: "card-title", onclick: () => openMethod(m) }, m.label),
      el("span", { class: "card-year" }, String(m.year))),
    el("p", { class: "card-meta" }, `${labelOf.approach[m.approach]} · ${m.technique}`),
    chips(m),
    el("div", { class: "refs" }, m.papers.length > 1 ? "Papers:" : "Paper:",
      m.papers.map((k) => el("button", { type: "button", class: "chip-button", onclick: () => openPaper(paperByKey[k]) }, paperByKey[k].citation))));
}

function paperCard(p) {
  return el("li", { class: "card" },
    el("div", { class: "card-head" },
      el("button", { type: "button", class: "card-title", onclick: () => openPaper(p) }, p.title),
      el("span", { class: "card-year" }, String(p.year))),
    el("p", { class: "card-meta" }, [shortAuthors(p.authors), p.venue].filter(Boolean).join(" · ")),
    el("div", { class: "refs" }, p.methods.length > 1 ? "Methods:" : "Method:",
      p.methods.map((id) => el("button", { type: "button", class: "chip-button", onclick: () => openMethod(methodById[id]) },
        `${methodById[id].label} (${labelOf.approach[methodById[id].approach]})`))));
}

function renderList(items) {
  $("list").replaceChildren(...sorted(items).map((it) => (state.view === "methods" ? methodCard(it) : paperCard(it))));
  $("empty").hidden = items.length > 0;
  const total = state.view === "methods" ? DB.methods.length : DB.papers.length;
  $("count").textContent = `Showing ${items.length} of ${plural(total, state.view === "methods" ? "method" : "paper")}`;
  $("active-filters").textContent = describeFilters();
}

/* ---------- dialogs ---------- */
function openDialog(id, title, ...body) {
  state.open = id;
  writeHash();
  $("detail-title").textContent = title;
  $("detail-body").replaceChildren(...body.flat(Infinity).filter((c) => c != null && c !== false && c !== ""));
  const d = $("detail");
  if (!d.open) d.showModal();
  $("detail-body").scrollTop = 0;
}

function paperLink(p) {
  return p.link
    ? el("a", { href: p.link, target: "_blank", rel: "noopener" }, p.link.includes("doi.org") ? "DOI" : "Publisher page")
    : el("a", { href: `https://scholar.google.com/scholar?q=${encodeURIComponent(p.title)}`, target: "_blank", rel: "noopener" }, "Search on Google Scholar");
}

function bibtexBlock(p) {
  return [
    el("div", { class: "bib-actions" },
      el("button", { type: "button", class: "button", onclick: () => copyText(p.bibtex, "BibTeX copied") }, "Copy BibTeX")),
    el("pre", { class: "bibtex" }, p.bibtex),
  ];
}

function openPaper(p) {
  openDialog(p.key, p.title,
    el("dl", { class: "kv" },
      el("dt", {}, "Authors"), el("dd", {}, p.authors.join(", ")),
      el("dt", {}, "Year"), el("dd", {}, String(p.year)),
      p.venue && [el("dt", {}, "Published in"), el("dd", {}, p.venue)],
      el("dt", {}, "Link"), el("dd", {}, paperLink(p))),
    el("h3", {}, p.methods.length > 1 ? "Methods described" : "Method described"),
    el("ul", { class: "paper-list" }, p.methods.map((id) => {
      const m = methodById[id];
      return el("li", {},
        el("button", { type: "button", class: "link-button", onclick: () => openMethod(m) }, m.label),
        el("p", { class: "card-meta" }, `${labelOf.approach[m.approach]} · ${m.technique}`), chips(m));
    })),
    p.abstract && [el("h3", {}, "Abstract"), el("p", { class: "abstract" }, p.abstract)],
    el("h3", {}, "BibTeX"), bibtexBlock(p));
}

function openMethod(m) {
  openDialog(m.id, m.name || `Method from ${m.label}`,
    el("dl", { class: "kv" },
      DIMS.map((d) => [el("dt", {}, DB.vocabulary[d].label),
        el("dd", {}, labelOf[d][m[d]], " ",
          el("span", { class: "info", title: DB.vocabulary[d].values[orderOf[d][m[d]]].description, "aria-label": DB.vocabulary[d].values[orderOf[d][m[d]]].description }, "?"))]),
      el("dt", {}, "Technique"), el("dd", {}, m.technique)),
    el("h3", {}, m.papers.length > 1 ? `Papers (${m.papers.length})` : "Paper"),
    el("ul", { class: "paper-list" }, m.papers.map((k) => {
      const p = paperByKey[k];
      return el("li", {},
        el("button", { type: "button", class: "link-button", onclick: () => openPaper(p) }, p.title),
        el("p", { class: "card-meta" }, `${shortAuthors(p.authors)} · ${p.year}${p.venue ? " · " + p.venue : ""}`),
        el("div", { class: "bib-actions" },
          el("button", { type: "button", class: "button", onclick: () => copyText(p.bibtex, "BibTeX copied") }, "Copy BibTeX"),
          paperLink(p)));
    })));
}

/* ---------- export ---------- */
function selectedPapers() {
  const items = selection();
  if (state.view === "papers") return items;
  const keys = new Set(items.flatMap((m) => m.papers));
  return DB.papers.filter((p) => keys.has(p.key));
}

function exportBib() {
  const papers = selectedPapers();
  download("rule-extraction-selection.bib", papers.map((p) => p.bibtex).join("\n\n") + "\n", "application/x-bibtex");
  toast(`Exported ${plural(papers.length, "paper")}`);
}

function exportCsv() {
  const items = sorted(selection());
  let rows;
  if (state.view === "methods") {
    rows = [["id", "name", "year", ...DIMS, "technique", "papers"],
      ...items.map((m) => [m.id, m.name, m.year, ...DIMS.map((d) => labelOf[d][m[d]]), m.technique,
        m.papers.map((k) => paperByKey[k].citation).join("; ")])];
  } else {
    rows = [["key", "citation", "title", "authors", "year", "venue", "link", "methods"],
      ...items.map((p) => [p.key, p.citation, p.title, p.authors.join("; "), p.year, p.venue, p.link,
        p.methods.map((id) => methodById[id].label).join("; ")])];
  }
  download(`rule-extraction-${state.view}.csv`, rows.map(csvRow).join("\n") + "\n", "text/csv");
  toast(`Exported ${plural(items.length, state.view === "methods" ? "method" : "paper")}`);
}

/* ---------- wiring ---------- */
function update() {
  if (state.from != null && state.to != null && state.from > state.to) [state.from, state.to] = [state.to, state.from];
  syncControls();
  renderFacetCounts();
  renderTimeline();
  renderList(selection());
  writeHash();
}

function clearAll() {
  state.q = "";
  state.from = state.to = null;
  DIMS.forEach((d) => state.facets[d].clear());
  update();
}

function citeDialog() {
  const bib = `@article{elmekkaoui2023rule,
  title   = {Rule-Extraction Methods From Feedforward Neural Networks: A Systematic Literature Review},
  author  = {El Mekkaoui, Sara and Benabbou, Loubna and Berrado, Abdelaziz},
  journal = {arXiv preprint arXiv:2312.12878},
  year    = {2023}
}`;
  openDialog(null, "Cite this database",
    el("p", {}, "If you use this database, please cite the review it comes from:"),
    el("p", { class: "abstract" }, "S. El Mekkaoui, L. Benabbou, A. Berrado. Rule-Extraction Methods From Feedforward Neural Networks: A Systematic Literature Review. arXiv:2312.12878, 2023."),
    el("div", { class: "bib-actions" }, el("button", { type: "button", class: "button", onclick: () => copyText(bib, "BibTeX copied") }, "Copy BibTeX")),
    el("pre", { class: "bibtex" }, bib));
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (e) { /* storage unavailable: choice lasts for this visit */ }
}

function wire() {
  let searchTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 150);
  });
  $("year-from").addEventListener("change", (e) => { state.from = e.target.value ? +e.target.value : null; update(); });
  $("year-to").addEventListener("change", (e) => { state.to = e.target.value ? +e.target.value : null; update(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; update(); });
  document.querySelectorAll(".segmented button").forEach((b) => b.addEventListener("click", () => { state.view = b.dataset.view; update(); }));
  $("clear-filters").addEventListener("click", clearAll);
  $("clear-filters-2").addEventListener("click", clearAll);
  $("export-bib").addEventListener("click", exportBib);
  $("export-csv").addEventListener("click", exportCsv);
  $("copy-link").addEventListener("click", () => copyText(location.href, "Link to this view copied"));
  $("cite-button").addEventListener("click", citeDialog);
  $("theme-button").addEventListener("click", toggleTheme);
  $("detail-close").addEventListener("click", () => $("detail").close());
  $("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); });
  $("detail").addEventListener("close", () => { state.open = null; writeHash(); });
  $("toggle-filters").addEventListener("click", (e) => {
    const open = $("filters").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });
  window.addEventListener("hashchange", () => {
    readHash();
    update();
    if (state.open) openFromState();
    else if ($("detail").open) $("detail").close();
  });
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderTimeline, 120); });
}

(async function init() {
  try {
    await load();
  } catch (e) {
    $("list").replaceChildren(el("li", { class: "empty" }, "Could not load the database. Please reload the page."));
    return;
  }
  buildControls();
  readHash();
  wire();
  update();
  openFromState();
})();
