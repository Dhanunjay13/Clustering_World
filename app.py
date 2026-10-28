from io import StringIO
from pathlib import Path
import json

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from model_utils import load_bundle, predict_profiles


BASE = Path(__file__).resolve().parent

MODEL_PATH = BASE / "model" / "country_clustering.joblib"
FRONTEND = BASE / "frontend"


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

        [data-testid="stMainBlockContainer"] {
            padding: 0;
            max-width: 100%;
        }

        .block-container {
            padding: 0;
            max-width: 100%;
        }
    </style>
    """,
    unsafe_allow_html=True
)


if (
    not MODEL_PATH.exists()
    or not (FRONTEND / "data.json").exists()
):
    st.error(
        "Model or dashboard data is missing. "
        "Run the model-saving and dashboard-data cells first."
    )
    st.stop()


@st.cache_resource
def get_model(model_path, last_modified):
    return load_bundle(Path(model_path))


# Load the trained model.
bundle = get_model(
    str(MODEL_PATH),
    MODEL_PATH.stat().st_mtime_ns
)

# Connect Streamlit to the dashboard interface.
dashboard = components.declare_component(
    "development_dashboard",
    path=str(FRONTEND)
)

response = st.session_state.get("prediction_response")

request = dashboard(
    prediction_response=response,
    key="development_dashboard",
    default=None
)


# Process CSV files uploaded from the dashboard.
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
                "Invalid upload request. Please select the CSV again."
            )

        if len(request["csv"].encode("utf-8")) > 10 * 1024 * 1024:
            raise ValueError(
                "Please select a CSV file smaller than 10 MB."
            )

        input_data = pd.read_csv(
            StringIO(request["csv"])
        )

        # Apply the saved preprocessing and K-Means model.
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
