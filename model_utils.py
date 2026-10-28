import joblib
import numpy as np
import pandas as pd


def load_bundle(path):
    return joblib.load(path)


def export_browser_model(bundle):
    features = list(bundle["feature_names"])

    def get_values(name):
        return [
            float(bundle[name][feature])
            for feature in features
        ]

    return {
        "feature_names": features,

        "lower": get_values("lower"),
        "upper": get_values("upper"),
        "medians": get_values("medians"),

        "scaler_mean": bundle["scaler"].mean_.tolist(),
        "scaler_scale": bundle["scaler"].scale_.tolist(),

        "pca_mean": bundle["pca"].mean_.tolist(),
        "pca_components": bundle["pca"].components_.tolist(),

        "centroids": bundle["kmeans"].cluster_centers_.tolist(),

        "stats": bundle["stats"],
    }


def predict_profiles(bundle, raw):
    features = list(bundle["feature_names"])

    data = raw.copy()

    data.columns = [
        str(col).strip().lstrip("\ufeff")
        for col in data.columns
    ]

    if data.columns.duplicated().any():
        raise ValueError(
            "Duplicate column names are not allowed."
        )

    required_columns = ["Country"] + features

    missing_columns = [
        col for col in required_columns
        if col not in data.columns
    ]

    if missing_columns:
        raise ValueError(
            "Missing required columns: "
            + ", ".join(missing_columns)
        )

    data = data[required_columns].copy()

    data["Country"] = (
        data["Country"]
        .astype("string")
        .str.strip()
    )

    data = data[
        data["Country"].notna()
        & data["Country"].ne("")
    ].copy()

    if data.empty:
        raise ValueError(
            "The file needs at least one country name."
        )

    # Clean numeric columns.
    for col in features:
        values = data[col].astype("string").str.strip()

        values = values.str.replace("$", "", regex=False)
        values = values.str.replace(",", "", regex=False)
        values = values.str.replace("%", "", regex=False)

        numbers = pd.to_numeric(
            values.replace("", pd.NA),
            errors="coerce"
        )

        invalid = (
            values.notna()
            & values.ne("")
            & numbers.isna()
        )

        if invalid.any():
            example = str(values[invalid].iloc[0])[:50]

            raise ValueError(
                f"Invalid value in {col}: {example}"
            )

        if not np.isfinite(
            numbers.dropna().to_numpy(dtype=float)
        ).all():
            raise ValueError(
                f"Invalid number in {col}."
            )

        data[col] = numbers.astype(float)

    # Average multiple records for each country.
    profiles = (
        data.groupby(
            "Country",
            as_index=False,
            sort=True
        )[features]
        .mean()
    )

    if profiles[features].notna().sum(axis=1).eq(0).any():
        raise ValueError(
            "Each country needs at least one numeric indicator."
        )

    missing_count = profiles[features].isna().sum(axis=1)

    # Apply the saved training IQR limits.
    capped = profiles[features].clip(
        lower=bundle["lower"],
        upper=bundle["upper"],
        axis=1
    )

    # Fill missing values using training medians.
    prepared = capped.fillna(bundle["medians"])

    # Apply the saved scaler, PCA and K-Means model.
    scaled = bundle["scaler"].transform(prepared)

    pca_values = bundle["pca"].transform(scaled)

    labels = bundle["kmeans"].predict(pca_values)

    # Prepare the output.
    result = profiles.copy()

    result.insert(1, "Cluster", labels)

    result.insert(
        2,
        "Missing indicators imputed",
        missing_count.astype(int)
    )

    result.insert(3, "PC1", pca_values[:, 0])
    result.insert(4, "PC2", pca_values[:, 1])

    return result
