document.addEventListener("DOMContentLoaded", function () {
  const commonConfig = {
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d/m/Y",
    locale: "fr",
    allowInput: true,
    minDate: "today",
    maxDate: new Date().fp_incr(30),
  };

  const fpRetour = flatpickr("#date-retour", commonConfig);
  const fpAller = flatpickr("#date-aller", {
    ...commonConfig,
    onChange: function (selectedDates) {
      if (selectedDates.length > 0) {
        fpRetour.set("minDate", selectedDates[0]);
        const currentRetour = fpRetour.selectedDates[0];
        if (currentRetour && currentRetour < selectedDates[0]) fpRetour.clear();
      } else {
        fpRetour.set("minDate", "today");
      }
    },
  });
});

// Logic bật tắt phần Cài đặt nâng cao (Advanced Settings)
document
  .getElementById("advanced-toggle")
  .addEventListener("click", function () {
    const adv = document.getElementById("advanced-settings");
    if (adv.style.display === "none") {
      adv.style.display = "grid";
      this.innerHTML = "⚙️ Masquer les paramètres avancés";
    } else {
      adv.style.display = "none";
      this.innerHTML = "⚙️ Paramètres avancés (Temps d'attente)";
    }
  });

// 1. Initialisation de la liste des gares
async function fetchStations() {
  const dataList = document.getElementById("stations-list");
  let stations = new Set();
  let offset = 0;
  try {
    while (offset < 1000) {
      const res = await fetch(
        `https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/tgvmax/records?group_by=origine&limit=100&offset=${offset}`,
      );
      const data = await res.json();
      if (!data.results || data.results.length === 0) break;
      data.results.forEach((r) => {
        if (r.origine) stations.add(r.origine);
      });
      if (data.results.length < 100) break;
      offset += 100;
    }
    Array.from(stations)
      .sort()
      .forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s;
        dataList.appendChild(opt);
      });
  } catch (e) {
    console.error("Erreur de chargement des gares:", e);
  }
}

fetchStations();

window.toggleRetour = function (show) {
  document.getElementById("box-retour").style.display = show ? "flex" : "none";
};

function normalizeStation(name) {
  const lower = name.trim().toLowerCase();
  if (
    lower.includes("cdg") ||
    lower.includes("roissy") ||
    lower.includes("massy") ||
    lower.includes("marne")
  )
    return name;
  if (lower.includes("paris")) return "PARIS (intramuros)";
  if (lower.includes("lyon") && !lower.includes("exupery"))
    return "LYON (intramuros)";
  if (lower.includes("lille")) return "LILLE (intramuros)";
  return name;
}

const iataMapping = {
  FRPMO: "PARIS (Montparnasse)",
  FRPLY: "PARIS (Gare de Lyon)",
  FRPNO: "PARIS (Gare du Nord)",
  FRPST: "PARIS (Gare de l'Est)",
  FRPAZ: "PARIS (Austerlitz)",
  FRPBE: "PARIS (Bercy)",
  FRLPD: "LYON (Part-Dieu)",
  FRLPE: "LYON (Perrache)",
  FRXLF: "LILLE (Flandres)",
  FRLIE: "LILLE (Europe)",
};

function getExactStationName(defaultName, iataCode) {
  if (iataMapping[iataCode]) {
    return iataMapping[iataCode];
  }
  return defaultName;
}

function timeToMins(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function formatDate(dStr) {
  if (!dStr) return "";
  const [y, m, d] = dStr.split("-");
  return `${d}/${m}/${y}`;
}

async function fetchAllAPI(whereClause) {
  const url = `https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/tgvmax/exports/json?where=${encodeURIComponent(whereClause)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Impossible de se connecter au serveur SNCF.");
  return await res.json();
}

function findRoutes(records, origin, dest, maxConnections, minWait, maxWait) {
  if (maxConnections === 0) {
    return records
      .filter(
        (r) =>
          r.origine.toLowerCase() === origin.toLowerCase() &&
          r.destination.toLowerCase() === dest.toLowerCase(),
      )
      .map((r) => [r]);
  }

  const graphByDate = {};
  records.forEach((r) => {
    if (!r.date || !r.origine) return;
    if (!graphByDate[r.date]) graphByDate[r.date] = {};

    const orig = r.origine.toUpperCase();
    if (!graphByDate[r.date][orig]) graphByDate[r.date][orig] = [];
    graphByDate[r.date][orig].push(r);
  });

  const validRoutes = [];

  for (const date in graphByDate) {
    const graph = graphByDate[date];
    const startStations = Object.keys(graph).filter(
      (s) => s.toLowerCase() === origin.toLowerCase(),
    );

    function dfs(currentStation, currentPath) {
      if (currentPath.length > maxConnections + 1) return;

      if (currentStation.toLowerCase() === dest.toLowerCase()) {
        validRoutes.push([...currentPath]);
        return;
      }

      const nextOrig = currentStation.toUpperCase();
      if (!graph[nextOrig]) return;

      const lastTrain =
        currentPath.length > 0 ? currentPath[currentPath.length - 1] : null;

      for (const nextTrain of graph[nextOrig]) {
        if (lastTrain) {
          const arrTime = timeToMins(lastTrain.heure_arrivee);
          const depTime = timeToMins(nextTrain.heure_depart);
          const waitTime = depTime - arrTime;

          // Kiểm tra min/max wait từ thông số cài đặt
          if (waitTime < minWait || waitTime > maxWait) continue;
        }

        currentPath.push(nextTrain);
        dfs(nextTrain.destination, currentPath);
        currentPath.pop();
      }
    }
    startStations.forEach((startNode) => dfs(startNode, []));
  }

  return validRoutes;
}

function renderRoutes(routes, containerId, title) {
  const container = document.getElementById(containerId);
  let html = `<div class="result-section">
                    <h2 class="section-title">${title} (${routes.length})</h2>`;

  if (routes.length === 0) {
    html += `<div class="vector-box" style="padding: 20px; border-color: var(--danger-bg); text-align: center;"><strong>Aucun trajet n'est disponible.</strong></div></div>`;
    container.innerHTML += html;
    return;
  }

  routes.sort((a, b) => {
    if (a[0].date !== b[0].date) return a[0].date.localeCompare(b[0].date);
    return timeToMins(a[0].heure_depart) - timeToMins(b[0].heure_depart);
  });

  html += `<div class="cards-grid">`;

  routes.forEach((route) => {
    const isDirect = route.length === 1;
    const badgeClass = isDirect ? "badge direct" : "badge";
    const badgeText = isDirect ? "Direct" : `${route.length - 1} Corresp.`;

    const viaStations = route
      .slice(0, -1)
      .map((r) => getExactStationName(r.destination, r.destination_iata))
      .join(", ");

    const viaHtml = !isDirect
      ? `<div class="trip-via">Via : ${viaStations}</div>`
      : "";

    const titleOrig = getExactStationName(
      route[0].origine,
      route[0].origine_iata,
    );

    const titleDest = getExactStationName(
      route[route.length - 1].destination,
      route[route.length - 1].destination_iata,
    );

    let legsHtml = "";
    for (let i = 0; i < route.length; i++) {
      const train = route[i];

      const exactOrigine = getExactStationName(
        train.origine,
        train.origine_iata,
      );
      const exactDestination = getExactStationName(
        train.destination,
        train.destination_iata,
      );

      legsHtml += `
        <div class="train-leg">
            <div class="train-time">${train.heure_depart} <br> <span style="font-size:0.8em;">▼</span> <br> ${train.heure_arrivee}</div>
            <div class="train-route">
                <strong>${exactOrigine}</strong><br>
                ➔ <strong>${exactDestination}</strong><br>
                <small style="font-weight: 700; opacity: 0.7;">${formatDate(train.date)}</small>
            </div>
            <div><span class="train-no">TGV ${train.train_no}</span></div>
        </div>
    `;

      if (i < route.length - 1) {
        const waitMins =
          timeToMins(route[i + 1].heure_depart) -
          timeToMins(train.heure_arrivee);
        const h = Math.floor(waitMins / 60);
        const m = waitMins % 60;
        legsHtml += `<div class="transfer-wait">CORRESPONDANCE : ${h}H${m.toString().padStart(2, "0")}</div>`;
      }
    }

    html += `
            <div class="trip-card vector-box">
                <div class="trip-header">
                    <div class="trip-title">${titleOrig}<br>➔ ${titleDest}</div>
                    <div class="${badgeClass}">${badgeText}</div>
                </div>
                ${viaHtml}
                ${legsHtml}
            </div>
        `;
  });

  html += `</div></div>`;
  container.innerHTML += html;
}

document
  .getElementById("search-form")
  .addEventListener("submit", async function (e) {
    e.preventDefault();

    const originInput = document.getElementById("origin").value.trim();
    const destInput = document.getElementById("destination").value.trim();

    const dateAller = document.getElementById("date-aller").value;
    const dateRetour = document.getElementById("date-retour").value;

    const connections = parseInt(document.getElementById("connections").value);
    const tripType = document.querySelector(
      'input[name="trip-type"]:checked',
    ).value;

    const minWait = parseInt(document.getElementById("min-wait").value) || 60;
    const maxWait = parseInt(document.getElementById("max-wait").value) || 240;

    const resultsContainer = document.getElementById("results-container");
    const loading = document.getElementById("loading");
    const warning = document.getElementById("warning-msg");
    const btn = document.getElementById("submit-btn");

    resultsContainer.innerHTML = "";
    warning.style.display = "none";

    loading.style.display = "block";
    btn.disabled = true;

    const originSNCF = normalizeStation(originInput);
    const destSNCF = normalizeStation(destInput);

    try {
      // --- ALLER ---
      let whereAller = `od_happy_card="OUI"`;
      if (dateAller) {
        whereAller += ` and date=date'${dateAller}'`;
      } else if (connections === 0) {
        whereAller += ` and search(origine, "${originSNCF}") and search(destination, "${destSNCF}")`;
      }

      const recordsAller = await fetchAllAPI(whereAller);

      const routesAller = findRoutes(
        recordsAller,
        originSNCF,
        destSNCF,
        connections,
        minWait,
        maxWait,
      );
      renderRoutes(routesAller, "results-container", "Trajet Aller");

      // --- RETOUR ---
      if (tripType === "retour") {
        let whereRetour = `od_happy_card="OUI"`;
        if (dateRetour) {
          whereRetour += ` and date=date'${dateRetour}'`;
        } else if (connections === 0) {
          whereRetour += ` and search(origine, "${destSNCF}") and search(destination, "${originSNCF}")`;
        }
        const recordsRetour = await fetchAllAPI(whereRetour);
        const routesRetour = findRoutes(
          recordsRetour,
          destSNCF,
          originSNCF,
          connections,
          minWait,
          maxWait,
        );
        renderRoutes(routesRetour, "results-container", "Trajet Retour");
      }
    } catch (error) {
      console.error(error);
      warning.innerHTML = "Erreur de connexion : " + error.message;
      warning.style.display = "block";
    } finally {
      loading.style.display = "none";
      btn.disabled = false;
    }
  });
