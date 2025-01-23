import React from "react";
import ReactDOM from "react-dom/client";
import WalletUI from "./WalletUI";

const rootElement = document.createElement("div");
document.body.appendChild(rootElement);
const root = ReactDOM.createRoot(rootElement);
root.render(<WalletUI />);
