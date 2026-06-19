const eventSelect = document.querySelector("#eventSelect");
const showtimeField = document.querySelector("#showtimeField");
const showtimeSelect = document.querySelector("#showtimeSelect");
const statusBox = document.querySelector("#statusBox");
const resultBox = document.querySelector("#resultBox");
const iframeWrap = document.querySelector("#iframeWrap");
const selectionList = document.querySelector("#selectionList");
const cartTotal = document.querySelector("#cartTotal");
const holdButton = document.querySelector("#holdButton");
const purchaseButton = document.querySelector("#purchaseButton");
const customerName = document.querySelector("#customerName");
const customerEmail = document.querySelector("#customerEmail");
const apiCodeBlock = document.querySelector("#apiCodeBlock");
const copyApiCodeButton = document.querySelector("#copyApiCodeButton");
const showFullSourceButton = document.querySelector("#showFullSourceButton");
const hideFullSourceButton = document.querySelector("#hideFullSourceButton");
const sourcePanel = document.querySelector("#sourcePanel");
const sourceHtml = document.querySelector("#sourceHtml");
const sourceJs = document.querySelector("#sourceJs");
const sourceCss = document.querySelector("#sourceCss");

let currentSelection = [];
let currentContext = null;
let currentHold = null;
let currentEvent = null;

function formatMoney(amount, currency = "XOF") {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

function setStatus(value) {
  statusBox.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setResult(value) {
  resultBox.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setApiCode(value) {
  apiCodeBlock.textContent = value.trim();
}

function buildLocalApiSnippet(method, path, body) {
  const lines = [
    `const response = await fetch("${path}", {`,
    `  method: "${method}",`,
    `  headers: { "Content-Type": "application/json" },`,
  ];
  if (body) {
    lines.push(`  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, "\n  ")}),`);
  }
  lines.push("});", "const result = await response.json();", "console.log(result);");
  return lines.join("\n");
}

function buildTicketSeatSnippet(method, path, body) {
  const lines = [
    `// Cote serveur Go : le token reste dans .env`,
    `request, _ := http.NewRequest("${method}", ticketSeatAPIBaseURL+"${path}", nil)`,
    `request.Header.Set("Authorization", "Bearer "+partnerToken)`,
  ];
  if (body) {
    lines.push(`// Corps JSON : ${JSON.stringify(body)}`);
  }
  lines.push("response, _ := http.DefaultClient.Do(request)", "defer response.Body.Close()");
  return lines.join("\n");
}

function setCurrentApiExample(title, localMethod, localPath, ticketSeatPath, body) {
  setApiCode(`${title}

// Appel depuis la page demo vers Go
${buildLocalApiSnippet(localMethod, localPath, body)}

// Appel equivalent execute par Go vers Ticket Seat
${buildTicketSeatSnippet(localMethod, ticketSeatPath, body)}`);
}

function formatSeatLabel(item) {
  if (item.type === "ZONE") {
    return item.label || item.id;
  }

  const seat = item.seat || {};
  const row = seat.row || seat.section || "";
  const number = seat.number || "";
  return item.label || `${row}${number}`.trim() || item.id;
}

function formatCategoryLabel(item) {
  return item.categoryLabel || item.priceCategory || "Standard";
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw body;
  }
  return body;
}

function renderCart() {
  if (!currentSelection.length) {
    selectionList.innerHTML = '<p class="muted">Aucun siege selectionne.</p>';
    cartTotal.textContent = "0 XOF";
    holdButton.disabled = true;
    purchaseButton.disabled = true;
    currentHold = null;
    return;
  }

  const total = currentSelection.reduce((sum, seat) => sum + Number(seat.price || 0), 0);
  const currency = currentSelection[0]?.currency || "XOF";

  selectionList.innerHTML = currentSelection
    .map(
      (seat) => `
        <div class="seat-row">
          <span>
            <strong>${seat.type === "ZONE" ? "Zone" : "Siege"} ${formatSeatLabel(seat)}</strong>
            <small>Categorie ${formatCategoryLabel(seat)}</small>
          </span>
          <strong>${formatMoney(seat.price || 0, seat.currency || currency)}</strong>
        </div>
      `,
    )
    .join("");

  cartTotal.textContent = formatMoney(total, currency);
  holdButton.disabled =
    !(currentContext?.eventId || currentContext?.showtimeId) || !currentContext?.layoutId;
  purchaseButton.disabled = !currentHold;
}

async function loadEvents() {
  try {
    setCurrentApiExample(
      "1. Lister les evenements autorises",
      "GET",
      "/api/events",
      "/partner/events",
    );
    const events = await api("/api/events");
    eventSelect.innerHTML = events.length
      ? '<option value="">Choisir un evenement</option>'
      : '<option value="">Aucun evenement autorise</option>';

    for (const item of events) {
      const option = document.createElement("option");
      option.value = item.id;
      option.dataset.eventType = item.eventType || "STANDARD";
      const kind = item.eventType === "CINEMA" ? "Cinema" : "Standard";
      option.textContent = `${item.name} - ${kind} (${item.code || item.id})`;
      eventSelect.appendChild(option);
    }

    setStatus(events);
  } catch (error) {
    setStatus(error);
  }
}

async function loadShowtimes(eventId) {
  currentSelection = [];
  currentContext = null;
  currentHold = null;
  renderCart();
  iframeWrap.innerHTML = "<p>Choisis une seance pour afficher le plan.</p>";

  if (!eventId) {
    showtimeSelect.disabled = true;
    showtimeSelect.innerHTML = "<option value=''>Choisis d'abord un evenement cinema</option>";
    return;
  }

  try {
    setCurrentApiExample(
      "2. Lister les seances cinema",
      "GET",
      `/api/events/${eventId}/showtimes`,
      `/partner/events/${eventId}/showtimes`,
    );
    const showtimes = await api(`/api/events/${eventId}/showtimes`);
    showtimeSelect.disabled = false;
    showtimeSelect.innerHTML = showtimes.length
      ? '<option value="">Choisir une seance</option>'
      : '<option value="">Aucune seance disponible</option>';

    for (const item of showtimes) {
      const option = document.createElement("option");
      option.value = item.id;
      const startsAt = new Date(item.startsAt).toLocaleString("fr-FR");
      option.textContent = `${item.venue?.name || "Cinema"} - ${item.room?.name || "Salle"} - ${startsAt}`;
      showtimeSelect.appendChild(option);
    }

    setStatus(showtimes);
  } catch (error) {
    setStatus(error);
  }
}

async function loadStandardEmbed(eventId) {
  currentSelection = [];
  currentContext = null;
  currentHold = null;
  renderCart();

  if (!eventId) {
    iframeWrap.innerHTML = "<p>Choisis un evenement pour afficher le plan.</p>";
    return;
  }

  try {
    setCurrentApiExample(
      "2. Obtenir le plan standard pret a afficher",
      "GET",
      `/api/events/${eventId}/embed`,
      `/partner/events/${eventId}/embed`,
    );
    const embed = await api(`/api/events/${eventId}/embed`);
    iframeWrap.innerHTML = `
      <iframe
        src="${embed.embedUrl}"
        title="Plan Ticket Seat"
        loading="lazy"
        allow="payment *"
      ></iframe>
    `;
    setStatus(embed);
  } catch (error) {
    iframeWrap.innerHTML = "<p>Impossible de charger le plan. Regarde le message d'erreur.</p>";
    setStatus(error);
  }
}

async function loadShowtimeEmbed(showtimeId) {
  currentSelection = [];
  currentContext = null;
  currentHold = null;
  renderCart();

  if (!showtimeId) {
    iframeWrap.innerHTML = "<p>Choisis une seance pour afficher le plan.</p>";
    return;
  }

  try {
    setCurrentApiExample(
      "3. Obtenir le plan cinema pret a afficher",
      "GET",
      `/api/showtimes/${showtimeId}/embed`,
      `/partner/showtimes/${showtimeId}/embed`,
    );
    const embed = await api(`/api/showtimes/${showtimeId}/embed`);
    iframeWrap.innerHTML = `
      <iframe
        src="${embed.embedUrl}"
        title="Plan Ticket Seat"
        loading="lazy"
        allow="payment *"
      ></iframe>
    `;
    setStatus(embed);
  } catch (error) {
    iframeWrap.innerHTML = "<p>Impossible de charger le plan. Regarde le message d'erreur.</p>";
    setStatus(error);
  }
}

window.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "ticket-seat:selection-changed") {
    return;
  }

  const payload = data.payload || {};
  currentContext = {
    eventId: payload.eventId,
    showtimeId: payload.showtimeId,
    layoutId: payload.layoutId,
  };
  currentSelection = Array.isArray(payload.selection) ? payload.selection : [];
  currentHold = null;
  setApiCode(`Selection recue depuis l'iframe Ticket Seat

window.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "ticket-seat:selection-changed") return;

  const { eventId, showtimeId, layoutId, selection } = data.payload;
  const seatIds = selection.map((seat) => seat.id);

  // Le checkout partenaire affiche son propre panier.
  console.log({ eventId, showtimeId, layoutId, seatIds, selection });
});`);
  setStatus(data.payload);
  setResult({ message: "Selection recue depuis le plan", ...currentContext, currentSelection });
  renderCart();
});

eventSelect.addEventListener("change", () => {
  const option = eventSelect.selectedOptions[0];
  currentEvent = {
    id: eventSelect.value,
    eventType: option?.dataset.eventType || "STANDARD",
  };

  if (!currentEvent.id) {
    showtimeField.hidden = true;
    showtimeSelect.disabled = true;
    showtimeSelect.innerHTML = "<option value=''>Choisis d'abord un evenement</option>";
    iframeWrap.innerHTML = "<p>Choisis un evenement pour afficher le plan.</p>";
    return;
  }

  if (currentEvent.eventType === "CINEMA") {
    showtimeField.hidden = false;
    void loadShowtimes(currentEvent.id);
  } else {
    showtimeField.hidden = true;
    showtimeSelect.disabled = true;
    showtimeSelect.innerHTML = "<option value=''>Non requis pour un evenement standard</option>";
    void loadStandardEmbed(currentEvent.id);
  }
});
showtimeSelect.addEventListener("change", () => loadShowtimeEmbed(showtimeSelect.value));

holdButton.addEventListener("click", async () => {
  try {
    const body = {
      ...currentContext,
      selection: currentSelection,
      durationMinutes: 5,
    };
    setCurrentApiExample("4. Reserver temporairement les places", "POST", "/api/holds", "/holds", {
      layoutId: currentContext.layoutId,
      eventId: currentContext.showtimeId ? undefined : currentContext.eventId,
      showtimeId: currentContext.showtimeId || undefined,
      seatIds: currentSelection.map((seat) => seat.id),
      durationMinutes: 5,
    });
    const hold = await api("/api/holds", {
      method: "POST",
      body: JSON.stringify(body),
    });
    currentHold = hold;
    purchaseButton.disabled = false;
    setStatus(hold);
    setResult(hold);
  } catch (error) {
    setStatus(error);
    setResult(error);
  }
});

purchaseButton.addEventListener("click", async () => {
  try {
    const body = {
      ...currentContext,
      holdId: currentHold.holdId,
      selection: currentSelection,
      currency: currentSelection[0]?.currency || "XOF",
      customerName: customerName.value,
      customerEmail: customerEmail.value,
    };
    setCurrentApiExample(
      "5. Confirmer l'achat",
      "POST",
      "/api/purchases",
      "/purchases",
      {
        layoutId: currentContext.layoutId,
        eventId: currentContext.showtimeId ? undefined : currentContext.eventId,
        showtimeId: currentContext.showtimeId || undefined,
        holdId: currentHold.holdId,
        selection: currentSelection,
        total: currentSelection.reduce((sum, seat) => sum + Number(seat.price || 0), 0),
        currency: currentSelection[0]?.currency || "XOF",
      },
    );
    const purchase = await api("/api/purchases", {
      method: "POST",
      body: JSON.stringify(body),
    });
    currentHold = null;
    purchaseButton.disabled = true;
    setStatus(purchase);
    setResult(purchase);
  } catch (error) {
    setStatus(error);
    setResult(error);
  }
});

copyApiCodeButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(apiCodeBlock.textContent || "");
  copyApiCodeButton.textContent = "Copie";
  window.setTimeout(() => {
    copyApiCodeButton.textContent = "Copier";
  }, 1200);
});

showFullSourceButton.addEventListener("click", async () => {
  sourcePanel.hidden = false;
  if (sourceHtml.textContent) {
    return;
  }
  const bundle = await api("/api/source-bundle");
  sourceHtml.textContent = bundle.html;
  sourceJs.textContent = bundle.js;
  sourceCss.textContent = bundle.css;
});

hideFullSourceButton.addEventListener("click", () => {
  sourcePanel.hidden = true;
});

loadEvents();
