(() => {
  "use strict";

  const DATA_URL = "data/releases.json";
  const locale = "de-DE";
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const publisherColors = {
    altraverse: "#335c67",
    tokyopop: "#e6483d",
    carlsen: "#76528b",
  };

  let releases = [];
  let publisherNames = new Map();

  document.addEventListener("DOMContentLoaded", initialize);

  async function initialize() {
    const year = document.querySelector("[data-current-year]");
    if (year) year.textContent = String(new Date().getFullYear());

    const page = document.body.dataset.page;
    if (!page || ["about", "contact", "imprint", "privacy"].includes(page)) return;

    try {
      releases = await loadReleases();
      if (page === "home") renderHome();
      if (page === "releases") setupReleaseBrowser();
      if (page === "preview") renderPreview();
      if (page === "publishers") renderPublishers();
      if (page === "detail") renderDetail();
    } catch (error) {
      console.error(error);
      renderLoadError();
    }
  }

  async function loadReleases() {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Daten konnten nicht geladen werden (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Das Datenformat ist ungültig.");
    publisherNames = new Map();
    data.forEach((release) => {
      if (
        release.publisher_id &&
        release.publisher_name &&
        !publisherNames.has(release.publisher_id)
      ) {
        publisherNames.set(release.publisher_id, release.publisher_name);
      }
    });
    return data;
  }

  function renderHome() {
    const currentKey = monthKey(new Date());
    const dated = releases.filter((release) => release.release_date);
    const availableMonths = unique(dated.map((release) => release.release_date.slice(0, 7)));
    const displayMonth = availableMonths.includes(currentKey)
      ? currentKey
      : availableMonths.filter((key) => key <= currentKey).at(-1) || availableMonths[0];

    const current = dated
      .filter((release) => release.release_date.startsWith(displayMonth))
      .sort(compareDateAscending)
      .slice(0, 6);
    const upcoming = dated
      .filter((release) => release.release_date > isoToday())
      .sort(compareDateAscending)
      .slice(0, 6);
    const currentMonthStart = `${currentKey}-01`;
    const firstVolumes = dated
      .filter(
        (release) => isFirstVolume(release) && release.release_date >= currentMonthStart
      )
      .sort(compareDateAscending)
      .slice(0, 6);

    setText("[data-current-month-label]", formatMonth(displayMonth));
    renderCards("#current-releases", current, "Für diesen Monat sind keine Einträge vorhanden.");
    renderCards(
      "#upcoming-releases",
      upcoming,
      "Aktuell sind keine späteren Veröffentlichungen mit festem Termin erfasst."
    );
    renderCards(
      "#first-volumes",
      firstVolumes,
      "Für den aktuellen Monat und die Zukunft sind keine Reihen mit Band 1 erfasst."
    );
  }

  function setupReleaseBrowser() {
    const monthSelect = document.querySelector("#month-filter");
    const publisherSelect = document.querySelector("#publisher-filter");
    const searchInput = document.querySelector("#release-search");
    const sortSelect = document.querySelector("#sort-filter");
    const resetButton = document.querySelector("#reset-filters");
    const params = new URLSearchParams(window.location.search);

    populateMonthOptions(monthSelect);
    populatePublisherOptions(publisherSelect);

    const requestedMonth = params.get("month");
    const requestedPublisher = params.get("publisher");
    const currentKey = monthKey(new Date());
    const availableMonths = [...monthSelect.options].map((option) => option.value);

    monthSelect.value = availableMonths.includes(requestedMonth)
      ? requestedMonth
      : availableMonths.includes(currentKey)
        ? currentKey
        : "all";
    publisherSelect.value = [...publisherSelect.options].some(
      (option) => option.value === requestedPublisher
    )
      ? requestedPublisher
      : "all";

    const update = () => {
      const query = searchInput.value.trim().toLocaleLowerCase(locale);
      let filtered = releases.filter((release) => {
        const monthMatches =
          monthSelect.value === "all" ||
          (monthSelect.value === "unknown"
            ? !release.release_date
            : release.release_date?.startsWith(monthSelect.value));
        const publisherMatches =
          publisherSelect.value === "all" || release.publisher_id === publisherSelect.value;
        const haystack = [
          release.title,
          release.source_title,
          release.volume_label,
          release.publisher_name,
          release.isbn,
          ...(release.authors || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase(locale);
        return monthMatches && publisherMatches && (!query || haystack.includes(query));
      });

      filtered = sortReleases(filtered, sortSelect.value);
      setText(
        "#result-count",
        `${filtered.length} ${filtered.length === 1 ? "Veröffentlichung" : "Veröffentlichungen"}`
      );
      renderCards(
        "#release-results",
        filtered,
        "Keine Veröffentlichungen passen zu diesen Filtern."
      );
    };

    [monthSelect, publisherSelect, sortSelect].forEach((control) =>
      control.addEventListener("change", update)
    );
    searchInput.addEventListener("input", update);
    resetButton.addEventListener("click", () => {
      monthSelect.value = "all";
      publisherSelect.value = "all";
      searchInput.value = "";
      sortSelect.value = "date-asc";
      update();
    });
    update();
  }

  function renderPreview() {
    const nextMonth = new Date();
    nextMonth.setDate(1);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const key = monthKey(nextMonth);
    const matches = releases
      .filter((release) => release.release_date?.startsWith(key))
      .sort(compareDateAscending);

    setText("[data-preview-month]", formatMonth(key));
    setText(
      "#preview-count",
      `${matches.length} ${matches.length === 1 ? "Veröffentlichung" : "Veröffentlichungen"}`
    );
    renderCards(
      "#preview-results",
      matches,
      `Für ${formatMonth(key)} sind derzeit keine Veröffentlichungen erfasst.`
    );
  }

  function renderPublishers() {
    const container = document.querySelector("#publisher-results");
    const counts = new Map();
    releases.forEach((release) => {
      counts.set(release.publisher_id, (counts.get(release.publisher_id) || 0) + 1);
    });

    container.replaceChildren(
      ...[...counts.entries()]
        .sort(([left], [right]) =>
          collator.compare(publisherName(left), publisherName(right))
        )
        .map(([id, count], index) => createPublisherCard(id, count, index))
    );
  }

  function renderDetail() {
    const id = new URLSearchParams(window.location.search).get("id");
    const release = releases.find((item) => item.id === id);
    const loading = document.querySelector("#detail-loading");
    const shell = document.querySelector("#detail-content");

    if (!release) {
      loading.replaceWith(
        createState(
          "error-state",
          "Veröffentlichung nicht gefunden",
          "Der Link ist möglicherweise veraltet oder unvollständig."
        )
      );
      return;
    }

    loading.hidden = true;
    shell.hidden = false;
    document.title = `${release.title}${volumeText(release) ? ` – ${volumeText(release)}` : ""} | Manga-Neuheiten`;

    setText("#detail-title", release.title);
    setText("#detail-subtitle", detailSubtitle(release));
    setText("#detail-publisher", publisherName(release.publisher_id, release.publisher_name));
    setText("#detail-date", formatDate(release.release_date));
    setText("#detail-price", formatPrice(release.price_cents));
    setText("#detail-isbn", release.isbn || "Nicht angegeben");
    setText(
      "#detail-authors",
      release.authors?.length ? release.authors.join(", ") : "Nicht angegeben"
    );
    setText("#detail-binding", release.binding || "Nicht angegeben");
    setText(
      "#detail-pages",
      release.page_count ? `${release.page_count} Seiten` : "Nicht angegeben"
    );

    const description = document.querySelector("#detail-description");
    if (release.synopsis) {
      setText("#detail-description-text", release.synopsis);
      description.hidden = false;
    }

    const cover = document.querySelector("#detail-cover");
    cover.style.setProperty(
      "--cover-color",
      publisherColors[release.publisher_id] || "#335c67"
    );
    cover.querySelector("span").textContent = initials(release.title);
  }

  function createReleaseCard(release) {
    const article = element("article", "release-card");
    const cover = element("div", "cover-art");
    cover.setAttribute("aria-hidden", "true");
    cover.style.setProperty(
      "--cover-color",
      publisherColors[release.publisher_id] || "#335c67"
    );
    cover.append(element("span", "", initials(release.title)));

    const body = element("div", "card-body");
    const kicker = element("div", "card-kicker");
    kicker.append(
      element("span", "", publisherName(release.publisher_id, release.publisher_name)),
      element("time", "", formatDate(release.release_date))
    );
    if (release.release_date) kicker.lastElementChild.dateTime = release.release_date;

    const title = element("h3", "", release.title);
    const subtitle = element("p", "card-subtitle", cardSubtitle(release));
    const meta = element("dl", "card-meta");
    appendDefinition(meta, "Preis", formatPrice(release.price_cents));
    appendDefinition(meta, "ISBN", release.isbn || "Nicht angegeben");

    const actions = element("div", "card-actions");
    const link = element("a", "card-link", "Details ansehen →");
    link.href = `detail.html?id=${encodeURIComponent(release.id)}`;
    link.setAttribute(
      "aria-label",
      `Details zu ${release.title}${volumeText(release) ? `, ${volumeText(release)}` : ""}`
    );
    actions.append(link);
    body.append(kicker, title, subtitle, meta, actions);
    article.append(cover, body);
    return article;
  }

  function createPublisherCard(id, count, index) {
    const article = element("article", "publisher-card");
    article.append(
      element("div", "publisher-index", String(index + 1).padStart(2, "0")),
      element("h2", "", publisherName(id)),
      element(
        "p",
        "",
        `${count} ${count === 1 ? "erfasste Veröffentlichung" : "erfasste Veröffentlichungen"}`
      )
    );
    const link = element("a", "button", "Veröffentlichungen filtern →");
    link.href = `new-releases.html?month=all&publisher=${encodeURIComponent(id)}`;
    article.append(link);
    return article;
  }

  function renderCards(selector, items, emptyMessage) {
    const container = document.querySelector(selector);
    if (!container) return;
    if (!items.length) {
      container.replaceChildren(
        createState("empty-state", "Keine Ergebnisse", emptyMessage)
      );
      return;
    }
    container.replaceChildren(...items.map(createReleaseCard));
  }

  function renderLoadError() {
    const targets = document.querySelectorAll("[data-release-container]");
    const error = () =>
      createState(
        "error-state",
        "Daten konnten nicht geladen werden",
        "Bitte versuche es später erneut."
      );
    targets.forEach((target) => target.replaceChildren(error()));

    const detailLoading = document.querySelector("#detail-loading");
    if (detailLoading) detailLoading.replaceWith(error());
  }

  function populateMonthOptions(select) {
    const counts = new Map();
    let unknownCount = 0;
    releases.forEach((release) => {
      if (!release.release_date) {
        unknownCount += 1;
        return;
      }
      const key = release.release_date.slice(0, 7);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    [...counts.keys()].sort().forEach((key) => {
      select.add(new Option(`${formatMonth(key)} (${counts.get(key)})`, key));
    });
    if (unknownCount) select.add(new Option(`Termin offen (${unknownCount})`, "unknown"));
  }

  function populatePublisherOptions(select) {
    unique(releases.map((release) => release.publisher_id))
      .sort((left, right) => collator.compare(publisherName(left), publisherName(right)))
      .forEach((id) => select.add(new Option(publisherName(id), id)));
  }

  function sortReleases(items, mode) {
    const result = [...items];
    if (mode === "date-desc") return result.sort(compareDateDescendingWithUnknownLast);
    if (mode === "title-asc") {
      return result.sort((left, right) => collator.compare(left.title, right.title));
    }
    if (mode === "price-asc") return result.sort(comparePriceAscending);
    if (mode === "price-desc") return result.sort(comparePriceDescending);
    return result.sort(compareDateAscendingWithUnknownLast);
  }

  function compareDateAscending(left, right) {
    return (left.release_date || "").localeCompare(right.release_date || "") ||
      collator.compare(left.title, right.title);
  }

  function compareDateAscendingWithUnknownLast(left, right) {
    if (!left.release_date && right.release_date) return 1;
    if (left.release_date && !right.release_date) return -1;
    return compareDateAscending(left, right);
  }

  function compareDateDescendingWithUnknownLast(left, right) {
    if (!left.release_date && right.release_date) return 1;
    if (left.release_date && !right.release_date) return -1;
    return (right.release_date || "").localeCompare(left.release_date || "") ||
      collator.compare(left.title, right.title);
  }

  function comparePriceAscending(left, right) {
    if (left.price_cents == null && right.price_cents != null) return 1;
    if (left.price_cents != null && right.price_cents == null) return -1;
    return (left.price_cents || 0) - (right.price_cents || 0) ||
      collator.compare(left.title, right.title);
  }

  function comparePriceDescending(left, right) {
    if (left.price_cents == null && right.price_cents != null) return 1;
    if (left.price_cents != null && right.price_cents == null) return -1;
    return (right.price_cents || 0) - (left.price_cents || 0) ||
      collator.compare(left.title, right.title);
  }

  function isFirstVolume(release) {
    return Number(release.volume_sort) === 1 || String(release.volume_label || "").trim() === "1";
  }

  function cardSubtitle(release) {
    const parts = [volumeText(release), release.edition].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Einzelausgabe oder Band nicht angegeben";
  }

  function detailSubtitle(release) {
    const parts = [volumeText(release), release.edition].filter(Boolean);
    if (!parts.length && release.source_title && release.source_title !== release.title) {
      return release.source_title;
    }
    return parts.length ? parts.join(" · ") : "Einzelausgabe oder Band nicht angegeben";
  }

  function volumeText(release) {
    return release.volume_label ? `Band ${release.volume_label}` : "";
  }

  function publisherName(id, fallback = "") {
    return publisherNames.get(id) || fallback || id;
  }

  function formatDate(value) {
    if (!value) return "Termin offen";
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  }

  function formatMonth(key) {
    if (!key) return "Monat nicht verfügbar";
    const [year, month] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, 1)));
  }

  function formatPrice(cents) {
    if (cents == null) return "Nicht angegeben";
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  }

  function initials(title) {
    const words = title.trim().split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0]?.slice(0, 2) || "MN")
      .toLocaleUpperCase(locale);
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function isoToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function setText(selector, value) {
    const target = document.querySelector(selector);
    if (target) target.textContent = value;
  }

  function appendDefinition(list, term, description) {
    list.append(element("dt", "", term), element("dd", "", description));
  }

  function createState(className, heading, message) {
    const state = element("div", className);
    state.setAttribute("role", className === "error-state" ? "alert" : "status");
    state.append(element("h2", "", heading), element("p", "", message));
    return state;
  }

  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
})();
