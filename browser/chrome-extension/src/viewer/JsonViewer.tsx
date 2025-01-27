import React from "react";
import JsonView from "@uiw/react-json-view";
import { Typography } from "@mui/material";

function JsonViewer() {
    const params = new URLSearchParams(window.location.search);
    const title = params.get("title") || "";
    const did = params.get("did") || "";
    const rawJson = params.get("json") || "";
    let data: any = {};
    try {
        if (rawJson) {
            data = JSON.parse(rawJson);
        }
    } catch {
        data = { error: "Invalid JSON passed via query params" };
    }

    return (
        <div>
            <h1>{title}</h1>
            <Typography sx={{ fontFamily: "Courier, monospace" }}>
                {did}
            </Typography>
            <JsonView value={data} />
        </div>
    );
}

export default JsonViewer;
