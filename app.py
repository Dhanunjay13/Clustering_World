from io import StringIO
from pathlib import Path
import json
import shutil
import tempfile

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from model_utils import load_bundle, predict_profiles


BASE = Path(__file__).resolve().parent


st.set_page_config(
    page_title="World Development | Cluster Explorer",
    layout="wide",
    initial_sidebar_state="collapsed"
)


# Make the dashboard use the full page.
st.markdown(
    """
    <style>
    [data-testid="stHeader"],
    [data-testid="stToolbar"],
    footer {
        display: none;
    }

    [data-testid="stMainBlockContainer"],
    .block-container {
        padding: 0;
        max-width: 100%;
    }
    </style>
    """,
    unsafe_allow_html=True
)


def find_file(name, directories):
    """Find a file in the repository root or a subfolder."""

    for directory in directories:
        path = directory / name

        if path.is_file():
            return path

    return None


# Find the model in either the root or model/ folder.
model_path = find_file(
    "country_clustering.joblib",
    [
        BASE,
        BASE / "model"
    ]
)


# Find each dashboard file in either frontend/ or the root.
frontend_names = [
    "index.html",
    "styles.css",
    "app.js",
    "data.json"
]

frontend_sources = {
    name: find_file(
        name,
        [
            BASE / "frontend",
            BASE
        ]
    )
    for name in frontend_names
}


# Show the exact missing filename if something is absent.
missing = [
    name
    for name, path in frontend_sources.items()
    if path is None
]

if model_path is None:
    missing.append("country_clustering.joblib")

if missing:
    st.error(
        "Missing files in the GitHub repository: "
        + ", ".join(missing)
    )
    st.stop()


@st.cache_resource
def prepare_frontend(source_paths, timestamps):
    """Prepare the dashboard files for the Streamlit component."""

    folder = Path(
        tempfile.mkdtemp(prefix="cluster_dashboard_")
    )

    for source in source_paths:
        source = Path(source)

        shutil.copy2(
            source,
            folder / source.name
        )

    # Create model.js for the dashboard CSV downloads.
    (folder / "model.js").write_text(
        r'''
window.CountryModel = {
  toCsv(rows, columns) {
    function cell(value, isCountry) {
      if (value == null) return "";

      let text = String(value);

      if (isCountry && /^[=+@-]/.test(text.trimStart())) {
        text = "'" + text;
      }

      return /[",\r\n]/.test(text)
        ? '"' + text.replace(/"/g, '""') + '"'
        : text;
    }

    const header = columns.map(
      c => cell(c, false)
    ).join(",");

    const data = rows.map(
      row => columns.map(
        c => cell(row[c], c === "Country")
      ).join(",")
    );

    return "\uFEFF" + [header, ...data].join("\r\n");
  }
};
''',
        encoding="utf-8"
    )

    return str(folder)


@st.cache_resource
def get_model(path, last_modified):
    """Load the trained model."""

    return load_bundle(Path(path))


# Prepare the dashboard and load the model.
sources = tuple(
    str(frontend_sources[name])
    for name in frontend_names
)

timestamps = tuple(
    frontend_sources[name].stat().st_mtime_ns
    for name in frontend_names
)

frontend = prepare_frontend(
    sources,
    timestamps
)

bundle = get_model(
    str(model_path),
    model_path.stat().st_mtime_ns
)


# Display the dashboard.
dashboard = components.declare_component(
    "development_dashboard",
    path=frontend
)

request = dashboard(
    prediction_response=st.session_state.get(
        "prediction_response"
    ),
    key="development_dashboard",
    default=None
)


# Process a CSV uploaded through the dashboard.
if (
    isinstance(request, dict)
    and request.get("request_id")
    != st.session_state.get("handled_request_id")
):
    request_id = request.get("request_id")

    answer = {
        "request_id": request_id
    }

    try:
        if (
            not isinstance(request_id, str)
            or not isinstance(request.get("csv"), str)
        ):
            raise ValueError(
                "Invalid upload. Please select a CSV file again."
            )

        if len(request["csv"].encode("utf-8")) > 10 * 1024 * 1024:
            raise ValueError(
                "Please choose a CSV file smaller than 10 MB."
            )

        input_data = pd.read_csv(
            StringIO(request["csv"])
        )

        predictions = predict_profiles(
            bundle,
            input_data
        )

        answer.update({
            "rows": json.loads(
                predictions.to_json(orient="records")
            ),
            "file_name": str(
                request.get("file_name", "your file")
            )[:255],
        })

    except Exception as error:
        answer["error"] = str(error)

    st.session_state["handled_request_id"] = request_id

    st.session_state["prediction_response"] = answer

    st.rerun()
