// Le Journal. Cette page ne contient aucune donnée : tout est lu dans le dépôt privé
// avec le jeton de son propriétaire. Le contenu venant du web n'est jamais interprété comme
// du HTML : tout passe par des nœuds de texte créés par h().

const REPO = "Pierre-Gar/journal-france";
const API = "https://api.github.com";
const TOKEN_KEY = "journal-france-token";
const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";
const DEMO = ["localhost", "127.0.0.1"].includes(location.hostname);

const STATUS = {
  official: "Annonce officielle",
  confirmed: "Confirmé par plusieurs sources",
  reported: "Source unique",
  unconfirmed: "Non confirmé",
  preview: "Aperçu",
};
const KINDS = { official: "Source officielle", industry: "Industriel", specialist: "Presse spécialisée", press: "Presse", social: "Réseau social" };
const FREQUENCIES = [[1, "Chaque jour"], [2, "Tous les 2 jours"], [3, "Tous les 3 jours"], [7, "Chaque semaine"], [14, "Toutes les 2 semaines"], [30, "Chaque mois"]];
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MAIN_NAV = [["#/", "À la une"], ["#/evenements", "Événements"], ["#/archives", "Archives"], ["#/recherche", "Recherche"], ["#/reglages", "Réglages"]];

const root = document.getElementById("app");
const data = { index: null, events: null, settings: null, editions: new Map() };
let token = readToken();
let renderId = 0;

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function writeToken(value) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* le jeton reste en mémoire pour cette session */ }
}

function safeHref(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol) ? url : "#";
  } catch {
    return "#";
  }
}

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "value") node.value = value;
    else if (key === "checked" || key === "disabled") node[key] = Boolean(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function external(url, props, ...children) {
  return h("a", { ...props, href: safeHref(url), target: "_blank", rel: "noopener noreferrer" }, ...children);
}

const asDate = (value) => new Date(`${value}T12:00:00`);
const longDate = (value) => asDate(value).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = (value) => asDate(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const monthLabel = (value) => asDate(value).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const weekday = (value) => asDate(value).toLocaleDateString("fr-FR", { weekday: "long" });
const journalTitle = (value) => `Journal du ${shortDate(value).replace(/^1 /, "1er ")}`;
const plural = (count, word) => `${count} ${word}${count > 1 ? "s" : ""}`;
const normalize = (text) => (text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 5200);
}

class AuthError extends Error {}

function headers(extra) {
  return { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...extra };
}

async function readFile(path) {
  const url = DEMO ? `/${path}` : `${API}/repos/${REPO}/contents/${path}?ref=main`;
  const options = DEMO ? { cache: "no-store" } : { cache: "no-store", headers: headers({ Accept: "application/vnd.github.raw+json" }) };
  const response = await fetch(url, options);
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) throw new AuthError();
  if (!response.ok) throw new Error(`GitHub a répondu ${response.status}`);
  return response.json();
}

async function dispatch(workflow, inputs) {
  if (DEMO) return;
  const response = await fetch(`${API}/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: headers({ Accept: "application/vnd.github+json", "Content-Type": "application/json" }),
    body: JSON.stringify({ ref: "main", inputs }),
  });
  if (response.status === 401 || response.status === 403) throw new AuthError();
  if (response.status !== 204) throw new Error(`GitHub a répondu ${response.status}`);
}

async function loadBase(force) {
  if (force || !data.index) {
    const [index, events, settings] = await Promise.all([
      readFile("data/index.json"), readFile("data/events.json"), readFile("config/settings.json"),
    ]);
    data.index = index || { themes: [], editions: [] };
    data.events = events || {};
    data.settings = settings;
    if (force) data.editions.clear();
  }
}

async function loadEdition(day) {
  if (!data.editions.has(day)) data.editions.set(day, await readFile(`data/editions/${day}.json`));
  return data.editions.get(day);
}

const themeLabel = (id) => (data.index.themes.find((theme) => theme.id === id) || {}).label || id;
const latestDate = () => (data.index.editions[0] || {}).date;

function citations(text, sources) {
  return text.split(/(\[\d+\])/).filter(Boolean).map((part) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return part;
    const source = sources[Number(match[1]) - 1];
    return source ? h("sup", {}, external(source.url, { title: source.publisher }, `[${match[1]}]`)) : "";
  });
}

const stripCitations = (text) => (text || "").replace(/\s*\[\d+\]/g, "");
const articleHref = (day, story) => `#/article/${day}/${story.id}`;
const statusNode = (status) => h("span", { class: `status s-${status}` }, STATUS[status] || status);

function eventChip(story) {
  const event = data.events[story.event_id];
  if (!event || event.timeline.length < 2) return null;
  return h("a", { class: "chip", href: `#/evenement/${event.id}` }, `${event.timeline.length} étapes · ${story.stage || "Suivi"}`);
}

function periodChip(story) {
  return story.window_days > 1 ? h("span", { class: "chip" }, `Bilan sur ${story.window_days} jours`) : null;
}

function storyCard(day, story, { showDate, hideTheme } = {}) {
  return h("article", { class: `story t-${story.theme}` },
    h("div", { class: "meta" },
      !hideTheme && h("a", { class: "kicker", href: `#/rubrique/${story.theme}` }, themeLabel(story.theme)),
      statusNode(story.status),
      showDate && h("span", { class: "status s-reported" }, shortDate(day))),
    h("h3", {}, h("a", { href: articleHref(day, story) }, story.headline)),
    h("p", {}, stripCitations(story.short_article)),
    h("div", { class: "meta" }, eventChip(story), periodChip(story)));
}

const pdfButton = (action) => h("button", { class: "button secondary small", type: "button", onclick: action }, "Exporter en PDF");

function printImage(story) {
  if (!story.image || safeHref(story.image) === "#") return null;
  return h("img", { class: "np-img", src: story.image, alt: "", referrerpolicy: "no-referrer", onerror: (event) => event.target.remove() });
}

const sourceLine = (story) => h("div", { class: "np-sources" }, `Sources : ${story.sources.map((source) => source.publisher).join(", ")}`);
const paragraphs = (text) => text.split(/\n\s*\n/).map((paragraph) => h("p", {}, stripCitations(paragraph)));

function sheetHead(day, detail) {
  return h("header", { class: "np-head" },
    h("div", { class: "np-over" }, detail),
    h("h1", {}, journalTitle(day)),
    h("div", { class: "np-rule" }));
}

function editionSheet(edition) {
  const [lead, ...others] = [...edition.stories].sort((a, b) => b.importance - a.importance);
  const sections = data.index.themes
    .map((theme) => ({ ...theme, stories: others.filter((story) => story.theme === theme.id) }))
    .filter((section) => section.stories.length);
  return h("div", { class: "np" },
    sheetHead(edition.date, `${weekday(edition.date)} · ${plural(edition.stories.length, "article")}`),
    h("section", { class: "np-lead" },
      h("div", { class: "np-kicker" }, themeLabel(lead.theme)),
      h("h2", {}, lead.headline),
      printImage(lead),
      h("div", { class: "np-lead-text" }, paragraphs(lead.long_article), sourceLine(lead))),
    sections.map((section) => h("section", { class: "np-section" },
      h("h2", { class: "np-rubric" }, section.label),
      h("div", { class: "np-cols" }, section.stories.map((story, index) => h("article", { class: "np-item" },
        h("h3", {}, story.headline),
        index === 0 && printImage(story),
        h("p", {}, stripCitations(story.short_article)),
        sourceLine(story)))))));
}

function articleSheet(day, story) {
  return h("div", { class: "np" },
    sheetHead(day, themeLabel(story.theme)),
    h("section", { class: "np-lead" },
      h("h2", {}, story.headline),
      printImage(story),
      h("div", { class: "np-lead-text" }, story.long_article.split(/\n\s*\n/).map((paragraph) => h("p", {}, paragraph))),
      story.contradictions && h("p", { class: "np-note" }, `Contradiction entre sources : ${story.contradictions}`),
      h("ol", { class: "np-list" }, story.sources.map((source) => h("li", {}, `${source.publisher} : ${source.url}`)))));
}

async function printSheet(sheet, title) {
  const holder = document.getElementById("print-root");
  const previousTitle = document.title;
  holder.replaceChildren(sheet);
  document.body.classList.add("printing");
  const images = [...holder.querySelectorAll("img")];
  await Promise.race([
    Promise.allSettled(images.map((image) => image.decode())),
    new Promise((resolve) => { setTimeout(resolve, 6000); }),
  ]);
  document.title = title; // nom proposé pour le fichier PDF
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing");
    holder.replaceChildren();
    document.title = previousTitle;
  }, { once: true });
  window.print();
}

function shell(content, { nav, theme, date } = {}) {
  const today = date || latestDate();
  return h("div", {},
    h("div", { class: "shell" },
      h("header", { class: "masthead" },
        h("div", { class: "masthead-date" }, today ? weekday(today) : "Votre journal"),
        h("a", { class: "masthead-title", href: "#/" }, today ? journalTitle(today) : "Le Journal"),
        h("div", { class: "rule" }),
        h("nav", { class: "mainnav", "aria-label": "Navigation principale" },
          MAIN_NAV.map(([href, label]) => h("a", { href, "aria-current": nav === href ? "page" : null }, label))))),
    h("nav", { class: "themebar", "aria-label": "Rubriques" },
      h("div", { class: "shell" },
        h("div", { class: "themebar-inner" },
          data.index.themes.map(({ id, label }) => h("a", {
            href: `#/rubrique/${id}`, class: `t-${id}`, "aria-current": theme === id ? "page" : null,
          }, label))))),
    h("main", { class: "shell" }, content));
}

const notice = (text, className) => h("div", { class: `notice ${className || ""}` }, text);

function frontPage(edition) {
  const stories = [...edition.stories].sort((a, b) => b.importance - a.importance);
  if (!stories.length) return notice("Cette édition ne contient aucun article.");
  const [lead, ...others] = stories;
  const essentials = others.slice(0, 5);
  const sections = data.index.themes
    .map((theme) => ({ ...theme, stories: stories.filter((story) => story.theme === theme.id && story !== lead && !essentials.includes(story)) }))
    .filter((section) => section.stories.length);
  return [
    h("div", { class: "page-actions" }, pdfButton(() => printSheet(editionSheet(edition), journalTitle(edition.date)))),
    h("section", { class: "front" },
      h("article", { class: `lead t-${lead.theme}` },
        h("div", { class: "meta" }, h("a", { class: "kicker", href: `#/rubrique/${lead.theme}` }, themeLabel(lead.theme)), statusNode(lead.status)),
        h("h2", {}, h("a", { href: articleHref(edition.date, lead) }, lead.headline)),
        h("p", {}, stripCitations(lead.short_article)),
        h("div", { class: "meta" }, eventChip(lead), periodChip(lead))),
      h("aside", { class: "essentials" },
        h("div", { class: "essentials-title" }, "L'essentiel"),
        essentials.map((story, index) => h("div", { class: `brief t-${story.theme}` },
          h("span", { class: "brief-number" }, index + 2),
          h("div", {}, h("span", { class: "kicker" }, themeLabel(story.theme)), h("a", { href: articleHref(edition.date, story) }, story.headline)))))),
    sections.map((section) => h("section", { class: `t-${section.id}` },
      h("div", { class: "section-head" },
        h("h2", {}, h("a", { href: `#/rubrique/${section.id}` }, section.label)),
        h("a", { class: "more", href: `#/rubrique/${section.id}` }, "Voir la rubrique")),
      h("div", { class: "grid" }, section.stories.map((story) => storyCard(edition.date, story))))),
  ];
}

async function viewHome() {
  const day = latestDate();
  if (!day) return shell(notice("Aucune édition n'a encore été publiée."), { nav: "#/" });
  return shell(frontPage(await loadEdition(day)), { nav: "#/" });
}

async function viewEdition(day) {
  const edition = await loadEdition(day);
  if (!edition) return shell(notice("Cette édition est introuvable."), { nav: "#/archives" });
  return shell(frontPage(edition), { nav: "#/archives", date: day });
}

function viewTheme(id) {
  const items = data.index.editions.flatMap((edition) =>
    edition.stories.filter((story) => story.theme === id).map((story) => ({ day: edition.date, story })));
  return shell(h("div", { class: `t-${id}` },
    h("h1", { class: "page-title" }, themeLabel(id)),
    h("p", { class: "page-sub" }, plural(items.length, "article")),
    items.length
      ? h("div", { class: "grid" }, items.map(({ day, story }) => storyCard(day, story, { showDate: true, hideTheme: true })))
      : notice("Aucun article dans cette rubrique pour le moment.")), { theme: id });
}

function timeline(event, { day, compact } = {}) {
  const steps = compact ? event.timeline.slice(-4) : event.timeline;
  const last = event.timeline[event.timeline.length - 1];
  return h("ol", { class: `timeline t-${event.theme}` }, steps.map((step) => {
    const current = step === last;
    return h("li", { class: `step ${current ? "current" : ""}` },
      h("div", { class: "step-date" }, longDate(step.date)),
      h("h3", { class: "step-stage" }, step.stage, current && event.timeline.length > 1 && h("span", { class: "chip step-now" }, "Dernier état")),
      h("p", {}, step.summary),
      h("div", { class: "step-links" },
        !(day === step.date) && [h("a", { class: "read", href: `#/article/${step.date}/${step.story_id}` }, "Lire l'article"), " · "],
        step.sources.map((source, index) => [index > 0 && " · ", external(source.url, {}, source.publisher)])));
  }));
}

async function viewArticle(day, id) {
  const edition = await loadEdition(day);
  const story = edition && edition.stories.find((entry) => entry.id === id);
  if (!story) return shell(notice("Cet article est introuvable."));
  const event = data.events[story.event_id];
  return shell(h("article", { class: `article t-${story.theme}` },
    h("div", { class: "meta" },
      h("a", { class: "kicker", href: `#/rubrique/${story.theme}` }, themeLabel(story.theme)),
      statusNode(story.status),
      h("a", { class: "status s-reported", href: `#/edition/${day}` }, `Édition du ${shortDate(day)}`),
      periodChip(story)),
    h("h1", {}, story.headline),
    h("div", { class: "page-actions start" }, pdfButton(() => printSheet(articleSheet(day, story), story.headline))),
    h("div", { class: "article-body" }, story.long_article.split(/\n\s*\n/).map((paragraph) => h("p", {}, citations(paragraph, story.sources)))),
    story.contradictions && h("div", { class: "callout" }, h("strong", {}, "Contradiction entre sources. "), story.contradictions),
    h("div", { class: "block-title" }, "Sources"),
    h("ol", { class: "sources" }, story.sources.map((source, index) => h("li", {},
      h("span", { class: "source-number" }, index + 1),
      h("div", {},
        external(source.url, {}, source.publisher),
        h("small", {}, [source.title, KINDS[source.kind]].filter(Boolean).join(" · ")))))),
    event && event.timeline.length > 1 && [
      h("div", { class: "block-title" }, "Suivi de cet événement"),
      timeline(event, { day, compact: true }),
      h("p", {}, h("a", { class: "chip", href: `#/evenement/${event.id}` }, `Voir le fil complet : ${event.title}`)),
    ]));
}

function viewEvents() {
  const all = Object.values(data.events).sort((a, b) => b.updated.localeCompare(a.updated) || b.timeline.length - a.timeline.length);
  const list = h("div", {});
  const search = h("input", { class: "field-input", type: "search", placeholder: "Chercher un événement", "aria-label": "Chercher un événement" });
  let onlyFollowed = false;

  function draw() {
    const query = normalize(search.value);
    const shown = all.filter((event) => (!onlyFollowed || event.timeline.length > 1)
      && (!query || normalize(`${event.title} ${event.timeline.map((step) => step.summary).join(" ")}`).includes(query)));
    list.replaceChildren(...(shown.length ? shown.map((event) => {
      const last = event.timeline[event.timeline.length - 1];
      return h("a", { class: `event-row t-${event.theme}`, href: `#/evenement/${event.id}` },
        h("div", {},
          h("div", { class: "meta" }, h("span", { class: "kicker" }, themeLabel(event.theme)), h("span", { class: "status s-reported" }, `Mis à jour le ${shortDate(event.updated)}`)),
          h("h3", {}, event.title),
          h("p", {}, `${last.stage} : ${last.summary}`)),
        h("div", { class: "dots", "aria-label": plural(event.timeline.length, "étape") }, event.timeline.slice(-8).map(() => h("span", {}))));
    }) : [notice("Aucun événement ne correspond.")]));
  }

  const followed = h("button", { class: "filter", type: "button", "aria-pressed": "false", onclick: () => {
    onlyFollowed = !onlyFollowed;
    followed.setAttribute("aria-pressed", String(onlyFollowed));
    draw();
  } }, "Avec plusieurs étapes");
  search.addEventListener("input", draw);
  draw();
  return shell([
    h("h1", { class: "page-title" }, "Événements"),
    h("p", { class: "page-sub" }, `${plural(all.length, "événement")} suivi${all.length > 1 ? "s" : ""} dans le temps, de la première information au dernier état connu.`),
    h("div", { class: "toolbar" }, followed),
    search, list,
  ], { nav: "#/evenements" });
}

function viewEvent(id) {
  const event = data.events[id];
  if (!event) return shell(notice("Cet événement est introuvable."), { nav: "#/evenements" });
  return shell(h("div", { class: `article t-${event.theme}` },
    h("a", { class: "kicker", href: `#/rubrique/${event.theme}` }, themeLabel(event.theme)),
    h("h1", {}, event.title),
    h("p", { class: "page-sub" }, `Suivi depuis le ${shortDate(event.created)} · ${plural(event.timeline.length, "étape")}`),
    timeline(event)), { nav: "#/evenements" });
}

function viewArchives() {
  const months = new Map();
  for (const edition of data.index.editions) {
    const key = monthLabel(edition.date);
    months.set(key, [...(months.get(key) || []), edition]);
  }
  const content = [...months].map(([month, editions]) => [
    h("h2", { class: "archive-month" }, month),
    editions.map((edition) => {
      const top = [...edition.stories].sort((a, b) => b.importance - a.importance)[0];
      return h("a", { class: "archive-row", href: `#/edition/${edition.date}` },
        h("span", { class: "archive-date" }, longDate(edition.date)),
        h("span", { class: "archive-top" }, top ? top.headline : "Édition vide"),
        h("span", { class: "archive-count" }, plural(edition.stories.length, "article")));
    }),
  ]);
  return shell([
    h("h1", { class: "page-title" }, "Archives"),
    h("p", { class: "page-sub" }, plural(data.index.editions.length, "édition")),
    content.length ? content : notice("Aucune édition n'a encore été publiée."),
  ], { nav: "#/archives" });
}

function viewSearch() {
  const all = data.index.editions.flatMap((edition) => edition.stories.map((story) => ({ day: edition.date, story })));
  const results = h("div", { class: "list" });
  const input = h("input", { class: "field-input", type: "search", placeholder: "Mots-clés : Rafale, Mistral, budget…", "aria-label": "Recherche" });
  input.addEventListener("input", () => {
    const words = normalize(input.value).split(/\s+/).filter(Boolean);
    if (!words.length) return results.replaceChildren();
    const found = all.filter(({ story }) => {
      const text = normalize(`${story.headline} ${story.short_article}`);
      return words.every((word) => text.includes(word));
    });
    results.replaceChildren(...(found.length
      ? found.slice(0, 60).map(({ day, story }) => storyCard(day, story, { showDate: true }))
      : [notice("Aucun article ne correspond.")]));
  });
  setTimeout(() => input.focus());
  return shell([h("h1", { class: "page-title" }, "Recherche"), h("p", { class: "page-sub" }, `Dans ${plural(all.length, "article")} archivé${all.length > 1 ? "s" : ""}.`), input, h("div", { class: "toolbar" }), results], { nav: "#/recherche" });
}

function numberInput(value, min, max, label) {
  return h("input", { class: "number", type: "number", min, max, value, "aria-label": label });
}

function hourSelect(value, label) {
  return h("select", { class: "select", "aria-label": label },
    Array.from({ length: 24 }, (_, hour) => h("option", { value: hour, selected: hour === value ? "selected" : null }, `${String(hour).padStart(2, "0")} h`)));
}

function everySelect(value, label) {
  const options = FREQUENCIES.some(([days]) => days === value) ? FREQUENCIES : [...FREQUENCIES, [value, `Tous les ${value} jours`]];
  return h("select", { class: "select", "aria-label": label },
    options.map(([days, text]) => h("option", { value: days, selected: days === value ? "selected" : null }, text)));
}

function viewSettings() {
  const settings = data.settings;
  if (!settings) return shell(notice("Réglages indisponibles."), { nav: "#/reglages" });
  const themeInputs = data.index.themes.map(({ id, label }) => ({
    id, label,
    stories: numberInput(settings.themes[id].stories, 0, 15, `Articles par édition : ${label}`),
    inMail: h("input", { type: "checkbox", checked: settings.themes[id].in_mail }),
    every: everySelect(settings.themes[id].every_days, `Fréquence : ${label}`),
  }));
  const editionHour = hourSelect(settings.edition_hour, "Heure de l'édition");
  const mail = settings.mail;
  const enabled = h("input", { type: "checkbox", checked: mail.enabled });
  const frequency = h("select", { class: "select", "aria-label": "Fréquence" },
    [["daily", "Chaque jour"], ["every_n_days", "Tous les N jours"], ["weekly", "Certains jours de la semaine"]]
      .map(([value, label]) => h("option", { value, selected: value === mail.frequency ? "selected" : null }, label)));
  const everyN = numberInput(mail.every_n_days, 1, 30, "Nombre de jours");
  const mailHour = hourSelect(mail.hour, "Heure du mail");
  const dayBoxes = WEEKDAYS.map((label, day) => {
    const box = h("button", { class: "filter", type: "button", "aria-pressed": String(mail.weekdays.includes(day)), onclick: () => {
      box.setAttribute("aria-pressed", String(box.getAttribute("aria-pressed") !== "true"));
    } }, label);
    return box;
  });
  const nRow = h("div", { class: "row" }, h("span", { class: "row-label" }, "Intervalle (jours)"), everyN);
  const daysRow = h("div", { class: "row" }, h("span", { class: "row-label" }, "Jours d'envoi"), h("div", { class: "days" }, dayBoxes));
  const syncFrequency = () => {
    nRow.hidden = frequency.value !== "every_n_days";
    daysRow.hidden = frequency.value !== "weekly";
  };
  frequency.addEventListener("change", syncFrequency);
  syncFrequency();
  const total = h("strong", {});
  const syncTotal = () => { total.textContent = themeInputs.reduce((sum, theme) => sum + (Number(theme.stories.value) || 0), 0); };
  themeInputs.forEach((theme) => theme.stories.addEventListener("input", syncTotal));
  syncTotal();

  const save = h("button", { class: "button", type: "button", onclick: async () => {
    const weekdays = dayBoxes.flatMap((box, day) => (box.getAttribute("aria-pressed") === "true" ? [day] : []));
    if (!weekdays.length) return toast("Choisissez au moins un jour d'envoi.");
    const payload = {
      edition_hour: Number(editionHour.value),
      themes: Object.fromEntries(themeInputs.map((theme) => [theme.id, { stories: Number(theme.stories.value), in_mail: theme.inMail.checked, every_days: Number(theme.every.value) }])),
      mail: { enabled: enabled.checked, frequency: frequency.value, every_n_days: Number(everyN.value), weekdays, hour: Number(mailHour.value) },
    };
    await runAction(save, () => dispatch("settings.yml", { settings: JSON.stringify(payload) }), "Réglages envoyés : ils s'appliquent en une minute environ.");
  } }, "Enregistrer les réglages");

  const generate = h("button", { class: "button secondary", type: "button", onclick: () =>
    runAction(generate, () => dispatch("edition.yml", { action: "generate" }), "Toutes les rubriques sont relancées : comptez environ dix minutes.") }, "Tout générer maintenant");
  const sendMail = h("button", { class: "button secondary", type: "button", onclick: () =>
    runAction(sendMail, () => dispatch("edition.yml", { action: "mail" }), "Envoi du mail lancé.") }, "M'envoyer le mail maintenant");

  return shell([
    h("h1", { class: "page-title article" }, "Réglages"),
    h("section", { class: "panel" },
      h("h2", {}, "Édition quotidienne"),
      h("p", { class: "panel-sub" }, "Une rubrique réglée sur « Chaque semaine » est rédigée une fois tous les 7 jours et couvre les 7 jours écoulés. La collecte reste quotidienne et ne consomme pas votre abonnement Claude ; seule la rédaction le fait."),
      h("div", { class: "row" }, h("span", { class: "row-label" }, "Heure de préparation"), editionHour),
      h("div", { class: "row" }, h("span", { class: "row-label" }, "Rubrique"), h("span", { class: "panel-sub" }, "Articles, fréquence, envoi par mail")),
      themeInputs.map((theme) => h("div", { class: "row" },
        h("span", { class: "row-label" }, theme.label),
        h("div", { class: "controls" }, theme.stories, theme.every, h("label", { class: "check" }, theme.inMail, "Dans le mail")))),
      h("div", { class: "row" }, h("span", { class: "row-label" }, "Articles si toutes les rubriques paraissent"), total)),
    h("section", { class: "panel" },
      h("h2", {}, "Envoi par mail"),
      h("p", { class: "panel-sub" }, "Le mail regroupe toutes les nouvelles parues depuis le précédent envoi, dans les rubriques cochées."),
      h("div", { class: "row" }, h("span", { class: "row-label" }, "Recevoir le mail"), h("label", { class: "check" }, enabled, "Activé")),
      h("div", { class: "row" }, h("span", { class: "row-label" }, "Fréquence"), frequency),
      nRow, daysRow,
      h("div", { class: "row" }, h("span", { class: "row-label" }, "Heure d'envoi"), mailHour),
      h("div", { class: "actions" }, save)),
    h("section", { class: "panel" },
      h("h2", {}, "Actions"),
      h("p", { class: "panel-sub" }, "L'application peut déclencher ces actions, mais ne peut ni modifier le code ni lire les secrets."),
      h("div", { class: "actions" }, generate, sendMail,
        h("button", { class: "button quiet", type: "button", onclick: () => { writeToken(""); location.hash = "#/"; render(); } }, "Se déconnecter"))),
  ], { nav: "#/reglages" });
}

async function runAction(button, action, success) {
  button.disabled = true;
  try {
    await action();
    toast(DEMO ? "Mode démonstration : aucune action envoyée." : success);
  } catch (error) {
    toast(error instanceof AuthError ? "Le jeton n'a pas le droit de lancer cette action." : `Échec : ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

function viewLogin(message) {
  const input = h("input", { class: "field-input", type: "password", autocomplete: "off", placeholder: "github_pat_…", "aria-label": "Jeton GitHub", required: true });
  const submit = h("button", { class: "button", type: "submit" }, "Ouvrir mon journal");
  return h("div", { class: "login" },
    h("div", { class: "login-card" },
      h("div", { class: "masthead-date" }, "Accès privé"),
      h("h1", {}, "Le Journal"),
      h("div", { class: "rule" }),
      h("p", {}, ""),
      h("p", {}, "Saisissez votre jeton GitHub. Il reste dans ce navigateur et sert uniquement à lire votre dépôt privé et à lancer vos actions."),
      message && h("p", { class: "error" }, message),
      h("form", { onsubmit: (event) => {
        event.preventDefault();
        writeToken(input.value.trim());
        render();
      } }, input, submit),
      h("p", {}, ""),
      external(TOKEN_URL, { class: "login-link" }, "Créer un jeton sur GitHub")));
}

async function route() {
  const [name, first, second] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  switch (name || "") {
    case "": return [await viewHome(), "À la une"];
    case "edition": return [await viewEdition(first), `Édition du ${first}`];
    case "article": return [await viewArticle(first, second), "Article"];
    case "rubrique": return [viewTheme(first), themeLabel(first)];
    case "evenements": return [viewEvents(), "Événements"];
    case "evenement": return [viewEvent(first), "Événement"];
    case "archives": return [viewArchives(), "Archives"];
    case "recherche": return [viewSearch(), "Recherche"];
    case "reglages": return [viewSettings(), "Réglages"];
    default: return [shell(notice("Cette page n'existe pas.")), "Introuvable"];
  }
}

async function render() {
  const current = ++renderId;
  if (!token && !DEMO) {
    root.replaceChildren(viewLogin());
    return;
  }
  try {
    await loadBase();
    const [view, title] = await route();
    if (current !== renderId) return;
    root.replaceChildren(view);
    document.title = `${title} · Le Journal`;
    window.scrollTo(0, 0);
  } catch (error) {
    if (current !== renderId) return;
    if (error instanceof AuthError) {
      writeToken("");
      data.index = null;
      root.replaceChildren(viewLogin("Ce jeton n'est pas accepté, ou n'a pas accès au dépôt."));
    } else {
      root.replaceChildren(notice(`Impossible de charger le journal : ${error.message}`, "error"));
    }
  }
}

window.addEventListener("hashchange", render);
render();
