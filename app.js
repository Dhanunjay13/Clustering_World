(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const colors = [
    "#14866e",
    "#e5a453",
    "#688bd2",
    "#b66d8c"
  ];

  let dataset;
  let model;
  let countries;
  let selected;
  let uploadResults = [];

  let pendingRequestId = null;
  let lastDisplayedResponseId = null;
  let latestResponse = null;
  let lastHeight = 0;


  function sendToStreamlit(type, fields = {}) {
    window.parent.postMessage(
      {
        isStreamlitMessage: true,
        type,
        ...fields
      },
      "*"
    );
  }


  function updateFrameHeight() {
    const height = Math.max(
      700,
      Math.ceil(document.documentElement.scrollHeight)
    );

    if (height !== lastHeight) {
      lastHeight = height;

      sendToStreamlit(
        "streamlit:setFrameHeight",
        { height }
      );
    }
  }


  function applyPythonResponse() {
    const response = latestResponse;

    if (
      !model ||
      !response ||
      !response.request_id ||
      response.request_id === lastDisplayedResponseId
    ) {
      return;
    }

    if (
      pendingRequestId &&
      response.request_id !== pendingRequestId
    ) {
      return;
    }

    lastDisplayedResponseId = response.request_id;
    pendingRequestId = null;

    const status = $("upload-status");

    status.classList.toggle(
      "error-text",
      Boolean(response.error)
    );

    if (response.error) {
      status.textContent = response.error;
      $("results-card").classList.add("hidden");

    } else {
      uploadResults = response.rows || [];

      status.textContent =
        `Processed ${response.file_name || "your file"} successfully.`;

      renderPredictions();
    }

    setPage("predict");
    updateFrameHeight();
  }


  window.addEventListener("message", event => {
    if (
      event.source !== window.parent ||
      event.data?.type !== "streamlit:render"
    ) {
      return;
    }

    latestResponse =
      event.data.args?.prediction_response || null;

    applyPythonResponse();
    updateFrameHeight();
  });


  function setPage(name) {
    document.querySelectorAll(".page").forEach(page => {
      page.classList.toggle(
        "hidden",
        page.id !== "page-" + name
      );
    });

    document.querySelectorAll(".nav-link").forEach(link => {
      const active = link.dataset.page === name;

      link.classList.toggle("active", active);

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    requestAnimationFrame(updateFrameHeight);
  }


  function formatNumber(value) {
    if (
      value === null ||
      value === undefined ||
      !Number.isFinite(Number(value))
    ) {
      return "Not available";
    }

    const number = Number(value);

    if (Math.abs(number) >= 1e12) {
      return (number / 1e12).toFixed(2) + "T";
    }

    if (Math.abs(number) >= 1e9) {
      return (number / 1e9).toFixed(2) + "B";
    }

    if (Math.abs(number) >= 1e6) {
      return (number / 1e6).toFixed(2) + "M";
    }

    return new Intl.NumberFormat(
      "en",
      { maximumFractionDigits: 3 }
    ).format(number);
  }


  function badge(cluster) {
    const element = document.createElement("span");

    element.className = "group-badge cluster-" + cluster;
    element.textContent = "Cluster " + cluster;

    return element;
  }


  function renderSelected() {
    $("country-select").value = selected.Country;
    $("country-name").textContent = selected.Country;

    const cluster = $("selected-cluster");

    cluster.className =
      "cluster-tag cluster-" + selected.Cluster;

    cluster.textContent =
      "Cluster " + selected.Cluster;

    $("cluster-size").textContent =
      model.stats.cluster_sizes[selected.Cluster] +
      " countries in this group";

    const values = [
      ["GDP", selected["GDP"]],
      ["Birth rate", selected["Birth Rate"]],
      [
        "Life expectancy (female)",
        selected["Life Expectancy Female"]
      ],
      ["Internet usage", selected["Internet Usage"]]
    ];

    const container = $("profile-stats");
    container.replaceChildren();

    values.forEach(([label, value]) => {
      const box = document.createElement("div");
      const small = document.createElement("small");
      const strong = document.createElement("strong");

      small.textContent = label;
      strong.textContent = formatNumber(value);

      box.append(small, strong);
      container.append(box);
    });

    renderPlot();
  }


  function svgElement(name, attributes, content) {
    const node = document.createElementNS(
      "http://www.w3.org/2000/svg",
      name
    );

    Object.entries(attributes).forEach(([key, value]) => {
      node.setAttribute(key, value);
    });

    if (content != null) {
      node.textContent = content;
    }

    return node;
  }


  function renderPlot() {
    const svg = $("scatter");
    svg.replaceChildren();

    const left = 42;
    const right = 602;
    const top = 14;
    const bottom = 266;

    const xs = countries.map(country => country.PC1);
    const ys = countries.map(country => country.PC2);

    const minx = Math.min(...xs);
    const maxx = Math.max(...xs);
    const miny = Math.min(...ys);
    const maxy = Math.max(...ys);

    const x = value =>
      left +
      (value - minx) / (maxx - minx || 1) *
      (right - left);

    const y = value =>
      bottom -
      (value - miny) / (maxy - miny || 1) *
      (bottom - top);

    for (let n = 0; n <= 4; n++) {
      const gx = left + n * (right - left) / 4;
      const gy = top + n * (bottom - top) / 4;

      svg.append(
        svgElement("line", {
          x1: gx,
          y1: top,
          x2: gx,
          y2: bottom,
          class: "grid-line"
        })
      );

      svg.append(
        svgElement("line", {
          x1: left,
          y1: gy,
          x2: right,
          y2: gy,
          class: "grid-line"
        })
      );
    }

    const orderedCountries = countries
      .filter(country => country.Country !== selected.Country)
      .concat([selected]);

    orderedCountries.forEach(country => {
      const active = country.Country === selected.Country;

      const dot = svgElement("circle", {
        cx: x(country.PC1),
        cy: y(country.PC2),
        r: active ? 7 : 4.5,
        fill: colors[country.Cluster],
        opacity: active ? 1 : 0.7,
        stroke: active ? "#ffffff" : "none",
        "stroke-width": active ? 2 : 0,
        class: "plot-point",
        tabindex: 0,
        role: "button",
        "aria-label":
          `${country.Country}, Cluster ${country.Cluster}`
      });

      dot.append(
        svgElement(
          "title",
          {},
          `${country.Country} · Cluster ${country.Cluster}`
        )
      );

      const choose = () => {
        selected = country;
        renderSelected();
      };

      dot.addEventListener("click", choose);

      dot.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose();
        }
      });

      svg.append(dot);
    });

    svg.append(
      svgElement(
        "text",
        {
          x: 540,
          y: 293,
          class: "axis-label"
        },
        "Component 1"
      )
    );

    svg.append(
      svgElement(
        "text",
        {
          x: 4,
          y: 22,
          class: "axis-label"
        },
        "PC 2"
      )
    );
  }


  function renderTable() {
    const query = $("search").value.trim().toLowerCase();

    const filtered = countries.filter(country =>
      country.Country.toLowerCase().includes(query)
    );

    const body = $("country-table");
    body.replaceChildren();

    filtered.forEach(country => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      const group = document.createElement("td");
      const missing = document.createElement("td");

      name.textContent = country.Country;
      group.append(badge(country.Cluster));

      missing.textContent =
        country["Missing indicators imputed"];

      row.append(name, group, missing);
      body.append(row);
    });

    $("table-count").textContent =
      `Showing ${filtered.length} of ${countries.length} countries`;
  }


  function download(filename, text) {
    const url = URL.createObjectURL(
      new Blob(
        [text],
        { type: "text/csv;charset=utf-8" }
      )
    );

    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }


  function renderPredictions() {
    const body = $("results-table");
    body.replaceChildren();

    uploadResults.forEach(result => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      const group = document.createElement("td");
      const missing = document.createElement("td");

      name.textContent = result.Country;
      group.append(badge(result.Cluster));

      missing.textContent =
        result["Missing indicators imputed"];

      row.append(name, group, missing);
      body.append(row);
    });

    $("results-caption").textContent =
      `${uploadResults.length} country profile` +
      `${uploadResults.length === 1 ? "" : "s"} processed`;

    $("results-card").classList.remove("hidden");
  }


  async function initialize() {
    const response = await fetch("data.json");

    if (!response.ok) {
      throw new Error("The model data could not be loaded.");
    }

    dataset = await response.json();

    model = dataset.model;
    countries = dataset.profiles;

    $("metric-countries").textContent =
      model.stats.countries;

    $("metric-features").textContent =
      model.stats.feature_count;

    $("metric-clusters").textContent =
      model.stats.clusters;

    $("metric-silhouette").textContent =
      model.stats.silhouette.toFixed(3);

    selected =
      countries.find(country => country.Country === "India")
      || countries[0];

    countries.forEach(country => {
      const option = document.createElement("option");

      option.value = country.Country;
      option.textContent = country.Country;

      $("country-select").append(option);
    });

    $("country-select").addEventListener(
      "change",
      event => {
        selected = countries.find(
          country => country.Country === event.target.value
        );

        renderSelected();
      }
    );

    $("search").addEventListener("input", renderTable);

    for (let i = 0; i < 4; i++) {
      const legend = document.createElement("span");
      const dot = document.createElement("i");

      dot.style.background = colors[i];

      legend.append(
        dot,
        document.createTextNode("Cluster " + i)
      );

      $("legend").append(legend);

      const row = document.createElement("div");
      row.className = "bar-row";

      const label = document.createElement("span");
      label.textContent = "Cluster " + i;

      const track = document.createElement("div");
      track.className = "bar-track";

      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.background = colors[i];

      fill.style.width =
        (100 * model.stats.cluster_sizes[i] / countries.length)
        + "%";

      track.append(fill);

      const count = document.createElement("span");
      count.className = "bar-count";

      count.textContent = model.stats.cluster_sizes[i];

      row.append(label, track, count);

      $("distribution").append(row);
    }

    $("feature-list").textContent = [
      "Country",
      ...model.feature_names
    ].join(" · ");


    $("download-template").addEventListener("click", () => {
      const examples = countries.filter(country =>
        ["India", "Brazil", "Japan"].includes(country.Country)
      );

      download(
        "example_country_input.csv",
        CountryModel.toCsv(
          examples,
          ["Country", ...model.feature_names]
        )
      );
    });


    $("download-predictions").addEventListener("click", () => {
      download(
        "country_predictions.csv",
        CountryModel.toCsv(
          uploadResults,
          [
            "Country",
            "Cluster",
            "Missing indicators imputed",
            "PC1",
            "PC2",
            ...model.feature_names
          ]
        )
      );
    });


    $("csv-file").addEventListener(
      "change",
      async event => {
        const status = $("upload-status");

        status.textContent = "";
        status.classList.remove("error-text");

        $("results-card").classList.add("hidden");

        uploadResults = [];

        const file = event.target.files[0];

        if (!file) return;

        try {
          if (file.size > 10 * 1024 * 1024) {
            throw new Error(
              "Please choose a CSV smaller than 10 MB."
            );
          }

          const csv = await file.text();

          pendingRequestId =
            `${Date.now()}-${Math.random().toString(36).slice(2)}`;

          status.textContent =
            `Processing ${file.name} with the trained model...`;

          sendToStreamlit(
            "streamlit:setComponentValue",
            {
              dataType: "json",
              value: {
                request_id: pendingRequestId,
                file_name: file.name,
                csv
              }
            }
          );

        } catch (error) {
          status.textContent = error.message;
          status.classList.add("error-text");
        }
      }
    );


    document.querySelectorAll(".nav-link").forEach(link => {
      link.addEventListener(
        "click",
        () => setPage(link.dataset.page)
      );
    });

    renderSelected();
    renderTable();

    $("app-content").classList.remove("hidden");

    applyPythonResponse();

    requestAnimationFrame(updateFrameHeight);
  }


  sendToStreamlit(
    "streamlit:componentReady",
    { apiVersion: 1 }
  );

  if (window.ResizeObserver) {
    new ResizeObserver(updateFrameHeight).observe(document.body);
  }

  initialize().catch(error => {
    $("app-error").textContent =
      error.message || "The application could not be loaded.";

    $("app-error").classList.remove("hidden");
  });

})();
